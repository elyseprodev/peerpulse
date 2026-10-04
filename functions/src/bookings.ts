/**
 * Booking lifecycle callables.
 *
 * Everything that changes what a booking *means* — and therefore what it can
 * eventually cost — happens here, on the server, with every client-supplied
 * value treated as untrusted input. The client's only lifecycle write is opening
 * a dispute (see firestore.rules).
 */
import { FieldValue, Timestamp, type DocumentData, type Transaction } from 'firebase-admin/firestore'
import { onCall, type CallableRequest } from 'firebase-functions/v2/https'
import {
  BLOCKING_STATUSES,
  canAfford,
  computeTokenAmount,
  findConflict,
  resolveCancellation,
  roundTokens,
  validateBookingWindow,
  validateSessionDuration,
  type Booking,
  type ConflictCandidate,
  type PlatformConfig,
  type SkillListing,
  type TokenTransaction,
  type UserProfile,
  type Wallet,
} from './shared'
import { fromQuery, fromSnapshot, toFirestore } from './lib/convert'
import { fail, rethrow } from './lib/errors'
import {
  bookingCancelledNotification,
  bookingConfirmedNotification,
  bookingDeclinedNotification,
  bookingRequestedNotification,
  bookingRescheduledNotification,
  notify,
} from './lib/notify'
import { COLLECTIONS, db, getConfig, getWallet, nowIso, requireUid } from './lib/refs'
import { settleBookingTransactionally } from './lib/settlement'

interface CreateBookingPayload {
  skillId?: string
  startAt?: string
  endAt?: string
  timezone?: string
  learnerNote?: string
}

interface RespondPayload {
  bookingId?: string
  action?: 'confirm' | 'decline' | 'cancel' | 'reschedule'
  reason?: string
  startAt?: string
  endAt?: string
}

function parseDate(value: unknown): Date {
  if (typeof value !== 'string') fail('booking/invalid-time', 'Choose a valid start and end time.')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) fail('booking/invalid-time', 'Choose a valid start and end time.')
  return date
}

/**
 * Slot availability across both members, resolved with a server-side query.
 * A conflict for *either* party blocks the booking — the shared helper treats
 * "same teacher or same learner + overlapping window" as a conflict.
 */
async function assertNoConflict(
  teacherUid: string,
  learnerUid: string,
  startAt: string,
  endAt: string,
  options: { ignoreBookingId?: string } = {},
): Promise<void> {
  const day = 24 * 3_600_000
  const from = new Date(Date.parse(startAt) - day)
  const to = new Date(Date.parse(endAt) + day)

  const snapshots = await Promise.all(
    [teacherUid, learnerUid].map((participant) =>
      db
        .collection(COLLECTIONS.bookings)
        .where('participants', 'array-contains', participant)
        .where('startAt', '>=', Timestamp.fromDate(from))
        .where('startAt', '<=', Timestamp.fromDate(to))
        .get(),
    ),
  )

  const blocking = snapshots
    .flatMap((snapshot) => fromQuery<Booking>(snapshot.docs))
    .filter((booking) => BLOCKING_STATUSES.includes(booking.status))

  const candidate: ConflictCandidate = {
    status: 'requested',
    teacherUid,
    learnerUid,
    start: startAt,
    end: endAt,
  }

  const conflict = findConflict(blocking, candidate, options)
  if (conflict) {
    fail('booking/conflict', 'That slot overlaps another session. Pick a different time.', { bookingId: conflict.id })
  }
}

/* ───────────────────────────── createBooking ───────────────────────────── */

export const createBooking = onCall(async (request: CallableRequest<CreateBookingPayload>) => {
  try {
    const uid = requireUid(request)
    const input = request.data ?? {}
    if (!input.skillId) fail('skill/not-found', 'Choose a listing to book.')

    const config = await getConfig()
    const learner = fromSnapshot<UserProfile>(await db.collection(COLLECTIONS.users).doc(uid).get())
    if (!learner) fail('user/not-found', 'That member could not be found.')
    if (learner.status === 'suspended') fail('auth/suspended', 'This account is suspended. Contact a steward.')

    const skill = fromSnapshot<SkillListing>(await db.collection(COLLECTIONS.skills).doc(input.skillId).get())
    if (!skill || skill.status !== 'published') fail('skill/not-found', 'That listing is no longer available.')
    if (skill.ownerUid === uid) fail('booking/self', 'You cannot book your own listing.')

    const teacher = fromSnapshot<UserProfile>(await db.collection(COLLECTIONS.users).doc(skill.ownerUid).get())
    if (!teacher) fail('user/not-found', 'The teacher could not be found.')

    const start = parseDate(input.startAt)
    const end = parseDate(input.endAt)
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000)

    const durationError = validateSessionDuration(durationMinutes, config)
    if (durationError) fail('booking/invalid-duration', durationError, { duration: durationError })
    const windowError = validateBookingWindow(start, end, config)
    if (windowError) fail('booking/invalid-window', windowError, { startAt: windowError })

    const tokenAmount = computeTokenAmount(durationMinutes, config)
    if (tokenAmount <= 0) fail('booking/invalid-duration', 'That session is too short to be worth any Time Tokens.')

    await assertNoConflict(skill.ownerUid, uid, start.toISOString(), end.toISOString())

    // A pending request reserves nothing — tokens only move at settlement. But a
    // booking the learner could never pay for is refused up front, so nobody
    // books an hour they cannot honour.
    const wallet = await getWallet(uid)
    if (!canAfford(wallet, tokenAmount)) {
      fail('wallet/insufficient', 'You do not have enough Time Tokens for that session yet. Teach a session first.', {
        available: String(roundTokens(wallet.balance - wallet.held)),
        required: String(tokenAmount),
      })
    }

    const bookingId = db.collection(COLLECTIONS.bookings).doc().id
    const now = nowIso()
    const booking: Booking = {
      id: bookingId,
      skillId: skill.id,
      skillTitle: skill.title,
      categoryId: skill.categoryId,
      teacherUid: skill.ownerUid,
      learnerUid: uid,
      participants: [skill.ownerUid, uid].sort(),
      participantsSnapshot: [
        { uid: skill.ownerUid, displayName: teacher.displayName, photoURL: teacher.photoURL, avatarSeed: teacher.avatarSeed },
        { uid, displayName: learner.displayName, photoURL: learner.photoURL, avatarSeed: learner.avatarSeed },
      ],
      createdByUid: uid,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      durationMinutes,
      timezone: (input.timezone ?? learner.timezone ?? 'UTC').slice(0, 60),
      status: config.booking.autoConfirm ? 'confirmed' : 'requested',
      roomId: null,
      tokenAmount,
      settlement: {
        state: 'unsettled',
        settlementId: null,
        settledAt: null,
        debitTxId: null,
        creditTxId: null,
        refundTxId: null,
        heldTxId: null,
        note: null,
      },
      cancellation: null,
      reschedules: [],
      completion: {
        teacherConfirmedAt: null,
        learnerConfirmedAt: null,
        autoCompletedAt: null,
        verifiedMinutes: null,
        closedBy: null,
      },
      learnerNote: (input.learnerNote ?? '').slice(0, 400),
      teacherNote: '',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }

    await db.runTransaction(async (tx) => {
      tx.set(db.collection(COLLECTIONS.bookings).doc(bookingId), toFirestore(booking) as DocumentData)
      // Denormalised for the marketplace and the profile listing card, and the
      // reference backend counts a request at creation time — mirror that so the
      // two implementations agree on what the number means.
      tx.set(
        db.collection(COLLECTIONS.skills).doc(skill.id),
        { bookingCount: FieldValue.increment(1), updatedAt: Timestamp.now() },
        { merge: true },
      )
      notify(tx, bookingRequestedNotification(booking, teacher.displayName, learner.displayName))
    })

    return booking
  } catch (error) {
    rethrow(error, 'createBooking')
  }
})

/* ──────────────────────────── respondToBooking ─────────────────────────── */

interface TransitionResult {
  next: Booking
  /** Set when confirming under the escrow policy. */
  holdAmount?: number
  opensRoom: boolean
}

/**
 * The four things a participant may do to a booking, as one state machine.
 * Kept separate from the transaction so each branch reads clearly.
 */
async function applyTransition(
  booking: Booking,
  action: NonNullable<RespondPayload['action']>,
  uid: string,
  payload: RespondPayload,
  config: PlatformConfig,
): Promise<TransitionResult> {
  const now = nowIso()
  const isTeacher = booking.teacherUid === uid
  const isLearner = booking.learnerUid === uid

  if (!isTeacher && !isLearner) fail('booking/forbidden', 'Only the teacher or the learner on this booking can do that.')

  if (action === 'confirm' || action === 'decline') {
    if (!isTeacher) fail('booking/forbidden', `Only the teacher can ${action} this request.`)
    if (booking.status !== 'requested') fail('booking/invalid-state', 'This request is no longer awaiting confirmation.')
  }

  if (action === 'confirm') {
    let holdAmount: number | undefined
    let settlement = booking.settlement
    if (config.booking.reserveTokensOnConfirm) {
      const learnerWallet = await getWallet(booking.learnerUid)
      if (!canAfford(learnerWallet, booking.tokenAmount)) {
        fail('wallet/insufficient', 'The learner no longer has enough Time Tokens available for this session.')
      }
      holdAmount = booking.tokenAmount
      settlement = { ...booking.settlement, state: 'escrowed', heldTxId: `tx_${booking.id}_hold` }
    }
    return {
      next: { ...booking, status: 'confirmed', settlement, revision: booking.revision + 1, updatedAt: now },
      holdAmount,
      opensRoom: true,
    }
  }

  if (action === 'decline') {
    return {
      next: {
        ...booking,
        status: 'declined',
        teacherNote: (payload.reason ?? '').slice(0, 400),
        revision: booking.revision + 1,
        updatedAt: now,
      },
      opensRoom: false,
    }
  }

  if (action === 'cancel') {
    if (['completed', 'cancelled', 'declined', 'no_show'].includes(booking.status)) {
      fail('booking/invalid-state', 'This booking can no longer be cancelled.')
    }
    const outcome = resolveCancellation(booking, uid, config)
    const releasedEscrow = outcome.refundTokens > 0 && Boolean(booking.settlement.heldTxId)
    return {
      next: {
        ...booking,
        status: 'cancelled',
        cancellation: {
          byUid: uid,
          reason: (payload.reason ?? '').slice(0, 400),
          at: now,
          refundTokens: outcome.refundTokens,
          policyCode: outcome.policyCode,
        },
        settlement: releasedEscrow
          ? { ...booking.settlement, state: 'refunded', refundTxId: `tx_${booking.id}_refund` }
          : booking.settlement,
        revision: booking.revision + 1,
        updatedAt: now,
      },
      // Under escrow the whole hold is released, whatever the refund ratio.
      holdAmount: releasedEscrow ? -booking.tokenAmount : undefined,
      opensRoom: false,
    }
  }

  // reschedule
  if (booking.status !== 'requested' && booking.status !== 'confirmed') {
    fail('booking/invalid-state', 'Only requested or confirmed sessions can be rescheduled.')
  }
  const start = parseDate(payload.startAt)
  const end = parseDate(payload.endAt)
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000)
  const durationError = validateSessionDuration(durationMinutes, config)
  if (durationError) fail('booking/invalid-duration', durationError)
  const windowError = validateBookingWindow(start, end, config)
  if (windowError) fail('booking/invalid-window', windowError)

  await assertNoConflict(booking.teacherUid, booking.learnerUid, start.toISOString(), end.toISOString(), {
    ignoreBookingId: booking.id,
  })

  return {
    next: {
      ...booking,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      durationMinutes,
      tokenAmount: computeTokenAmount(durationMinutes, config),
      // A teacher moving a confirmed session keeps it confirmed; a learner's
      // proposal goes back to the teacher for approval.
      status: isTeacher ? 'confirmed' : 'requested',
      reschedules: [
        ...booking.reschedules,
        {
          byUid: uid,
          at: now,
          from: { start: booking.startAt, end: booking.endAt },
          to: { start: start.toISOString(), end: end.toISOString() },
          reason: (payload.reason ?? '').slice(0, 400),
        },
      ].slice(-10),
      revision: booking.revision + 1,
      updatedAt: now,
    },
    opensRoom: isTeacher && booking.status === 'confirmed',
  }
}

/** Writes the escrow hold (or its release) plus the matching ledger row. */
function applyEscrow(tx: Transaction, booking: Booking, wallet: Wallet, amount: number, at: Timestamp): void {
  const holdId = `tx_${booking.id}_hold`
  const released = amount < 0
  const applied = Math.abs(amount)

  tx.set(
    db.collection(COLLECTIONS.wallets).doc(wallet.uid),
    { held: roundTokens(Math.max(0, wallet.held + amount)), updatedAt: at },
    { merge: true },
  )

  const entry: TokenTransaction = {
    id: holdId,
    type: released ? 'escrow_release' : 'escrow_hold',
    amount: applied,
    direction: released ? 'credit' : 'debit',
    status: released ? 'posted' : 'pending',
    uid: booking.learnerUid,
    counterpartyUid: booking.teacherUid,
    bookingId: booking.id,
    roomId: booking.roomId,
    idempotencyKey: holdId,
    balanceAfter: wallet.balance,
    reason: released ? 'Escrow released — the session was cancelled in time.' : `Reserved for ${booking.skillTitle}`,
    policyCode: released ? 'escrow_release' : 'escrow_hold',
    createdBy: released ? 'server:cancel_booking' : 'server:confirm_booking',
    createdAt: at.toDate().toISOString(),
  }
  tx.set(db.collection(COLLECTIONS.transactions).doc(holdId), {
    ...(toFirestore(entry) as DocumentData),
    createdAt: at,
  })
}

export const respondToBooking = onCall(async (request: CallableRequest<RespondPayload>) => {
  try {
    const uid = requireUid(request)
    const payload = request.data ?? {}
    if (!payload.bookingId) fail('booking/not-found', 'That booking could not be found.')
    if (!payload.action) fail('booking/invalid-state', 'Choose what to do with this booking.')

    const config = await getConfig()
    const bookingReference = db.collection(COLLECTIONS.bookings).doc(payload.bookingId)

    return await db.runTransaction(async (tx) => {
      // Firestore requires every read in a transaction to happen before the
      // first write, so all four documents are fetched up front and the
      // transition is computed from them. (Reading the profiles after the write
      // below threw `Firestore transactions require all reads to be executed
      // before all writes` on every confirmation — see
      // tests/functions.spec.ts, which caught it.)
      const booking = fromSnapshot<Booking>(await tx.get(bookingReference))
      if (!booking) fail('booking/not-found', 'That booking could not be found.')

      const { next, holdAmount, opensRoom } = await applyTransition(booking, payload.action!, uid, payload, config)
      const at = Timestamp.now()

      const learnerWallet = holdAmount
        ? fromSnapshot<Wallet>(await tx.get(db.collection(COLLECTIONS.wallets).doc(next.learnerUid)))
        : null
      if (holdAmount && !learnerWallet) fail('wallet/not-found', 'Wallet records are missing for this session.')

      const teacher = fromSnapshot<UserProfile>(await tx.get(db.collection(COLLECTIONS.users).doc(next.teacherUid)))
      const learner = fromSnapshot<UserProfile>(await tx.get(db.collection(COLLECTIONS.users).doc(next.learnerUid)))

      /* ── reads are complete: from here on this transaction only writes ── */

      if (holdAmount && learnerWallet) {
        applyEscrow(tx, next, learnerWallet, holdAmount, at)
      }

      const roomId = next.roomId ?? (next.status === 'confirmed' ? `room_${next.id}` : null)

      tx.set(bookingReference, { ...(toFirestore({ ...next, roomId }) as DocumentData), updatedAt: at }, { merge: true })

      if (opensRoom && !booking.roomId && roomId) {
        tx.set(db.collection(COLLECTIONS.rooms).doc(roomId), {
          bookingId: next.id,
          skillTitle: next.skillTitle,
          teacherUid: next.teacherUid,
          learnerUid: next.learnerUid,
          participants: next.participants,
          status: 'scheduled',
          createdAt: at,
          openedAt: null,
          closedAt: null,
          attendanceLocked: false,
          session: { startedAt: null, endedAt: null, durationMinutes: null, initiatorUid: null },
        })
      }

      const teacherName = teacher?.displayName ?? 'Your teacher'
      const learnerName = learner?.displayName ?? 'A member'
      const actorName = uid === next.teacherUid ? teacherName : learnerName

      if (payload.action === 'confirm') notify(tx, bookingConfirmedNotification(next, teacherName))
      if (payload.action === 'decline') notify(tx, bookingDeclinedNotification(next, teacherName, payload.reason ?? ''))
      if (payload.action === 'cancel') {
        notify(
          tx,
          bookingCancelledNotification(next, actorName, next.cancellation?.refundTokens ?? 0, next.cancellation?.policyCode ?? 'policy'),
        )
      }
      if (payload.action === 'reschedule') notify(tx, bookingRescheduledNotification(next, uid, actorName))

      return { ...next, roomId }
    })
  } catch (error) {
    rethrow(error, 'respondToBooking')
  }
})

/* ────────────────────────── completion & settlement ────────────────────── */

/**
 * "That session happened." One confirmation unlocks settlement once the booking
 * has finished; both confirmations let it settle even when attendance fell below
 * the quorum (a network failure that pushed the call onto the phone, say).
 */
export const confirmCompletion = onCall(async (request: CallableRequest<{ bookingId?: string }>) => {
  try {
    const uid = requireUid(request)
    const bookingId = request.data?.bookingId
    if (!bookingId) fail('booking/not-found', 'That booking could not be found.')

    const booking = fromSnapshot<Booking>(await db.collection(COLLECTIONS.bookings).doc(bookingId).get())
    if (!booking) fail('booking/not-found', 'That booking could not be found.')
    if (!booking.participants.includes(uid)) fail('booking/forbidden', 'Only the two members on this session can confirm it.')
    if (['cancelled', 'declined', 'no_show'].includes(booking.status)) {
      fail('booking/invalid-state', 'A cancelled session cannot be confirmed.')
    }

    const now = nowIso()
    const isTeacher = booking.teacherUid === uid
    const teacherConfirmed = isTeacher || Boolean(booking.completion.teacherConfirmedAt)
    const learnerConfirmed = !isTeacher || Boolean(booking.completion.learnerConfirmedAt)

    await db
      .collection(COLLECTIONS.bookings)
      .doc(bookingId)
      .set(
        {
          completion: {
            ...booking.completion,
            ...(isTeacher ? { teacherConfirmedAt: now } : { learnerConfirmedAt: now }),
            closedBy: 'participants',
          },
          status: booking.status === 'confirmed' ? 'in_progress' : booking.status,
          revision: booking.revision + 1,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      )

    return await settleBookingTransactionally(bookingId, {
      createdBy: `user:${uid}`,
      confirmations: { teacher: teacherConfirmed, learner: learnerConfirmed },
    })
  } catch (error) {
    rethrow(error, 'confirmCompletion')
  }
})

/** "End session for both" in the room UI, or an admin closing a stuck session. */
export const settleSession = onCall(async (request: CallableRequest<{ bookingId?: string }>) => {
  try {
    const uid = requireUid(request)
    const bookingId = request.data?.bookingId
    if (!bookingId) fail('booking/not-found', 'That booking could not be found.')

    const booking = fromSnapshot<Booking>(await db.collection(COLLECTIONS.bookings).doc(bookingId).get())
    if (!booking) fail('booking/not-found', 'That booking could not be found.')
    if (!booking.participants.includes(uid)) fail('booking/forbidden', 'Only the two members on this session can settle it.')

    return await settleBookingTransactionally(bookingId, {
      createdBy: `user:${uid}`,
      // Closing the room is an explicit "we are done" signal from a participant.
      force: true,
    })
  } catch (error) {
    rethrow(error, 'settleSession')
  }
})
