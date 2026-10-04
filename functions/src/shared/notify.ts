/**
 * Notification composition: who is told what, and in which words.
 *
 * Both backends write notifications — the Cloud Functions through
 * `functions/src/lib/notify.ts`, the local reference backend through
 * `local/notify.ts` — and each used to compose its own copy. They drifted in two
 * ways that a member would see:
 *
 *   • **The wrong person was told.** `bookingCancelledNotification` in the
 *     functions inferred the recipient from `settlement.state`, which identifies
 *     the *actor* in the common case. With the default policy (no escrow) a
 *     learner cancelling a session produced a notification for the learner; the
 *     teacher was never told the session was off. The local backend computed the
 *     counterparty correctly, so the two modes behaved differently.
 *   • **The same event had different types.** A report outcome was
 *     `community_reply` in production and `moderation_action` in local mode; a
 *     steward's balance adjustment was `token_grant` in one and
 *     `moderation_action` in the other. Icons, filters and grouping in the
 *     notification list therefore depended on which backend served the page.
 *
 * Every composer below therefore returns the complete draft — recipient, type,
 * title, body, link and priority — from data both backends already hold. The
 * dates are formatted in UTC with an explicit "UTC" suffix: a notification is
 * written once and read in whatever timezone the member happens to be in, so it
 * states the zone it used rather than silently rendering the server's.
 *
 * `tests/unit/notificationContract.spec.ts` pins the recipient and type for each
 * event, and the same table is asserted against the Cloud Functions in
 * `functions/tests/functions.spec.ts` — because the divergence above survived 43
 * passing functions tests by being invisible from either side alone.
 */
import type { AppNotification, Booking, DisputeCase, IsoDate, NotificationType, UserStatus } from './domain'

export interface NotificationDraft {
  uid: string
  type: NotificationType
  title: string
  body: string
  link: string | null
  priority: AppNotification['priority']
}

/** The join window, fixed at 15 minutes by `canJoinRoom` in `shared/booking.ts`. */
export const ROOM_OPEN_MINUTES_BEFORE = 15

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
}

/** `12 Mar, 18:00–19:00 UTC` — one zone, stated, so the reader is not misled. */
export function formatWindow(startAt: IsoDate, endAt: IsoDate): string {
  const start = new Date(startAt)
  const end = new Date(endAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'an invalid time'
  const startLabel = new Intl.DateTimeFormat('en-GB', DATE_TIME).format(start)
  const sameDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10)
  const endLabel = sameDay
    ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(end)
    : new Intl.DateTimeFormat('en-GB', DATE_TIME).format(end)
  return `${startLabel}–${endLabel} UTC`
}

/** `2 Time Tokens`, `1 Time Token` — the unit is never abbreviated in copy. */
export function tokens(count: number): string {
  return `${count} Time Token${count === 1 ? '' : 's'}`
}

const booking: Pick<NotificationDraft, 'link'> = { link: '/bookings' }
const wallet: Pick<NotificationDraft, 'link'> = { link: '/wallet' }

/* ─────────────────────────── the booking lifecycle ─────────────────────────── */

export function bookingRequestedDraft(booking_: Booking, teacherName: string, learnerName: string): NotificationDraft {
  return {
    uid: booking_.teacherUid,
    type: 'booking_requested',
    title: `${learnerName} asked for ${booking_.skillTitle}`,
    body: `${formatWindow(booking_.startAt, booking_.endAt)} · ${tokens(booking_.tokenAmount)} for ${teacherName}. Confirm or decline it on your bookings page.`,
    ...booking,
    priority: 'high',
  }
}

export function bookingConfirmedDraft(booking_: Booking, teacherName: string): NotificationDraft {
  return {
    uid: booking_.learnerUid,
    type: 'booking_confirmed',
    title: `${teacherName} confirmed your session`,
    body: `${booking_.skillTitle} · ${formatWindow(booking_.startAt, booking_.endAt)}. The room opens ${ROOM_OPEN_MINUTES_BEFORE} minutes before the start.`,
    ...booking,
    priority: 'normal',
  }
}

export function bookingDeclinedDraft(booking_: Booking, teacherName: string, reason: string): NotificationDraft {
  return {
    uid: booking_.learnerUid,
    type: 'booking_declined',
    title: `${teacherName} could not take that slot`,
    body: reason
      ? `Reason: ${reason}`
      : `${booking_.skillTitle} was declined. Try another time or another teacher — your tokens were never touched.`,
    link: '/skills',
    priority: 'normal',
  }
}

/**
 * A cancellation, addressed to the **other** participant.
 *
 * Two decisions live here, and both used to be wrong in production:
 *
 *   • `actorUid` is the member who cancelled and the recipient is whoever they
 *     are not — not `settlement.state`, which identifies the actor.
 *   • The refund goes back to the learner, because the learner is the member
 *     who paid. Someone told that tokens "were returned to your balance" must
 *     therefore be the learner; the teacher is told that the session is off and
 *     what happened to the credit. The type follows the same rule, because a
 *     feed icon describes what this message did *for the reader*.
 */
export function bookingCancelledDraft(
  booking_: Booking,
  actorUid: string,
  actorName: string,
  refundTokens: number,
  policyCode: string,
  explanation?: string,
): NotificationDraft {
  const recipientUid = actorUid === booking_.teacherUid ? booking_.learnerUid : booking_.teacherUid
  // `refundTokens` is what the *policy* says the learner keeps — which is every
  // token of a session that was never charged in the first place, because the
  // default policy reserves nothing on confirm. Only a written refund row means
  // a balance actually changed, and promising a member tokens that never left
  // their wallet is exactly the kind of copy that erodes trust in the ledger.
  const tokensReturned = Boolean(booking_.settlement.refundTxId)
  const refundedToRecipient = tokensReturned && recipientUid === booking_.learnerUid
  const policy = policyCode.replace(/_/g, ' ')
  const trailing = explanation ? ` ${explanation}` : ''
  const body = refundedToRecipient
    ? `${tokens(refundTokens)} were returned to your balance (policy: ${policy}).${trailing}`
    : tokensReturned
      ? `The session is off. The learner's ${tokens(refundTokens).toLowerCase()} were returned (policy: ${policy}).${trailing}`
      : `Nothing was charged (policy: ${policy}).${trailing}`
  return {
    uid: recipientUid,
    type: refundedToRecipient ? 'session_refunded' : 'booking_cancelled',
    title: `${actorName} cancelled ${booking_.skillTitle}`,
    body,
    ...(refundedToRecipient ? wallet : booking),
    priority: 'high',
  }
}

export function bookingRescheduledDraft(booking_: Booking, actorUid: string, actorName: string): NotificationDraft {
  const recipientUid = actorUid === booking_.teacherUid ? booking_.learnerUid : booking_.teacherUid
  return {
    uid: recipientUid,
    type: 'booking_rescheduled',
    title: `${actorName} moved ${booking_.skillTitle}`,
    body: `New time: ${formatWindow(booking_.startAt, booking_.endAt)}. Check that it still works for you.`,
    ...booking,
    priority: 'high',
  }
}

/**
 * The reminder before a confirmed session, addressed to one participant at a
 * time — both of them need to be told, and each needs the other's name.
 */
export function bookingReminderDraft(
  booking_: Booking,
  recipientUid: string,
  counterpartyName: string,
  startsInMinutes: number,
): NotificationDraft {
  const soon = startsInMinutes <= 0 ? 'now' : `in ${startsInMinutes} minute${startsInMinutes === 1 ? '' : 's'}`
  return {
    uid: recipientUid,
    type: 'booking_reminder',
    title: `${booking_.skillTitle} starts ${soon}`,
    body: `${formatWindow(booking_.startAt, booking_.endAt)} with ${counterpartyName}. The room opens ${ROOM_OPEN_MINUTES_BEFORE} minutes before the start.`,
    ...booking,
    priority: 'high',
  }
}

/* ─────────────────────────────── settlement ─────────────────────────────── */

export function sessionSettledDraft(
  booking_: Booking,
  tokensMoved: number,
  role: 'teacher' | 'learner',
  balanceAfter?: number,
): NotificationDraft {
  const balance = balanceAfter === undefined ? '' : ` Your balance is now ${balanceAfter}.`
  return {
    uid: role === 'teacher' ? booking_.teacherUid : booking_.learnerUid,
    type: 'session_settled',
    title: role === 'teacher' ? `You earned ${tokens(tokensMoved)}` : `Settled: ${tokens(tokensMoved)} spent`,
    body:
      role === 'teacher'
        ? `${booking_.skillTitle} is settled.${balance} Spend your tokens on something you want to learn.`
        : `${booking_.skillTitle} is settled.${balance} The full ledger is on your wallet page.`,
    ...wallet,
    priority: 'normal',
  }
}

export function pendingCompletionDraft(booking_: Booking): NotificationDraft {
  // Addressed to whoever still has to confirm — the side that already did is
  // not asked twice.
  const uid = booking_.completion.teacherConfirmedAt && !booking_.completion.learnerConfirmedAt
    ? booking_.learnerUid
    : booking_.teacherUid
  return {
    uid: uid,
    type: 'session_settled',
    title: 'Confirm your session to release the tokens',
    body: `${booking_.skillTitle} ran for ${booking_.durationMinutes} minutes but the automatic check could not verify enough attendance. Confirm it, or open a dispute if something went wrong.`,
    ...booking,
    priority: 'high',
  }
}

/** A refund that is not a cancellation — a steward's decision on a dispute. */
export function refundIssuedDraft(booking_: Booking, refundTokens: number, explanation: string): NotificationDraft {
  return {
    uid: booking_.learnerUid,
    type: 'session_refunded',
    title: `${tokens(refundTokens)} returned to your balance`,
    body: `${booking_.skillTitle}: ${explanation || 'a steward refunded this session.'}`,
    ...wallet,
    priority: 'high',
  }
}

/* ──────────────────────────────── disputes ──────────────────────────────── */

export function disputeRaisedDraft(dispute: DisputeCase, openedByName: string): NotificationDraft {
  return {
    uid: dispute.againstUid,
    type: 'session_disputed',
    title: `${openedByName} opened a dispute about your session`,
    body: dispute.claim.slice(0, 400) || 'A steward will look at the session and decide what happens to the tokens.',
    ...booking,
    priority: 'high',
  }
}

export function disputeResolvedDraft(dispute: DisputeCase, forOpener: boolean, outcome: string): NotificationDraft {
  return {
    uid: forOpener ? dispute.openedByUid : dispute.againstUid,
    type: 'session_disputed',
    title: forOpener ? 'Your dispute was resolved' : 'A dispute about your session was resolved',
    body: outcome.slice(0, 400) || `A steward closed the dispute (${dispute.status.replace(/_/g, ' ')}).`,
    ...booking,
    priority: forOpener ? 'high' : 'normal',
  }
}

/* ───────────────────────── reviews, communities, moderation ───────────────────────── */

/**
 * A review is addressed to the member it is *about* — the subject — and the
 * recipient is taken from the review rather than inferred from the booking,
 * because the same session can produce two reviews in opposite directions.
 */
export function reviewReceivedDraft(input: {
  subjectUid: string
  authorName: string
  rating: number
  comment: string
  skillTitle: string
}): NotificationDraft {
  return {
    uid: input.subjectUid,
    type: 'review_received',
    title: `${input.authorName} rated your session ${input.rating}/5`,
    body: input.comment.trim() || `${input.skillTitle} — you can reply to this review from your profile.`,
    link: `/members/${input.subjectUid}`,
    priority: 'normal',
  }
}

/**
 * Someone replied to your post.
 *
 * This is the event `community_reply` is named after — and it was the one event
 * that did *not* produce it, because posts and comments are written by clients
 * and nothing was watching. The type was being borrowed for steward messages
 * instead. Both backends now notify the post's author, and the type means what it
 * says.
 */
export function commentReplyDraft(input: {
  recipientUid: string
  authorName: string
  communityId: string
  postId: string
  postTitle: string
  commentBody: string
}): NotificationDraft {
  return {
    uid: input.recipientUid,
    type: 'community_reply',
    title: `${input.authorName} replied to ${input.postTitle}`,
    body: `“${input.commentBody.slice(0, 240)}”`,
    link: `/communities/${input.communityId}?post=${input.postId}`,
    priority: 'normal',
  }
}

export function reportResolvedDraft(input: {
  reporterUid: string
  upheld: boolean
  resolution: string
}): NotificationDraft {
  return {
    uid: input.reporterUid,
    type: 'moderation_action',
    title: input.upheld ? 'Your report was upheld' : 'Your report was reviewed',
    body:
      input.resolution.slice(0, 400) ||
      (input.upheld
        ? 'A steward actioned the content you reported.'
        : 'A steward reviewed the content and took no further action.'),
    link: '/notifications',
    priority: 'normal',
  }
}

/* ───────────────────────────── tokens and accounts ───────────────────────────── */

export function tokenGrantDraft(uid: string, amount: number, reason: string, options: { signup?: boolean } = {}): NotificationDraft {
  if (options.signup) {
    return {
      uid,
      type: 'token_grant',
      title: `${tokens(amount)} added to your wallet`,
      body: 'Trade an hour of what you know for an hour of what you want to learn. Publish a listing to get started.',
      ...wallet,
      priority: 'normal',
    }
  }
  return {
    uid,
    type: 'token_grant',
    title: amount >= 0 ? `${tokens(amount)} added by a steward` : `${tokens(Math.abs(amount))} removed by a steward`,
    body: reason.trim().slice(0, 300) || 'No reason was recorded.',
    ...wallet,
    priority: 'high',
  }
}

/** Role and account-status changes are platform messages, not community ones. */
export function roleChangedDraft(uid: string, role: 'member' | 'admin', changedByUid: string): NotificationDraft {
  return {
    uid,
    type: 'system',
    title: role === 'admin' ? 'You are now a steward' : 'Your steward role was removed',
    body:
      role === 'admin'
        ? 'You can now resolve reports and disputes, adjust wallets with a reason, and edit the token policy.'
        : `Your account is a member account again. Changed by ${changedByUid}.`,
    link: role === 'admin' ? '/admin' : '/dashboard',
    priority: 'high',
  }
}

export function accountStatusChangedDraft(uid: string, status: UserStatus, reason: string): NotificationDraft {
  const active = status === 'active'
  return {
    uid,
    type: 'system',
    title: active ? 'Your account is active again' : 'Your account was suspended',
    body: reason.slice(0, 400) || 'Contact a steward if you would like this reviewed.',
    link: '/settings',
    priority: active ? 'normal' : 'high',
  }
}
