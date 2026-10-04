import { describe, expect, it } from 'vitest'
import {
  buildRefundWrites,
  buildSettlementRecord,
  buildSettlementWrites,
  dedupeLedger,
  DEFAULT_PLATFORM_CONFIG,
  ledgerIds,
  mergeWindows,
  overlapMinutes,
  attendedMinutes,
  planSettlement,
  SETTLEMENT_BLOCKED_REASONS,
  settlementRecordId,
  verifyAttendance,
} from '@shared'
import type { AttendanceSegment, Booking, PlatformConfig, Wallet } from '@shared/domain'

const config: PlatformConfig = JSON.parse(JSON.stringify(DEFAULT_PLATFORM_CONFIG))

function wallet(uid: string, balance: number, held = 0): Wallet {
  return {
    uid,
    balance,
    held,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
    lifetimeGranted: 0,
    policyVersion: config.version,
    updatedAt: new Date().toISOString(),
    updatedBy: 'test',
  }
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  const start = new Date(Date.now() - 2 * 3_600_000)
  const end = new Date(start.getTime() + 60 * 60_000)
  return {
    id: 'bk_settle_1',
    skillId: 'skill_1',
    skillTitle: 'Vue fundamentals',
    categoryId: 'technology',
    teacherUid: 'teacher',
    learnerUid: 'learner',
    participants: ['learner', 'teacher'],
    participantsSnapshot: [],
    createdByUid: 'learner',
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    durationMinutes: 60,
    timezone: 'UTC',
    status: 'in_progress',
    roomId: 'room_bk_settle_1',
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
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    ...overrides,
  }
}

const fullAttendance = (booking: Booking): AttendanceSegment[] => [
  { uid: booking.teacherUid, joinedAt: booking.startAt, leftAt: booking.endAt },
  { uid: booking.learnerUid, joinedAt: booking.startAt, leftAt: booking.endAt },
]

describe('window maths', () => {
  it('merges overlapping and adjacent windows', () => {
    const merged = mergeWindows([
      { start: '2026-03-10T10:00:00.000Z', end: '2026-03-10T10:30:00.000Z' },
      { start: '2026-03-10T10:20:00.000Z', end: '2026-03-10T11:00:00.000Z' },
      { start: '2026-03-10T12:00:00.000Z', end: '2026-03-10T12:15:00.000Z' },
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toEqual({ start: '2026-03-10T10:00:00.000Z', end: '2026-03-10T11:00:00.000Z' })
  })

  it('drops invalid windows', () => {
    expect(mergeWindows([{ start: '2026-03-10T11:00:00.000Z', end: '2026-03-10T10:00:00.000Z' }])).toHaveLength(0)
  })

  it('computes overlap minutes between two presence sets', () => {
    const a = [{ start: '2026-03-10T10:00:00.000Z', end: '2026-03-10T10:40:00.000Z' }]
    const b = [{ start: '2026-03-10T10:10:00.000Z', end: '2026-03-10T11:00:00.000Z' }]
    expect(overlapMinutes(a, b)).toBe(30)
  })

  it('clamps attended minutes to the booked window', () => {
    const bookedWindow = { start: '2026-03-10T10:00:00.000Z', end: '2026-03-10T11:00:00.000Z' }
    const segments: AttendanceSegment[] = [
      { uid: 'teacher', joinedAt: '2026-03-10T09:45:00.000Z', leftAt: '2026-03-10T11:30:00.000Z' },
    ]
    expect(attendedMinutes(segments, bookedWindow)).toBe(60)
  })
})

describe('verifyAttendance', () => {
  const booking = makeBooking()

  it('requires both members to be present', () => {
    const verification = verifyAttendance({
      attendance: [{ uid: 'teacher', joinedAt: booking.startAt, leftAt: booking.endAt }],
      teacherUid: 'teacher',
      learnerUid: 'learner',
      booking,
      config,
    })
    expect(verification.verifiedMinutes).toBe(0)
    expect(verification.meetsQuorum).toBe(false)
  })

  it('counts only the overlap when one side joins late', () => {
    const late = new Date(Date.parse(booking.startAt) + 20 * 60_000).toISOString()
    const verification = verifyAttendance({
      attendance: [
        { uid: 'teacher', joinedAt: booking.startAt, leftAt: booking.endAt },
        { uid: 'learner', joinedAt: late, leftAt: booking.endAt },
      ],
      teacherUid: 'teacher',
      learnerUid: 'learner',
      booking,
      config,
    })
    expect(verification.verifiedMinutes).toBe(40)
    expect(verification.meetsQuorum).toBe(true)
  })

  it('treats an open segment as still-running presence', () => {
    const verification = verifyAttendance({
      attendance: [
        { uid: 'teacher', joinedAt: booking.startAt, leftAt: null },
        { uid: 'learner', joinedAt: booking.startAt, leftAt: null },
      ],
      teacherUid: 'teacher',
      learnerUid: 'learner',
      booking,
      config,
      now: new Date(Date.parse(booking.startAt) + 30 * 60_000),
    })
    expect(verification.verifiedMinutes).toBe(30)
  })
})

describe('planSettlement', () => {
  it('settles a completed session with verified attendance', () => {
    const booking = makeBooking()
    const plan = planSettlement({
      booking,
      config,
      attendance: fullAttendance(booking),
      teacherWallet: wallet('teacher', 0),
      learnerWallet: wallet('learner', 3),
    })
    expect(plan.outcome).toBe('settle')
    expect(plan.creditAmount).toBe(1)
    expect(plan.debitAmount).toBe(1)
    expect(plan.verifiedMinutes).toBe(60)
  })

  it('refuses to settle before the session window closes', () => {
    const future = makeBooking({
      startAt: new Date(Date.now() + 3_600_000).toISOString(),
      endAt: new Date(Date.now() + 7_200_000).toISOString(),
    })
    const plan = planSettlement({
      booking: future,
      config,
      attendance: fullAttendance(future),
      teacherWallet: wallet('teacher', 0),
      learnerWallet: wallet('learner', 3),
    })
    expect(plan.outcome).toBe('blocked')
    expect(plan.blockedReason).toBe(SETTLEMENT_BLOCKED_REASONS.tooEarly)
  })

  it('never settles twice', () => {
    const settled = makeBooking({
      settlement: {
        state: 'settled',
        settlementId: 'settlement_bk_settle_1',
        settledAt: new Date().toISOString(),
        debitTxId: 'tx_bk_settle_1_debit',
        creditTxId: 'tx_bk_settle_1_credit',
        refundTxId: null,
        heldTxId: null,
        note: null,
      },
    })
    const plan = planSettlement({
      booking: settled,
      config,
      attendance: fullAttendance(settled),
      teacherWallet: wallet('teacher', 5),
      learnerWallet: wallet('learner', 5),
    })
    expect(plan.outcome).toBe('blocked')
    expect(plan.blockedReason).toBe(SETTLEMENT_BLOCKED_REASONS.alreadySettled)
  })

  it('blocks when attendance is below the quorum and nobody confirmed', () => {
    const booking = makeBooking()
    const tiny = new Date(Date.parse(booking.startAt) + 3 * 60_000).toISOString()
    const plan = planSettlement({
      booking,
      config,
      attendance: [
        { uid: 'teacher', joinedAt: booking.startAt, leftAt: tiny },
        { uid: 'learner', joinedAt: booking.startAt, leftAt: tiny },
      ],
      teacherWallet: wallet('teacher', 0),
      learnerWallet: wallet('learner', 3),
    })
    expect(plan.outcome).toBe('blocked')
    expect(plan.blockedReason).toBe(SETTLEMENT_BLOCKED_REASONS.insufficientAttendance)
  })

  it('trusts an explicit double confirmation when the quorum is missed', () => {
    const booking = makeBooking({
      completion: {
        teacherConfirmedAt: new Date().toISOString(),
        learnerConfirmedAt: new Date().toISOString(),
        autoCompletedAt: null,
        verifiedMinutes: null,
        closedBy: 'participants',
      },
    })
    const plan = planSettlement({
      booking,
      config,
      attendance: [],
      teacherWallet: wallet('teacher', 0),
      learnerWallet: wallet('learner', 3),
      confirmations: { teacher: true, learner: true },
    })
    expect(plan.outcome).toBe('settle')
    expect(plan.reason).toContain('Both members confirmed')
  })

  it('settles partially when the learner cannot cover the full amount', () => {
    const booking = makeBooking()
    const plan = planSettlement({
      booking,
      config,
      attendance: fullAttendance(booking),
      teacherWallet: wallet('teacher', 0),
      learnerWallet: wallet('learner', 0.25),
    })
    expect(plan.outcome).toBe('partial')
    expect(plan.debitAmount).toBe(0.25)
    expect(plan.creditAmount).toBe(0.25)
    expect(plan.reason).toContain('could only cover')
  })

  it('blocks entirely when the learner has nothing available', () => {
    const booking = makeBooking()
    const plan = planSettlement({
      booking,
      config,
      attendance: fullAttendance(booking),
      teacherWallet: wallet('teacher', 0),
      learnerWallet: wallet('learner', 0),
    })
    expect(plan.outcome).toBe('blocked')
    expect(plan.blockedReason).toBe(SETTLEMENT_BLOCKED_REASONS.insufficientBalance)
  })

  it('never touches tokens for cancelled bookings', () => {
    const booking = makeBooking({ status: 'cancelled' })
    const plan = planSettlement({
      booking,
      config,
      attendance: fullAttendance(booking),
      teacherWallet: wallet('teacher', 1),
      learnerWallet: wallet('learner', 1),
    })
    expect(plan.outcome).toBe('blocked')
    expect(plan.blockedReason).toBe(SETTLEMENT_BLOCKED_REASONS.cancelled)
  })

  it('never settles a booking that was only requested', () => {
    const booking = makeBooking({ status: 'requested' })
    const plan = planSettlement({
      booking,
      config,
      attendance: fullAttendance(booking),
      teacherWallet: wallet('teacher', 0),
      learnerWallet: wallet('learner', 3),
    })
    expect(plan.outcome).toBe('blocked')
    expect(plan.blockedReason).toBe(SETTLEMENT_BLOCKED_REASONS.tooEarly)
  })
})

describe('ledger construction', () => {
  it('produces deterministic, idempotent ids', () => {
    expect(ledgerIds('bk_42')).toEqual({
      credit: 'tx_bk_42_credit',
      debit: 'tx_bk_42_debit',
      hold: 'tx_bk_42_hold',
      refund: 'tx_bk_42_refund',
    })
    expect(settlementRecordId('bk_42')).toBe('settlement_bk_42')
  })

  it('debits the learner and credits the teacher by the same amount', () => {
    const booking = makeBooking()
    const plan = planSettlement({
      booking,
      config,
      attendance: fullAttendance(booking),
      teacherWallet: wallet('teacher', 0),
      learnerWallet: wallet('learner', 3),
    })
    const { entries, nextTeacher, nextLearner } = buildSettlementWrites({
      booking,
      plan,
      teacher: wallet('teacher', 0),
      learner: wallet('learner', 3),
      createdBy: 'system:auto_settle',
      reason: 'Completed: Vue fundamentals',
    })

    expect(entries).toHaveLength(2)
    const debit = entries.find((entry) => entry.direction === 'debit')!
    const credit = entries.find((entry) => entry.direction === 'credit')!
    expect(debit.uid).toBe('learner')
    expect(credit.uid).toBe('teacher')
    expect(debit.amount).toBe(credit.amount)
    expect(nextLearner.balance).toBe(2)
    expect(nextTeacher.balance).toBe(1)

    // The ledger row carries the actor, the reason and the policy code so every
    // movement is auditable.
    expect(debit.createdBy).toBe('system:auto_settle')
    expect(debit.idempotencyKey).toBe('tx_bk_settle_1_debit')
    expect(credit.policyCode).toBe('standard_settlement')
  })

  it('releases escrow holds when a hold existed', () => {
    const booking = makeBooking({
      settlement: {
        state: 'escrowed',
        settlementId: null,
        settledAt: null,
        debitTxId: null,
        creditTxId: null,
        refundTxId: null,
        heldTxId: 'tx_bk_settle_1_hold',
        note: null,
      },
    })
    const plan = planSettlement({
      booking,
      config,
      attendance: fullAttendance(booking),
      teacherWallet: wallet('teacher', 0),
      learnerWallet: wallet('learner', 3, 1),
    })
    const { entries, nextLearner } = buildSettlementWrites({
      booking,
      plan,
      teacher: wallet('teacher', 0),
      learner: wallet('learner', 3, 1),
      createdBy: 'system:settle',
      reason: 'settle',
    })
    expect(entries[0].type).toBe('escrow_release')
    expect(nextLearner.held).toBe(0)
    expect(nextLearner.balance).toBe(2)
  })

  it('refunds a cancelled booking into the learner wallet', () => {
    const booking = makeBooking({ status: 'cancelled' })
    const refund = buildRefundWrites({
      booking,
      refundAmount: 1,
      teacher: wallet('teacher', 0),
      learner: wallet('learner', 2, 1),
      reason: 'Cancelled inside the free window',
      createdBy: 'user:learner',
      policyCode: 'free_window_cancellation',
    })
    expect(refund.entries).toHaveLength(1)
    expect(refund.entries[0].type).toBe('refund')
    expect(refund.nextLearner.balance).toBe(3)
  })

  it('writes nothing for a zero-value refund', () => {
    const booking = makeBooking({ status: 'cancelled' })
    const refund = buildRefundWrites({
      booking,
      refundAmount: 0,
      teacher: wallet('teacher', 0),
      learner: wallet('learner', 1),
      reason: 'no-show, no refund',
      createdBy: 'system',
      policyCode: 'no_show',
    })
    expect(refund.entries).toHaveLength(0)
    expect(refund.nextLearner.balance).toBe(1)
  })

  it('builds a settlement record keyed by the booking', () => {
    const booking = makeBooking()
    const plan = planSettlement({
      booking,
      config,
      attendance: fullAttendance(booking),
      teacherWallet: wallet('teacher', 0),
      learnerWallet: wallet('learner', 3),
    })
    const record = buildSettlementRecord(booking, plan)
    expect(record.id).toBe('settlement_bk_settle_1')
    expect(record.idempotencyKey).toBe('settlement_bk_settle_1')
    expect(record.status).toBe('settled')
    expect(record.verifiedMinutes).toBe(60)
  })

  it('drops duplicate ledger entries when merging batches', () => {
    const entries = [{ id: 'a' }, { id: 'b' }, { id: 'a' }]
    expect(dedupeLedger(entries)).toHaveLength(2)
    expect(dedupeLedger(entries, ['a'])).toHaveLength(1)
  })
})
