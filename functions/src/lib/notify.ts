/**
 * Transactional notification + notification-content helpers.
 *
 * Every member-facing message the platform sends is composed here so the wording
 * stays consistent between the Cloud Functions and the reference backend.
 */
import { Timestamp, type DocumentData, type Transaction } from 'firebase-admin/firestore'
import type { AppNotification, Booking, DisputeCase, UserStatus } from '../shared/domain'
import {
  ROOM_OPEN_MINUTES_BEFORE,
  accountStatusChangedDraft,
  bookingCancelledDraft,
  bookingConfirmedDraft,
  bookingDeclinedDraft,
  bookingReminderDraft,
  bookingRequestedDraft,
  bookingRescheduledDraft,
  commentReplyDraft,
  disputeRaisedDraft,
  disputeResolvedDraft,
  pendingCompletionDraft,
  refundIssuedDraft,
  reportResolvedDraft,
  reviewReceivedDraft,
  roleChangedDraft,
  sessionSettledDraft,
  tokenGrantDraft,
  type NotificationDraft,
} from '../shared/notify'
import { COLLECTIONS, db } from './refs'

export interface NotifyInput {
  uid: string
  type: AppNotification['type']
  title: string
  body: string
  link?: string | null
  priority?: AppNotification['priority']
}

function payload(input: NotifyInput): DocumentData {
  return {
    uid: input.uid,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link ?? null,
    read: false,
    priority: input.priority ?? 'normal',
    createdAt: Timestamp.now(),
  }
}

/** Queued inside the caller's transaction, so a notification never outlives its cause. */
export function notify(tx: Transaction, input: NotifyInput): void {
  tx.set(db.collection(COLLECTIONS.notifications).doc(), payload(input))
}

export function notifyMany(tx: Transaction, inputs: NotifyInput[]): void {
  inputs.forEach((input) => notify(tx, input))
}

/** Fire-and-forget variant for paths that are not already transactional. */
/**
 * Writes outside a transaction. `id` may be given when the send must be
 * idempotent: a retried or redeployed trigger then cannot send twice, because
 * `set` on an existing id overwrites rather than duplicates. The reminder sweep
 * uses this; every other caller lets Firestore mint the id.
 */
export async function notifyNow(input: NotifyInput, id?: string): Promise<void> {
  const collection = db.collection(COLLECTIONS.notifications)
  const reference = id ? collection.doc(id) : collection.doc()
  await reference.set(payload(input))
}

/* ───────────────────────── message composition ───────────────────────── */

/**
 * The wording and the recipient of every notification live in
 * `shared/notify.ts`, which the local reference backend composes from too. The
 * wrappers below only add the two things this side needs: a `NotifyInput` shape
 * the transaction helpers accept, and — where the app knows it — the balance the
 * member is left with.
 *
 * The recipient logic used to live here and was wrong: it inferred who to tell
 * from `settlement.state`, which identifies the member who *acted* rather than
 * the one who needs to know. See the note at the top of `shared/notify.ts`.
 */
function toInput(draft: NotificationDraft): NotifyInput {
  return {
    uid: draft.uid,
    type: draft.type,
    title: draft.title,
    body: draft.body,
    link: draft.link,
    priority: draft.priority,
  }
}

/** Every notification this file offers, for the contract test in functions/tests. */
export const COMPOSERS = {
  bookingRequested: (booking: Booking, teacherName: string, learnerName: string): NotifyInput =>
    toInput(bookingRequestedDraft(booking, teacherName, learnerName)),
  bookingConfirmed: (booking: Booking, teacherName: string): NotifyInput =>
    toInput(bookingConfirmedDraft(booking, teacherName)),
  bookingDeclined: (booking: Booking, teacherName: string, reason: string): NotifyInput =>
    toInput(bookingDeclinedDraft(booking, teacherName, reason)),
  bookingCancelled: (
    booking: Booking,
    actorUid: string,
    actorName: string,
    refundTokens: number,
    policyCode: string,
    explanation?: string,
  ): NotifyInput => toInput(bookingCancelledDraft(booking, actorUid, actorName, refundTokens, policyCode, explanation)),
  bookingRescheduled: (booking: Booking, actorUid: string, actorName: string): NotifyInput =>
    toInput(bookingRescheduledDraft(booking, actorUid, actorName)),
  bookingReminder: (booking: Booking, recipientUid: string, counterpartyName: string, startsInMinutes: number): NotifyInput =>
    toInput(bookingReminderDraft(booking, recipientUid, counterpartyName, startsInMinutes)),
  sessionSettled: (booking: Booking, tokensMoved: number, role: 'teacher' | 'learner', balanceAfter?: number): NotifyInput =>
    toInput(sessionSettledDraft(booking, tokensMoved, role, balanceAfter)),
  pendingCompletion: (booking: Booking): NotifyInput => toInput(pendingCompletionDraft(booking)),
  refundIssued: (booking: Booking, refundTokens: number, explanation: string): NotifyInput =>
    toInput(refundIssuedDraft(booking, refundTokens, explanation)),
  disputeRaised: (dispute: DisputeCase, openedByName: string): NotifyInput => toInput(disputeRaisedDraft(dispute, openedByName)),
  disputeResolved: (dispute: DisputeCase, forOpener: boolean, outcome: string): NotifyInput =>
    toInput(disputeResolvedDraft(dispute, forOpener, outcome)),
  reviewReceived: (input: { subjectUid: string; authorName: string; rating: number; comment: string; skillTitle: string }): NotifyInput =>
    toInput(reviewReceivedDraft(input)),
  commentReply: (input: Parameters<typeof commentReplyDraft>[0]): NotifyInput => toInput(commentReplyDraft(input)),
  reportResolved: (input: { reporterUid: string; upheld: boolean; resolution: string }): NotifyInput =>
    toInput(reportResolvedDraft(input)),
  tokenGrant: (uid: string, amount: number, reason: string, options: { signup?: boolean } = {}): NotifyInput =>
    toInput(tokenGrantDraft(uid, amount, reason, options)),
  roleChanged: (uid: string, role: 'member' | 'admin', changedByUid: string): NotifyInput =>
    toInput(roleChangedDraft(uid, role, changedByUid)),
  accountStatusChanged: (uid: string, status: UserStatus, reason: string): NotifyInput =>
    toInput(accountStatusChangedDraft(uid, status, reason)),
}

/* The historical function names, kept so the call sites read the same. */

export const bookingRequestedNotification = COMPOSERS.bookingRequested
export const bookingConfirmedNotification = COMPOSERS.bookingConfirmed
export const bookingDeclinedNotification = COMPOSERS.bookingDeclined
export const bookingRescheduledNotification = COMPOSERS.bookingRescheduled
export const reminderNotification = COMPOSERS.bookingReminder
export const sessionSettledNotification = COMPOSERS.sessionSettled
export const pendingCompletionNotification = COMPOSERS.pendingCompletion
export const reviewReceivedNotification = COMPOSERS.reviewReceived
export const reportResolvedNotification = COMPOSERS.reportResolved
export const refundIssuedNotification = COMPOSERS.refundIssued
export const disputeRaisedNotification = COMPOSERS.disputeRaised
export const disputeResolvedNotification = COMPOSERS.disputeResolved

/**
 * A cancellation, addressed to the other participant. The recipient is derived
 * from who cancelled, not from whether escrow happened to be in play.
 */
export function bookingCancelledNotification(
  booking: Booking,
  actorName: string,
  refundTokens: number,
  policyCode: string,
  explanation?: string,
): NotifyInput {
  const actorUid = booking.cancellation?.byUid ?? booking.createdByUid
  return COMPOSERS.bookingCancelled(booking, actorUid, actorName, refundTokens, policyCode, explanation)
}

export { ROOM_OPEN_MINUTES_BEFORE }
export type { NotificationDraft }
