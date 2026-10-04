/**
 * The settlement engine — the only code in the system that moves Time Tokens.
 *
 * Rules it guarantees:
 *  1. Nothing moves while a booking is `requested` — a request is free to make.
 *  2. Both ledger sides come from deterministic ids (`tx_{booking}_debit` /
 *     `tx_{booking}_credit`), so replaying settlement cannot double-charge.
 *  3. The learner is debited and the teacher credited by the same amount; the
 *     platform never mints a token for itself.
 *  4. Every movement carries `createdBy`, `reason` and the policy version, so
 *     the ledger can be audited line by line.
 *  5. The whole thing is one Firestore transaction: wallets, both ledger rows,
 *     the settlement record, the booking status and the notifications either all
 *     land or none do.
 */
import { FieldValue, Timestamp, type DocumentData, type Transaction } from 'firebase-admin/firestore'
import {
  buildSettlementRecord,
  buildSettlementWrites,
  planSettlement,
  settlementRecordId,
  SETTLEMENT_BLOCKED_REASONS,
  type AttendanceSegment,
  type Booking,
  type PlatformConfig,
  type SettlementRecord,
  type TokenTransaction,
  type Wallet,
} from '../shared'
import type { SettlementOutcomeResult, SettlementPlan, UserStats } from '../shared'
import { statsAfterSettlement } from '../shared'
import { fromQuery, fromSnapshot, toFirestore } from './convert'
import { notify, pendingCompletionNotification, sessionSettledNotification } from './notify'
import { COLLECTIONS, db } from './refs'

export interface SettleOptions {
  /** Who caused this settlement, e.g. `user:abc123` or `system:auto_settle`. */
  createdBy: string
  /** Skip the "session has finished" guard (used when a room closes early). */
  force?: boolean
  /** Explicit confirmations supplied in this call. */
  confirmations?: { teacher?: boolean; learner?: boolean }
  now?: Date
}

interface SettlementAttempt {
  booking: Booking
  settlement: SettlementRecord | null
  notices: string[]
}

/**
 * Writes one member's denormalised counters. The arithmetic lives in
 * shared/settlement.ts so the reference backend and the deployed functions
 * cannot disagree about what a settled hour adds up to.
 */
function writeProfileStats(
  tx: Transaction,
  reference: FirebaseFirestore.DocumentReference,
  snapshot: FirebaseFirestore.DocumentSnapshot,
  side: 'teacher' | 'learner',
  booking: Booking,
  plan: SettlementPlan,
  at: Timestamp,
): void {
  if (!snapshot.exists) return
  const stats = (snapshot.data() as { stats?: UserStats } | undefined)?.stats
  if (!stats) return
  tx.set(reference, { stats: statsAfterSettlement(stats, side, booking.durationMinutes, plan), updatedAt: at }, { merge: true })
}

async function readAttendance(tx: Transaction, roomId: string | null): Promise<AttendanceSegment[]> {
  if (!roomId) return []
  const snapshot = await tx.get(db.collection(COLLECTIONS.rooms).doc(roomId).collection(COLLECTIONS.attendance))
  return fromQuery<AttendanceSegment>(snapshot.docs)
}

function walletWrite(wallet: Wallet, at: Timestamp): DocumentData {
  return { ...(toFirestore(wallet) as DocumentData), updatedAt: at }
}

/**
 * Settle one booking inside a transaction. Safe to call repeatedly: a settled
 * booking is returned untouched, with a notice explaining why.
 */
export async function settleBookingTransactionally(
  bookingId: string,
  options: SettleOptions,
): Promise<SettlementOutcomeResult> {
  const bookingReference = db.collection(COLLECTIONS.bookings).doc(bookingId)

  const attempt = await db.runTransaction<SettlementAttempt>(async (tx) => {
    const booking = fromSnapshot<Booking>(await tx.get(bookingReference))
    if (!booking) {
      return { booking: null as unknown as Booking, settlement: null, notices: ['That booking no longer exists.'] }
    }

    const existingRecord = fromSnapshot<SettlementRecord>(
      await tx.get(db.collection(COLLECTIONS.settlements).doc(settlementRecordId(booking.id))),
    )

    if (booking.settlement.state === 'settled') {
      return {
        booking,
        settlement: existingRecord,
        notices: ['This session was already settled — no tokens moved again.'],
      }
    }
    if (existingRecord?.status === 'settled') {
      // Ledger ids are deterministic, so the record is authoritative even if the
      // booking document was left behind by an interrupted run.
      return {
        booking,
        settlement: existingRecord,
        notices: ['A settlement record already exists for this session — nothing moved again.'],
      }
    }

    const config = fromSnapshot<PlatformConfig>(await tx.get(db.doc(`${COLLECTIONS.config}/platform`)))
    if (!config) {
      return { booking, settlement: null, notices: ['The platform policy document is missing; settlement is on hold.'] }
    }

    const teacherWallet = fromSnapshot<Wallet>(await tx.get(db.collection(COLLECTIONS.wallets).doc(booking.teacherUid)))
    const learnerWallet = fromSnapshot<Wallet>(await tx.get(db.collection(COLLECTIONS.wallets).doc(booking.learnerUid)))
    if (!teacherWallet || !learnerWallet) {
      return { booking, settlement: null, notices: ['Wallet records are missing for this session.'] }
    }

    // Read the two profiles too. The counters below are computed from these
    // snapshots, and every read must happen before the transaction's first write.
    const teacherProfileReference = db.collection(COLLECTIONS.users).doc(booking.teacherUid)
    const learnerProfileReference = db.collection(COLLECTIONS.users).doc(booking.learnerUid)
    const teacherProfileSnapshot = await tx.get(teacherProfileReference)
    const learnerProfileSnapshot = await tx.get(learnerProfileReference)

    const attendance = await readAttendance(tx, booking.roomId)
    const now = options.now ?? new Date()

    const plan = planSettlement({
      booking,
      config,
      attendance,
      teacherWallet,
      learnerWallet,
      confirmations: {
        teacher: options.confirmations?.teacher ?? Boolean(booking.completion.teacherConfirmedAt),
        learner: options.confirmations?.learner ?? Boolean(booking.completion.learnerConfirmedAt),
      },
      sessionFinished: options.force || now.getTime() >= Date.parse(booking.endAt),
      now,
      requesterUid: options.createdBy.startsWith('user:') ? options.createdBy.slice(5) : null,
    })

    if (plan.outcome === 'blocked') {
      if (plan.blockedReason === SETTLEMENT_BLOCKED_REASONS.insufficientAttendance) {
        tx.set(
          bookingReference,
          {
            settlement: { ...booking.settlement, state: 'blocked', note: plan.reason },
            revision: (booking.revision ?? 0) + 1,
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        )
        notify(tx, pendingCompletionNotification(booking))
      }
      return { booking, settlement: null, notices: [plan.reason] }
    }

    const write = buildSettlementWrites({
      booking,
      plan,
      teacher: teacherWallet,
      learner: learnerWallet,
      createdBy: options.createdBy,
      reason: plan.reason,
    })
    const record = buildSettlementRecord(booking, plan)
    const at = Timestamp.now()

    for (const entry of write.entries) {
      const transaction: TokenTransaction = {
        id: entry.id,
        type: entry.type,
        amount: entry.amount,
        direction: entry.direction,
        status: 'posted',
        uid: entry.uid,
        counterpartyUid: entry.counterpartyUid,
        bookingId: entry.bookingId,
        roomId: booking.roomId,
        idempotencyKey: entry.idempotencyKey,
        balanceAfter: entry.balanceAfter,
        reason: entry.reason,
        policyCode: entry.policyCode,
        createdBy: entry.createdBy,
        createdAt: at.toDate().toISOString(),
      }
      tx.set(db.collection(COLLECTIONS.transactions).doc(entry.id), {
        ...(toFirestore(transaction) as DocumentData),
        createdAt: at,
      })
    }

    // The listing's and both members' counters are denormalised for the UI (the
    // dashboard, the rating stars, the marketplace ranking), so they are written
    // here — a session that nobody settles is a session that did not happen.
    // Only the two outcomes that paid for real work count; a refund or a blocked
    // attempt leaves every counter untouched. The arithmetic itself lives in
    // shared/settlement.ts so both engines compute the same numbers.
    tx.set(
      db.collection(COLLECTIONS.skills).doc(booking.skillId),
      { completedCount: FieldValue.increment(1), updatedAt: at },
      { merge: true },
    )

    writeProfileStats(tx, teacherProfileReference, teacherProfileSnapshot, 'teacher', booking, plan, at)
    writeProfileStats(tx, learnerProfileReference, learnerProfileSnapshot, 'learner', booking, plan, at)

    tx.set(db.collection(COLLECTIONS.wallets).doc(write.nextTeacher.uid), walletWrite(write.nextTeacher, at), { merge: true })
    tx.set(db.collection(COLLECTIONS.wallets).doc(write.nextLearner.uid), walletWrite(write.nextLearner, at), { merge: true })

    tx.set(db.collection(COLLECTIONS.settlements).doc(record.id), {
      ...(toFirestore(record) as DocumentData),
      createdAt: at,
      updatedAt: at,
    })

    const settlementState = plan.outcome === 'partial' ? 'partial' : 'settled'
    tx.set(
      bookingReference,
      {
        status: 'completed',
        settlement: {
          state: settlementState,
          settlementId: record.id,
          settledAt: at,
          debitTxId: write.entries[0]?.id ?? null,
          creditTxId: write.entries[1]?.id ?? null,
          refundTxId: booking.settlement.refundTxId,
          heldTxId: booking.settlement.heldTxId,
          note: plan.reason,
        },
        completion: {
          ...booking.completion,
          verifiedMinutes: plan.verifiedMinutes,
          autoCompletedAt: booking.completion.autoCompletedAt ?? at.toDate().toISOString(),
        },
        revision: (booking.revision ?? 0) + 1,
        updatedAt: at,
      },
      { merge: true },
    )

    const settledTokens = plan.outcome === 'partial' ? plan.creditAmount : plan.tokenAmount
    notify(tx, sessionSettledNotification(booking, settledTokens, 'teacher'))
    notify(tx, sessionSettledNotification(booking, plan.debitAmount, 'learner'))

    return {
      booking: {
        ...booking,
        status: 'completed',
        settlement: {
          ...booking.settlement,
          state: settlementState,
          settlementId: record.id,
          settledAt: at.toDate().toISOString(),
          debitTxId: write.entries[0]?.id ?? null,
          creditTxId: write.entries[1]?.id ?? null,
          note: plan.reason,
        },
        completion: {
          ...booking.completion,
          verifiedMinutes: plan.verifiedMinutes,
          autoCompletedAt: booking.completion.autoCompletedAt ?? at.toDate().toISOString(),
        },
      },
      settlement: { ...record, createdAt: at.toDate().toISOString(), updatedAt: at.toDate().toISOString() },
      notices: [plan.reason],
    }
  })

  return { booking: attempt.booking, settlement: attempt.settlement, notices: attempt.notices }
}

/**
 * Scheduled sweep: settles sessions that finished a while ago and were never
 * closed by hand. Deliberately conservative — it only touches bookings that are
 * still `in_progress` and long past their end, and every attempt is wrapped so
 * one bad booking cannot stall the rest.
 */
export async function autoSettleFinishedSessions(): Promise<{ settled: string[]; skipped: string[] }> {
  const config = fromSnapshot<PlatformConfig>(await db.doc(`${COLLECTIONS.config}/platform`).get())
  if (!config) return { settled: [], skipped: [] }

  const cutoff = new Date(Date.now() - config.settlement.autoSettleAfterHours * 3_600_000)
  const snapshot = await db
    .collection(COLLECTIONS.bookings)
    .where('status', '==', 'in_progress')
    .where('endAt', '<=', Timestamp.fromDate(cutoff))
    .limit(50)
    .get()

  const settled: string[] = []
  const skipped: string[] = []
  for (const document of snapshot.docs) {
    try {
      const outcome = await settleBookingTransactionally(document.id, { createdBy: 'system:auto_settle' })
      if (outcome.settlement) settled.push(document.id)
      else skipped.push(document.id)
    } catch (error) {
      console.error(`[PeerPulse] auto-settle failed for ${document.id}`, error)
      skipped.push(document.id)
    }
  }
  return { settled, skipped }
}
