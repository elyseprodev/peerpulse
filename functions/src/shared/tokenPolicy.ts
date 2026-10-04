/**
 * PeerPulse — Time Token policy engine (pure, deterministic, testable).
 *
 * Central principle enforced here:
 *   "1 hour of teaching = 1 Time Token earned = 1 hour of learning credit."
 *
 * Every skill is worth the same time-based credit. There is no price per skill,
 * which is what makes the exchange democratic (Section 8 of the product brief).
 *
 * This module contains no I/O: the Cloud Functions backend, the in-browser
 * reference backend, and the UI all call the same functions, so the amount a
 * member sees before booking is provably the amount the ledger will move.
 */
import type { Booking, PlatformConfig, Wallet } from './domain'

/** Default policy. Mirrors `config/platform` in Firestore and the seed data. */
export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  version: '2026.1',
  token: {
    tokensPerHour: 1,
    partialHourRule: 'nearest',
    roundingIncrementMinutes: 15,
    minSessionMinutes: 15,
    maxSessionMinutes: 180,
    signupGrantEnabled: true,
    signupGrantAmount: 3,
  },
  booking: {
    minNoticeHours: 2,
    maxAdvanceDays: 60,
    autoConfirm: false,
    reserveTokensOnConfirm: false,
    earlyEndToleranceMinutes: 15,
  },
  settlement: {
    minVerifiedMinutes: 10,
    autoSettleAfterHours: 24,
    requireBothConfirmations: true,
    disputeWindowHours: 72,
  },
  cancellation: {
    freeCancellationHours: 24,
    lateCancellationRefundRatio: 1,
    noShowPenaltyTokens: 0,
  },
  community: {
    allowMemberEvents: true,
    autoFlagKeywords: [],
    requireModerationForNewMembers: false,
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedByUid: 'system',
}

export const TOKEN_POLICY_CODES = {
  standardSettlement: 'standard_settlement',
  partialRounding: 'partial_rounding',
  signupGrant: 'signup_grant',
  freeWindowCancellation: 'free_window_cancellation',
  lateCancellation: 'late_cancellation',
  teacherCancellation: 'teacher_cancellation',
  noShowRefund: 'no_show_refund',
  disputeRefund: 'dispute_refund',
  disputeRelease: 'dispute_release',
  adminAdjustment: 'admin_adjustment',
  escrowHold: 'escrow_hold',
} as const

export type TokenPolicyCode = (typeof TOKEN_POLICY_CODES)[keyof typeof TOKEN_POLICY_CODES]

/** Round a positive number to 4 decimals to keep token arithmetic exact-ish. */
export function roundTokens(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/**
 * Convert a session length into Time Tokens.
 *
 * Returns `0` for non-positive or non-finite input; callers must separately
 * validate against `minSessionMinutes`/`maxSessionMinutes`.
 */
export function computeTokenAmount(durationMinutes: number, config: PlatformConfig): number {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0
  const { tokensPerHour, partialHourRule, roundingIncrementMinutes } = config.token
  const increment = Math.max(1, roundingIncrementMinutes)

  let billableMinutes = durationMinutes
  switch (partialHourRule) {
    case 'round_up':
      billableMinutes = Math.ceil(durationMinutes / increment) * increment
      break
    case 'round_down':
      billableMinutes = Math.floor(durationMinutes / increment) * increment
      break
    case 'nearest':
      billableMinutes = Math.round(durationMinutes / increment) * increment
      break
    case 'exact':
    default:
      billableMinutes = durationMinutes
      break
  }

  return roundTokens((billableMinutes / 60) * tokensPerHour)
}

/** Human-readable explanation shown next to every token amount in the UI. */
export function explainTokenAmount(durationMinutes: number, config: PlatformConfig): string {
  const amount = computeTokenAmount(durationMinutes, config)
  const { partialHourRule, roundingIncrementMinutes, tokensPerHour } = config.token
  const rate = tokensPerHour === 1 ? '1 token per hour' : `${tokensPerHour} tokens per hour`
  if (partialHourRule === 'exact' || durationMinutes % 60 === 0) return `${amount} = ${rate}`
  const rounded =
    partialHourRule === 'round_up'
      ? `rounded up to the next ${roundingIncrementMinutes} min`
      : partialHourRule === 'round_down'
        ? `rounded down to the previous ${roundingIncrementMinutes} min`
        : `rounded to the nearest ${roundingIncrementMinutes} min`
  return `${amount} = ${rate}, partial hour ${rounded}`
}

/** Duration validation used by booking creation and by settlement. */
export function validateSessionDuration(durationMinutes: number, config: PlatformConfig): string | null {
  const { minSessionMinutes, maxSessionMinutes } = config.token
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 'Session length must be greater than zero.'
  if (durationMinutes < minSessionMinutes) return `Sessions must last at least ${minSessionMinutes} minutes.`
  if (durationMinutes > maxSessionMinutes) return `Sessions may not exceed ${maxSessionMinutes} minutes.`
  return null
}

export interface CancellationOutcome {
  /** Tokens the learner gets back (from escrow, or waived if nothing was held). */
  refundTokens: number
  /** True when the cancellation happened inside the free window. */
  withinFreeWindow: boolean
  policyCode: TokenPolicyCode
  /** Recorded against the cancelling member's reliability record. */
  strike: boolean
  explanation: string
}

/**
 * Transparent refund rules. Tokens are only ever "in flight" when the platform
 * is configured with escrow (`booking.reserveTokensOnConfirm`); otherwise
 * cancellation simply releases the booking.
 */
export function resolveCancellation(
  booking: Pick<Booking, 'startAt' | 'teacherUid' | 'learnerUid' | 'tokenAmount'>,
  cancelledByUid: string,
  config: PlatformConfig,
  now: Date = new Date(),
): CancellationOutcome {
  const hoursUntilStart = (Date.parse(booking.startAt) - now.getTime()) / 3_600_000
  const freeWindow = config.cancellation.freeCancellationHours
  const isTeacher = cancelledByUid === booking.teacherUid

  if (isTeacher) {
    return {
      refundTokens: booking.tokenAmount,
      withinFreeWindow: true,
      policyCode: TOKEN_POLICY_CODES.teacherCancellation,
      strike: true,
      explanation: 'The teacher cancelled, so the learner keeps all of their Time Tokens and receives a priority rebooking notice.',
    }
  }

  if (hoursUntilStart >= freeWindow) {
    return {
      refundTokens: booking.tokenAmount,
      withinFreeWindow: true,
      policyCode: TOKEN_POLICY_CODES.freeWindowCancellation,
      strike: false,
      explanation: `Cancelled more than ${freeWindow}h before the session — fully refunded, no record against you.`,
    }
  }

  const ratio = Math.min(1, Math.max(0, config.cancellation.lateCancellationRefundRatio))
  return {
    refundTokens: roundTokens(booking.tokenAmount * ratio),
    withinFreeWindow: false,
    policyCode: TOKEN_POLICY_CODES.lateCancellation,
    strike: true,
    explanation:
      ratio >= 1
        ? 'Late cancellation — your Time Tokens are returned in full, but the session is recorded as a late cancellation.'
        : `Late cancellation — ${Math.round(ratio * 100)}% of the reserved tokens are returned per platform policy.`,
  }
}

/**
 * A learner may spend tokens only if the wallet can cover the session, taking
 * escrow holds into account. Negative balances are impossible by construction.
 */
export function availableBalance(wallet: Pick<Wallet, 'balance' | 'held'>): number {
  return roundTokens(Math.max(0, wallet.balance - wallet.held))
}

export function canAfford(wallet: Pick<Wallet, 'balance' | 'held'>, amount: number): boolean {
  return availableBalance(wallet) >= amount - 1e-9
}

/**
 * Signup grant. Documented policy: new members may receive introductory tokens;
 * the amount is configuration, never hard-coded in the client.
 */
/**
 * Human-readable diff of two policies, so an administrator (and the audit trail)
 * can see exactly what a save changed rather than a wall of equal values.
 */
export function describePolicyChange(previous: PlatformConfig, next: PlatformConfig): string[] {
  const changes: string[] = []
  const label = (value: unknown): string => `${Math.round(Number(value) * 100) / 100}`
  type Section = 'token' | 'booking' | 'settlement' | 'cancellation'
  const compare = (section: Section, field: string, format: (value: unknown) => string = (value) => String(value)) => {
    const before = (previous[section] as Record<string, unknown>)[field]
    const after = (next[section] as Record<string, unknown>)[field]
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push(`${section}.${field}: ${format(before)} → ${format(after)}`)
    }
  }

  compare('token', 'tokensPerHour', label)
  compare('token', 'partialHourRule')
  compare('token', 'roundingIncrementMinutes', (v) => `${label(Number(v))} min`)
  compare('token', 'minSessionMinutes', (v) => `${v} min`)
  compare('token', 'maxSessionMinutes', (v) => `${v} min`)
  compare('token', 'signupGrantEnabled')
  compare('token', 'signupGrantAmount', label)
  compare('booking', 'minNoticeHours', (v) => `${v} h`)
  compare('booking', 'maxAdvanceDays', (v) => `${v} days`)
  compare('booking', 'autoConfirm')
  compare('booking', 'reserveTokensOnConfirm')
  compare('booking', 'earlyEndToleranceMinutes', (v) => `${v} min`)
  compare('settlement', 'minVerifiedMinutes', (v) => `${v} min`)
  compare('settlement', 'autoSettleAfterHours', (v) => `${v} h`)
  compare('settlement', 'requireBothConfirmations')
  compare('settlement', 'disputeWindowHours', (v) => `${v} h`)
  compare('cancellation', 'freeCancellationHours', (v) => `${v} h`)
  compare('cancellation', 'lateCancellationRefundRatio', (v) => `${label(Number(v) * 100)}%`)
  compare('cancellation', 'noShowPenaltyTokens', label)

  return changes
}

export function signupGrantAmount(config: PlatformConfig): number {
  return config.token.signupGrantEnabled ? Math.max(0, config.token.signupGrantAmount) : 0
}

/** Booking notice window: how soon / how far ahead a session may be scheduled. */
export function validateBookingWindow(
  startAt: Date,
  endAt: Date,
  config: PlatformConfig,
  now: Date = new Date(),
): string | null {
  const minutesNotice = config.booking.minNoticeHours * 60
  const diffMinutes = (startAt.getTime() - now.getTime()) / 60_000
  if (diffMinutes < minutesNotice) {
    return `Sessions must be booked at least ${config.booking.minNoticeHours} hour(s) in advance.`
  }
  const maxDays = config.booking.maxAdvanceDays
  if (startAt.getTime() > now.getTime() + maxDays * 86_400_000) {
    return `Sessions can only be booked up to ${maxDays} days ahead.`
  }
  if (endAt.getTime() <= startAt.getTime()) return 'The session must end after it starts.'
  return null
}
