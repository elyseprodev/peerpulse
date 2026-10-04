/**
 * Transactional notification + notification-content helpers.
 *
 * Every member-facing message the platform sends is composed here so the wording
 * stays consistent between the Cloud Functions and the reference backend.
 */
import { Timestamp, type DocumentData, type Transaction } from 'firebase-admin/firestore'
import type { AppNotification, Booking, PlatformConfig } from '../shared/domain'
import { formatDateTimeRange } from './format'
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
export async function notifyNow(input: NotifyInput): Promise<void> {
  await db.collection(COLLECTIONS.notifications).doc().set(payload(input))
}

/* ───────────────────────── message composition ───────────────────────── */

export function bookingRequestedNotification(booking: Booking, teacherName: string, learnerName: string): NotifyInput {
  return {
    uid: booking.teacherUid,
    type: 'booking_requested',
    title: `${learnerName} asked for ${booking.skillTitle}`,
    body: `${formatDateTimeRange(booking.startAt, booking.endAt)} · ${booking.tokenAmount} Time Token(s) for ${teacherName}. Confirm or decline it on your bookings page.`,
    link: '/bookings',
    priority: 'high',
  }
}

/**
 * The join window is fixed at 15 minutes by `canJoinRoom` in shared/booking.ts,
 * which is also what the UI and the `openRoom` function enforce.
 */
export const ROOM_OPEN_MINUTES_BEFORE = 15

export function bookingConfirmedNotification(booking: Booking, teacherName: string): NotifyInput {
  return {
    uid: booking.learnerUid,
    type: 'booking_confirmed',
    title: `${teacherName} confirmed your session`,
    body: `${booking.skillTitle} · ${formatDateTimeRange(booking.startAt, booking.endAt)}. The room opens ${ROOM_OPEN_MINUTES_BEFORE} minutes before the start — you will see the join button on your bookings page.`,
    link: '/bookings',
  }
}

export function bookingDeclinedNotification(booking: Booking, teacherName: string, reason: string): NotifyInput {
  return {
    uid: booking.learnerUid,
    type: 'booking_declined',
    title: `${teacherName} could not take that slot`,
    body: reason
      ? `Reason: ${reason}`
      : `${booking.skillTitle} was declined. Try another time or another teacher — your tokens were never touched.`,
    link: '/skills',
  }
}

export function bookingCancelledNotification(booking: Booking, byName: string, refundTokens: number, policyCode: string): NotifyInput {
  const counterpartyUid = booking.settlement.state === 'refunded' ? booking.teacherUid : booking.learnerUid
  return {
    uid: counterpartyUid,
    type: 'booking_cancelled',
    title: `${byName} cancelled ${booking.skillTitle}`,
    body:
      refundTokens > 0
        ? `${refundTokens} Time Token(s) were returned under the ${policyCode.replace(/_/g, ' ')} policy.`
        : `Nothing was charged (policy: ${policyCode.replace(/_/g, ' ')}).`,
    link: '/bookings',
  }
}

export function bookingRescheduledNotification(booking: Booking, byName: string): NotifyInput {
  return {
    uid: booking.learnerUid === booking.createdByUid ? booking.teacherUid : booking.learnerUid,
    type: 'booking_rescheduled',
    title: `${byName} moved ${booking.skillTitle}`,
    body: `New time: ${formatDateTimeRange(booking.startAt, booking.endAt)}.`,
    link: '/bookings',
    priority: 'high',
  }
}

export function sessionSettledNotification(booking: Booking, tokens: number, role: 'teacher' | 'learner'): NotifyInput {
  return {
    uid: role === 'teacher' ? booking.teacherUid : booking.learnerUid,
    type: 'session_settled',
    title: role === 'teacher' ? `You earned ${tokens} Time Token(s)` : `Settled: ${tokens} Time Token(s) spent`,
    body:
      role === 'teacher'
        ? `${booking.skillTitle} is settled. Spend your tokens on something you want to learn.`
        : `${booking.skillTitle} is settled. Your balance and the full ledger are on your wallet page.`,
    link: '/wallet',
  }
}

export function pendingCompletionNotification(booking: Booking): NotifyInput {
  const minutes = booking.durationMinutes
  return {
    uid: booking.teacherUid,
    type: 'session_settled',
    title: 'Confirm your session to release the tokens',
    body: `${booking.skillTitle} ran for ${minutes} minutes but the automatic check could not verify enough attendance. Confirm it, or open a dispute if something went wrong.`,
    link: '/bookings',
    priority: 'high',
  }
}

export function reminderNotification(booking: Booking, config: PlatformConfig): NotifyInput {
  return {
    uid: booking.teacherUid,
    type: 'booking_reminder',
    title: `Session soon: ${booking.skillTitle}`,
    body: `Starts ${formatDateTimeRange(booking.startAt, booking.endAt)}. Your room is ready — the join button unlocks ${ROOM_OPEN_MINUTES_BEFORE} minutes before the start (policy ${config.version}).`,
    link: '/bookings',
  }
}
