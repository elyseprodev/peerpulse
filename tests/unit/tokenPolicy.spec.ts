import { describe, expect, it } from 'vitest'
import {
  availableBalance,
  canAfford,
  computeTokenAmount,
  DEFAULT_PLATFORM_CONFIG,
  explainTokenAmount,
  resolveCancellation,
  roundTokens,
  signupGrantAmount,
  validateBookingWindow,
  validateSessionDuration,
} from '@shared'
import type { Booking, PlatformConfig } from '@shared/domain'

const config: PlatformConfig = JSON.parse(JSON.stringify(DEFAULT_PLATFORM_CONFIG))

describe('computeTokenAmount', () => {
  it('gives exactly one token for a standard hour', () => {
    expect(computeTokenAmount(60, config)).toBe(1)
  })

  it('applies the configured rounding rule for partial hours', () => {
    // Default policy: nearest 15 minutes.
    expect(computeTokenAmount(45, config)).toBe(0.75)
    expect(computeTokenAmount(90, config)).toBe(1.5)
    expect(computeTokenAmount(50, config)).toBe(0.75) // 50 → 45
    expect(computeTokenAmount(53, config)).toBe(1) // 53 → 60
  })

  it('honours an "exact" policy without rounding', () => {
    const exact = { ...config, token: { ...config.token, partialHourRule: 'exact' as const } }
    expect(computeTokenAmount(50, exact)).toBeCloseTo(0.8333, 4)
  })

  it('honours round_up and round_down policies', () => {
    const up = { ...config, token: { ...config.token, partialHourRule: 'round_up' as const } }
    const down = { ...config, token: { ...config.token, partialHourRule: 'round_down' as const } }
    expect(computeTokenAmount(50, up)).toBe(1)
    expect(computeTokenAmount(50, down)).toBe(0.75)
  })

  it('scales with a non-default tokens-per-hour rate', () => {
    const doubled = { ...config, token: { ...config.token, tokensPerHour: 2 } }
    expect(computeTokenAmount(60, doubled)).toBe(2)
  })

  it('returns 0 for invalid durations instead of NaN', () => {
    expect(computeTokenAmount(0, config)).toBe(0)
    expect(computeTokenAmount(-30, config)).toBe(0)
    expect(computeTokenAmount(Number.NaN, config)).toBe(0)
  })

  it('never loses precision through repeated arithmetic', () => {
    expect(roundTokens(0.1 + 0.2)).toBe(0.3)
  })
})

describe('explainTokenAmount', () => {
  it('explains whole hours simply', () => {
    expect(explainTokenAmount(60, config)).toBe('1 = 1 token per hour')
  })

  it('mentions the rounding rule for partial hours', () => {
    expect(explainTokenAmount(45, config)).toContain('rounded to the nearest 15 min')
  })
})

describe('duration and window validation', () => {
  it('rejects sessions shorter than the minimum', () => {
    expect(validateSessionDuration(10, config)).toContain('at least 15 minutes')
  })

  it('rejects sessions longer than the maximum', () => {
    expect(validateSessionDuration(200, config)).toContain('may not exceed 180 minutes')
  })

  it('accepts a normal session', () => {
    expect(validateSessionDuration(60, config)).toBeNull()
  })

  it('enforces the minimum notice window', () => {
    const now = new Date('2026-03-04T10:00:00.000Z')
    const error = validateBookingWindow(new Date('2026-03-04T11:00:00.000Z'), new Date('2026-03-04T12:00:00.000Z'), config, now)
    expect(error).toContain('at least 2 hour(s) in advance')
  })

  it('enforces the maximum advance window', () => {
    const now = new Date('2026-03-04T10:00:00.000Z')
    const error = validateBookingWindow(new Date('2026-08-04T10:00:00.000Z'), new Date('2026-08-04T11:00:00.000Z'), config, now)
    expect(error).toContain('up to 60 days ahead')
  })
})

describe('wallet maths', () => {
  it('subtracts escrow holds from the spendable balance', () => {
    expect(availableBalance({ balance: 3, held: 1 })).toBe(2)
  })

  it('never reports a negative available balance', () => {
    expect(availableBalance({ balance: 0.5, held: 2 })).toBe(0)
  })

  it('refuses bookings the wallet cannot cover', () => {
    expect(canAfford({ balance: 1, held: 0 }, 1)).toBe(true)
    expect(canAfford({ balance: 1, held: 1 }, 1)).toBe(false)
  })

  it('computes the configured signup grant', () => {
    expect(signupGrantAmount(config)).toBe(3)
    const disabled = { ...config, token: { ...config.token, signupGrantEnabled: false } }
    expect(signupGrantAmount(disabled)).toBe(0)
  })
})

describe('resolveCancellation', () => {
  const booking: Pick<Booking, 'startAt' | 'teacherUid' | 'learnerUid' | 'tokenAmount'> = {
    startAt: new Date(Date.now() + 48 * 3_600_000).toISOString(),
    teacherUid: 'teacher',
    learnerUid: 'learner',
    tokenAmount: 1,
  }

  it('refunds in full inside the free window', () => {
    const outcome = resolveCancellation(booking, 'learner', config)
    expect(outcome.refundTokens).toBe(1)
    expect(outcome.withinFreeWindow).toBe(true)
    expect(outcome.strike).toBe(false)
  })

  it('refunds a late learner cancellation according to policy', () => {
    const late = { ...booking, startAt: new Date(Date.now() + 30 * 60_000).toISOString() }
    const outcome = resolveCancellation(late, 'learner', config)
    expect(outcome.withinFreeWindow).toBe(false)
    expect(outcome.strike).toBe(true)
    expect(outcome.refundTokens).toBe(1) // default ratio is 1 (documented as configurable)
  })

  it('applies a partial ratio when configured', () => {
    const strict = { ...config, cancellation: { ...config.cancellation, lateCancellationRefundRatio: 0.5 } }
    const late = { ...booking, startAt: new Date(Date.now() + 30 * 60_000).toISOString() }
    expect(resolveCancellation(late, 'learner', strict).refundTokens).toBe(0.5)
  })

  it('always refunds the learner when the teacher cancels', () => {
    const late = { ...booking, startAt: new Date(Date.now() + 30 * 60_000).toISOString() }
    const outcome = resolveCancellation(late, 'teacher', config)
    expect(outcome.refundTokens).toBe(1)
    expect(outcome.policyCode).toBe('teacher_cancellation')
  })
})
