/**
 * Reviews and moderation callables.
 *
 * Reviews can only be written after a genuinely completed session, by one of the
 * two people who were there. Moderation is administrative, and a dispute is the
 * only place an administrator can move tokens after a session — which is why
 * every dispute path writes a ledger row with a reason, exactly like an
 * automatic settlement.
 */
import { Timestamp, type DocumentData } from 'firebase-admin/firestore'
import { onCall, type CallableRequest } from 'firebase-functions/v2/https'
import {
  buildRefundWrites,
  listingAfterReview,
  roundTokens,
  statsAfterReview,
  type Booking,
  type DisputeCase,
  type ModerationReport,
  type Review,
  type TokenTransaction,
  type UserProfile,
  type UserStats,
  type Wallet,
} from './shared'
import { fromSnapshot, toFirestore } from './lib/convert'
import { COLLECTIONS, db, nowIso, requireAdmin, requireUid } from './lib/refs'
import { notify } from './lib/notify'
import { fail, rethrow } from './lib/errors'

/* ────────────────────────────── createReview ───────────────────────────── */

interface CreateReviewPayload {
  bookingId?: string
  rating?: number
  comment?: string
  tags?: string[]
}

export const createReview = onCall(async (request: CallableRequest<CreateReviewPayload>) => {
  try {
    const uid = requireUid(request)
    const input = request.data ?? {}
    if (!input.bookingId) fail('booking/not-found', 'That booking could not be found.')

    const booking = fromSnapshot<Booking>(await db.collection(COLLECTIONS.bookings).doc(input.bookingId).get())
    if (!booking) fail('booking/not-found', 'That booking could not be found.')
    if (!booking.participants.includes(uid)) fail('booking/forbidden', 'Only the two members on this session can review it.')
    if (booking.status !== 'completed') {
      fail('review/not-completed', 'Reviews can only be left after a session has been completed.')
    }

    const rating = Math.round(Number(input.rating ?? 0))
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) fail('review/invalid-rating', 'Choose a rating between 1 and 5.')

    const duplicate = await db
      .collection(COLLECTIONS.reviews)
      .where('bookingId', '==', booking.id)
      .where('authorUid', '==', uid)
      .limit(1)
      .get()
    if (!duplicate.empty) fail('review/duplicate', 'You have already reviewed this session.')

    const subjectUid = uid === booking.teacherUid ? booking.learnerUid : booking.teacherUid
    const author = fromSnapshot<UserProfile>(await db.collection(COLLECTIONS.users).doc(uid).get())
    const now = nowIso()
    const reference = db.collection(COLLECTIONS.reviews).doc()
    const review: Review = {
      id: reference.id,
      bookingId: booking.id,
      skillId: booking.skillId,
      // The author and their role come from the verified token and the booking,
      // never from the payload.
      authorUid: uid,
      subjectUid,
      authorRole: uid === booking.teacherUid ? 'teacher' : 'learner',
      rating,
      comment: (input.comment ?? '').slice(0, 1_200),
      tags: (input.tags ?? []).slice(0, 6),
      moderation: { state: 'clean', reason: null },
      responseText: null,
      responseAt: null,
      createdAt: now,
    }

    await db.runTransaction(async (tx) => {
      const skillReference = db.collection(COLLECTIONS.skills).doc(booking.skillId)
      const subjectReference = db.collection(COLLECTIONS.users).doc(subjectUid)
      const [skillSnapshot, subjectSnapshot] = [await tx.get(skillReference), await tx.get(subjectReference)]

      tx.set(reference, toFirestore(review) as DocumentData)

      // Listing score is server-side only: a teacher can never inflate it.
      // The listing's stars describe the teacher, so only a review *about* the
      // listing's owner moves them. A teacher rating a learner's punctuality
      // stays on the learner's profile, where it belongs.
      const skill = skillSnapshot.data() as { ownerUid?: string; ratingSum?: number; reviewCount?: number } | undefined
      if (skillSnapshot.exists && skill && skill.ownerUid === subjectUid) {
        tx.set(
          skillReference,
          {
            ...listingAfterReview({ ratingSum: skill.ratingSum ?? 0, reviewCount: skill.reviewCount ?? 0 }, rating),
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        )
      }

      if (subjectSnapshot.exists) {
        // The member's aggregate uses the field names shared/domain.ts declares
        // (`stats.ratingSum` / `stats.reviewCount`) because that is what the
        // profile, the member card and the member ranking read. This used to
        // write `ratingCount`/`ratingAverage` instead, leaving `reviewCount` at
        // zero — a member with five reviews still showed none.
        const stats = (subjectSnapshot.data() as { stats?: UserStats }).stats
        if (stats) {
          tx.set(subjectReference, { stats: statsAfterReview(stats, rating), updatedAt: Timestamp.now() }, { merge: true })
        }
      }

      notify(tx, {
        uid: subjectUid,
        type: 'review_received',
        title: `${author?.displayName ?? 'A member'} rated your session ${rating}/5`,
        body: review.comment || `${booking.skillTitle} — you can reply to this review from your profile.`,
        link: `/members/${subjectUid}`,
      })
    })

    return review
  } catch (error) {
    rethrow(error, 'createReview')
  }
})

/* ────────────────────────────── resolveReport ──────────────────────────── */

interface ResolveReportPayload {
  reportId?: string
  status?: ModerationReport['status']
  resolution?: string
}

/** Where a report points, as a document reference, when we know how to hide it. */
function moderationTarget(report: ModerationReport) {
  const path = (report.targetPath ?? '').split('/').filter(Boolean)
  if (path.length < 2 || path.length > 4) return null
  if (!['skills', 'posts', 'comments', 'communities'].includes(path[0])) return null
  return db.doc(path.join('/'))
}

export const resolveReport = onCall(async (request: CallableRequest<ResolveReportPayload>) => {
  try {
    const adminUid = requireAdmin(request)
    const { reportId, status, resolution } = request.data ?? {}
    if (!reportId) fail('report/not-found', 'That report could not be found.')
    if (!status || !['reviewing', 'resolved', 'dismissed'].includes(status)) {
      fail('report/not-found', 'Choose a valid resolution state.')
    }

    const reference = db.collection(COLLECTIONS.reports).doc(reportId)
    const report = fromSnapshot<ModerationReport>(await reference.get())
    if (!report) fail('report/not-found', 'That report could not be found.')

    const now = Timestamp.now()
    const upheld = status === 'resolved'
    const target = upheld ? moderationTarget(report) : null

    await db.runTransaction(async (tx) => {
      tx.set(
        reference,
        {
          status,
          resolution: (resolution ?? '').slice(0, 600),
          handledByUid: adminUid,
          handledAt: now,
          updatedAt: now,
        },
        { merge: true },
      )

      // Upholding a report hides the content pending an edit; the audit trail on
      // the report itself records who decided and why.
      if (target) {
        const moderation = { state: 'hidden', reason: report.details.slice(0, 300) }
        tx.set(target, { moderation, reviewedByUid: adminUid, reviewedAt: now }, { merge: true })
      }

      notify(tx, {
        uid: report.reporterUid,
        type: 'community_reply',
        title: upheld ? 'Your report was upheld' : 'Your report was reviewed',
        body:
          (resolution ?? '').slice(0, 400) ||
          (upheld
            ? 'A steward actioned the content you reported.'
            : 'A steward reviewed the content and took no further action.'),
        link: '/notifications',
      })
    })

    return {
      ...report,
      status,
      resolution: resolution ?? null,
      handledByUid: adminUid,
      handledAt: now.toDate().toISOString(),
      updatedAt: now.toDate().toISOString(),
    } satisfies ModerationReport
  } catch (error) {
    rethrow(error, 'resolveReport')
  }
})

/* ────────────────────────────── resolveDispute ─────────────────────────── */

interface ResolveDisputePayload {
  disputeId?: string
  status?: DisputeCase['status']
  outcome?: string
}

export const resolveDispute = onCall(async (request: CallableRequest<ResolveDisputePayload>) => {
  try {
    const adminUid = requireAdmin(request)
    const { disputeId, status, outcome } = request.data ?? {}
    if (!disputeId) fail('dispute/not-found', 'That dispute could not be found.')
    if (!status || !['resolved_refund', 'resolved_release', 'resolved_split', 'closed'].includes(status)) {
      fail('dispute/not-found', 'Choose a valid resolution.')
    }

    const reference = db.collection(COLLECTIONS.disputes).doc(disputeId)
    const dispute = fromSnapshot<DisputeCase>(await reference.get())
    if (!dispute) fail('dispute/not-found', 'That dispute could not be found.')

    const bookingReference = db.collection(COLLECTIONS.bookings).doc(dispute.bookingId)
    const booking = fromSnapshot<Booking>(await bookingReference.get())
    if (!booking) fail('booking/not-found', 'That booking could not be found.')

    const now = Timestamp.now()
    const alreadyRefunded = booking.settlement.state === 'refunded'

    await db.runTransaction(async (tx) => {
      // Every read happens before the first write (Firestore rejects a
      // transaction that interleaves them). The ledger row and the two wallets
      // are read unconditionally, even for a release or a dismissal, so the
      // branch that moves tokens can be decided without reading again.
      const debitSnapshot = await tx.get(db.collection(COLLECTIONS.transactions).doc(`tx_${booking.id}_debit`))
      const teacherReference = db.collection(COLLECTIONS.wallets).doc(booking.teacherUid)
      const learnerReference = db.collection(COLLECTIONS.wallets).doc(booking.learnerUid)
      const [teacherSnapshot, learnerSnapshot] = [await tx.get(teacherReference), await tx.get(learnerReference)]

      /* ── reads are complete: from here on this transaction only writes ── */

      tx.set(reference, { status, outcome: (outcome ?? '').slice(0, 600), handledByUid: adminUid, updatedAt: now }, { merge: true })

      if (status === 'resolved_release') {
        // Nothing moves: the steward confirms the settlement stands.
        tx.set(
          bookingReference,
          { settlement: { ...booking.settlement, note: `Dispute reviewed and released by steward. ${(outcome ?? '').slice(0, 200)}`.trim() }, updatedAt: now },
          { merge: true },
        )
      } else if (status !== 'closed' && !alreadyRefunded) {
        const settledAmount = debitSnapshot.exists ? Number((debitSnapshot.data() as { amount?: number }).amount ?? 0) : 0

        if (settledAmount > 0) {
          const teacherWallet = fromSnapshot<Wallet>(teacherSnapshot)
          const learnerWallet = fromSnapshot<Wallet>(learnerSnapshot)
          if (!teacherWallet || !learnerWallet) fail('wallet/not-found', 'Wallet records are missing for this session.')

          const refundAmount =
            status === 'resolved_refund' ? settledAmount : roundTokens(Math.max(0, settledAmount / 2))

          const write = buildRefundWrites({
            booking,
            refundAmount,
            teacher: teacherWallet,
            learner: learnerWallet,
            reason: `Dispute resolution (${status.replace(/_/g, ' ')}): ${(outcome ?? '').slice(0, 200) || 'steward decision'}`,
            createdBy: `admin:${adminUid}`,
            policyCode: `dispute_${status}`,
          })

          tx.set(learnerReference, { ...(toFirestore(write.nextLearner) as DocumentData), updatedAt: now }, { merge: true })
          tx.set(
            teacherReference,
            {
              balance: roundTokens(Math.max(0, teacherWallet.balance - refundAmount)),
              lifetimeEarned: roundTokens(Math.max(0, teacherWallet.lifetimeEarned - refundAmount)),
              updatedAt: now,
            },
            { merge: true },
          )

          for (const entry of write.entries) {
            const row: TokenTransaction = {
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
              createdAt: now.toDate().toISOString(),
            }
            tx.set(db.collection(COLLECTIONS.transactions).doc(entry.id), {
              ...(toFirestore(row) as DocumentData),
              createdAt: now,
            })
          }

          tx.set(
            bookingReference,
            {
              settlement: {
                ...booking.settlement,
                state: status === 'resolved_refund' ? 'refunded' : 'partial',
                refundTxId: `tx_${booking.id}_refund`,
                note: `Dispute ${status.replace(/_/g, ' ')} by steward. ${(outcome ?? '').slice(0, 200)}`.trim(),
              },
              updatedAt: now,
            },
            { merge: true },
          )
        }
      }

      const body = (outcome ?? '').slice(0, 400) || `A steward closed the dispute (${status.replace(/_/g, ' ')}).`
      notify(tx, {
        uid: dispute.openedByUid,
        type: 'session_disputed',
        title: 'Your dispute was resolved',
        body,
        link: '/bookings',
        priority: 'high',
      })
      notify(tx, {
        uid: dispute.againstUid,
        type: 'session_disputed',
        title: 'A dispute about your session was resolved',
        body,
        link: '/bookings',
      })
    })

    return {
      ...dispute,
      status,
      outcome: outcome ?? null,
      handledByUid: adminUid,
      updatedAt: now.toDate().toISOString(),
    } satisfies DisputeCase
  } catch (error) {
    rethrow(error, 'resolveDispute')
  }
})
