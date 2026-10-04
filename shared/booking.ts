/**
 * PeerPulse — booking conflict rules.
 *
 * Double-booking prevention is deliberately expressed as pure functions so the
 * exact same predicate runs:
 *   • client-side, to grey out unavailable slots (UX),
 *   • in the Cloud Function, inside a Firestore transaction (authority).
 * The client copy is a convenience only; the server never trusts it.
 */
import type { Booking, BookingStatus, TimeWindow } from './domain'

/** Statuses that occupy a calendar slot and therefore block new bookings. */
export const BLOCKING_STATUSES: BookingStatus[] = ['requested', 'confirmed', 'in_progress']

/** Smallest gap enforced between two sessions of the same person (minutes). */
export const BUFFER_MINUTES = 0

export function windowsOverlap(a: TimeWindow, b: TimeWindow, bufferMinutes = BUFFER_MINUTES): boolean {
  const aStart = Date.parse(a.start)
  const aEnd = Date.parse(a.end)
  const bStart = Date.parse(b.start) - bufferMinutes * 60_000
  const bEnd = Date.parse(b.end) + bufferMinutes * 60_000
  // Half-open windows: a session ending at 10:00 and another starting at 10:00
  // do not overlap.
  return aStart < bEnd && bStart < aEnd
}

export interface ConflictCandidate extends TimeWindow {
  status: BookingStatus
  teacherUid: string
  learnerUid: string
  id?: string
}

/** Booking documents are conflict candidates once their window is normalised. */
export function toConflictCandidate(booking: Booking): ConflictCandidate {
  return {
    id: booking.id,
    status: booking.status,
    teacherUid: booking.teacherUid,
    learnerUid: booking.learnerUid,
    start: booking.startAt,
    end: booking.endAt,
  }
}

/** A booking document (`startAt`/`endAt`) or an already-normalised candidate. */
export type ConflictInput = Booking | ConflictCandidate

/**
 * Both shapes reach this helper — stored Booking documents and in-flight
 * candidates — so normalise here rather than at every call site. Getting this
 * wrong used to fail silently (no conflict found), which is exactly the bug a
 * double-booking would ride in on.
 */
function windowOf(value: ConflictInput): TimeWindow {
  return 'startAt' in value
    ? { start: value.startAt, end: value.endAt }
    : { start: value.start, end: value.end }
}

/**
 * Returns the first entry that conflicts with `candidate`, or `null`.
 * A conflict is any blocking booking where the same member is either the
 * teacher or the learner.
 */
export function findConflict<T extends ConflictInput>(
  existing: T[],
  candidate: ConflictInput,
  options: { ignoreBookingId?: string; bufferMinutes?: number } = {},
): T | null {
  const candidateWindow = windowOf(candidate)
  for (const booking of existing) {
    if (options.ignoreBookingId && booking.id === options.ignoreBookingId) continue
    if (!BLOCKING_STATUSES.includes(booking.status)) continue
    const sameTeacher = booking.teacherUid === candidate.teacherUid
    const sameLearner = booking.learnerUid === candidate.learnerUid
    if (!sameTeacher && !sameLearner) continue
    if (windowsOverlap(windowOf(booking), candidateWindow, options.bufferMinutes ?? BUFFER_MINUTES)) return booking
  }
  return null
}

/** Statuses a booking may move to, given who is asking. Kept server-authoritative. */
export function allowedTransitions(
  booking: Booking,
  actorUid: string,
): BookingStatus[] {
  const isTeacher = actorUid === booking.teacherUid
  const isLearner = actorUid === booking.learnerUid
  if (!isTeacher && !isLearner) return []
  switch (booking.status) {
    case 'requested':
      return isTeacher ? ['confirmed', 'declined', 'cancelled'] : ['cancelled']
    case 'confirmed':
      return isTeacher ? ['in_progress', 'completed', 'cancelled', 'no_show'] : ['completed', 'cancelled']
    case 'in_progress':
      return ['completed']
    default:
      return []
  }
}

/** True when the booking may still be joined in the video room. */
export function canJoinRoom(booking: Booking, now: Date = new Date(), windowMinutes = 15): boolean {
  if (!booking.roomId) return false
  if (!['confirmed', 'in_progress'].includes(booking.status)) return false
  const opensAt = Date.parse(booking.startAt) - windowMinutes * 60_000
  const closesAt = Date.parse(booking.endAt) + 30 * 60_000
  return now.getTime() >= opensAt && now.getTime() <= closesAt
}

/** Progress of a booking's lifecycle, used by the timeline UI. */
export function bookingLifecycle(status: BookingStatus): { step: number; label: string; tone: 'neutral' | 'brand' | 'danger' } {
  switch (status) {
    case 'requested':
      return { step: 1, label: 'Awaiting confirmation', tone: 'neutral' }
    case 'confirmed':
      return { step: 2, label: 'Confirmed', tone: 'brand' }
    case 'in_progress':
      return { step: 3, label: 'In session', tone: 'brand' }
    case 'completed':
      return { step: 4, label: 'Completed & settled', tone: 'brand' }
    case 'disputed':
      return { step: 4, label: 'In dispute', tone: 'danger' }
    case 'cancelled':
      return { step: 0, label: 'Cancelled', tone: 'neutral' }
    case 'declined':
      return { step: 0, label: 'Declined', tone: 'neutral' }
    case 'no_show':
      return { step: 0, label: 'No-show recorded', tone: 'danger' }
    default:
      return { step: 0, label: status, tone: 'neutral' }
  }
}
