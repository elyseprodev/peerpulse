import { describe, expect, it } from 'vitest'
import { allowedTransitions, bookingLifecycle, canJoinRoom, findConflict, toConflictCandidate, windowsOverlap } from '@shared'
import type { Booking } from '@shared/domain'

function booking(overrides: Partial<Booking> = {}): Booking {
  const start = new Date(Date.now() + 24 * 3_600_000)
  const end = new Date(start.getTime() + 60 * 60_000)
  return {
    id: 'bk_test',
    skillId: 'skill_1',
    skillTitle: 'Guitar',
    categoryId: 'music',
    teacherUid: 'teacher',
    learnerUid: 'learner',
    participants: ['learner', 'teacher'],
    participantsSnapshot: [],
    createdByUid: 'learner',
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    durationMinutes: 60,
    timezone: 'UTC',
    status: 'confirmed',
    roomId: 'room_bk_test',
    tokenAmount: 1,
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
    learnerNote: '',
    teacherNote: '',
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

const base = new Date('2026-03-10T10:00:00.000Z')
const slot = (startHour: number, endHour: number) => ({
  start: new Date(base.getTime() + startHour * 3_600_000).toISOString(),
  end: new Date(base.getTime() + endHour * 3_600_000).toISOString(),
})

describe('windowsOverlap', () => {
  it('treats back-to-back sessions as non-overlapping', () => {
    expect(windowsOverlap(slot(10, 11), slot(11, 12))).toBe(false)
  })

  it('detects partial and contained overlaps', () => {
    expect(windowsOverlap(slot(10, 11), slot(10.5, 11.5))).toBe(true)
    expect(windowsOverlap(slot(10, 13), slot(11, 12))).toBe(true)
  })

  it('symmetric containment is also an overlap', () => {
    expect(windowsOverlap(slot(11, 12), slot(10, 13))).toBe(true)
  })
})

describe('findConflict', () => {
  it('blocks a booking that overlaps the same teacher', () => {
    const existing = booking({ startAt: slot(10, 11).start, endAt: slot(10, 11).end })
    const candidate = { status: 'requested' as const, teacherUid: 'teacher', learnerUid: 'someone_else', ...slot(10.5, 11.5) }
    expect(findConflict([existing], candidate)?.id).toBe('bk_test')
  })

  it('blocks a booking that overlaps the same learner', () => {
    const existing = booking({ startAt: slot(10, 11).start, endAt: slot(10, 11).end })
    const candidate = { status: 'requested' as const, teacherUid: 'other_teacher', learnerUid: 'learner', ...slot(10.5, 11) }
    expect(findConflict([existing], candidate)).not.toBeNull()
  })

  it('allows a booking at a different time', () => {
    const existing = booking({ startAt: slot(10, 11).start, endAt: slot(10, 11).end })
    const candidate = { status: 'requested' as const, teacherUid: 'teacher', learnerUid: 'learner', ...slot(15, 16) }
    expect(findConflict([existing], candidate)).toBeNull()
  })

  it('ignores cancelled and declined bookings', () => {
    const cancelled = booking({ status: 'cancelled', startAt: slot(10, 11).start, endAt: slot(10, 11).end })
    const candidate = { status: 'requested' as const, teacherUid: 'teacher', learnerUid: 'learner', ...slot(10, 11) }
    expect(findConflict([cancelled], candidate)).toBeNull()
  })

  it('ignores the booking currently being rescheduled', () => {
    const existing = booking({ id: 'bk_self', startAt: slot(10, 11).start, endAt: slot(10, 11).end })
    const candidate = {
      id: 'bk_self',
      status: 'confirmed' as const,
      teacherUid: 'teacher',
      learnerUid: 'learner',
      ...slot(10, 12),
    }
    expect(findConflict([existing], candidate, { ignoreBookingId: 'bk_self' })).toBeNull()
  })

  it('normalises a Booking document into a conflict candidate', () => {
    const candidate = toConflictCandidate(booking())
    expect(candidate.start).toBeTypeOf('string')
    expect(candidate.teacherUid).toBe('teacher')
  })

  it('accepts raw Bookings as well as normalised candidates', () => {
    const existing = booking({ startAt: slot(10, 11).start, endAt: slot(10, 11).end })
    const rawCandidate = booking({ id: 'bk_other', startAt: slot(10.5, 11.5).start, endAt: slot(10.5, 11.5).end })
    expect(findConflict([existing], rawCandidate)?.id).toBe('bk_test')

    const mixed = { id: 'bk_candidate', status: 'requested' as const, teacherUid: 'teacher', learnerUid: 'stranger', ...slot(10.5, 11) }
    expect(findConflict([toConflictCandidate(existing)], mixed)?.id).toBe('bk_test')
  })
})

describe('allowedTransitions', () => {
  it('lets the teacher confirm or decline a request', () => {
    const requested = booking({ status: 'requested' })
    expect(allowedTransitions(requested, 'teacher')).toEqual(['confirmed', 'declined', 'cancelled'])
    expect(allowedTransitions(requested, 'learner')).toEqual(['cancelled'])
  })

  it('denies transitions to non-participants', () => {
    expect(allowedTransitions(booking(), 'stranger')).toEqual([])
  })

  it('allows completion from in_progress', () => {
    expect(allowedTransitions(booking({ status: 'in_progress' }), 'learner')).toEqual(['completed'])
  })

  it('treats completed bookings as terminal', () => {
    expect(allowedTransitions(booking({ status: 'completed' }), 'teacher')).toEqual([])
  })
})

describe('canJoinRoom', () => {
  it('opens 15 minutes early and stays open after the session ends', () => {
    const soon = new Date(Date.now() + 10 * 60_000)
    const open = booking({ startAt: soon.toISOString(), endAt: new Date(soon.getTime() + 3_600_000).toISOString() })
    expect(canJoinRoom(open)).toBe(true)
  })

  it('stays closed well before the session', () => {
    const later = new Date(Date.now() + 5 * 3_600_000)
    const closed = booking({ startAt: later.toISOString(), endAt: new Date(later.getTime() + 3_600_000).toISOString() })
    expect(canJoinRoom(closed)).toBe(false)
  })

  it('refuses rooms for cancelled bookings even inside the window', () => {
    const soon = new Date(Date.now() + 5 * 60_000)
    const cancelled = booking({
      status: 'cancelled',
      startAt: soon.toISOString(),
      endAt: new Date(soon.getTime() + 3_600_000).toISOString(),
    })
    expect(canJoinRoom(cancelled)).toBe(false)
  })
})

describe('bookingLifecycle', () => {
  it('maps statuses to a readable step and tone', () => {
    expect(bookingLifecycle('requested').step).toBe(1)
    expect(bookingLifecycle('completed').label).toContain('settled')
    expect(bookingLifecycle('disputed').tone).toBe('danger')
    expect(bookingLifecycle('no_show').tone).toBe('danger')
  })
})
