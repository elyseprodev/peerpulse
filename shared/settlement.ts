/**
 * PeerPulse — automatic token settlement (Section 11 of the product brief).
 *
 * Design guarantees encoded here (all pure functions, all unit-tested):
 *
 *  1. NEVER trust a client timer. The amount moved is derived from the booking
 *     document the server itself wrote, and from attendance heartbeats that only
 *     the participants' own authenticated room documents can produce.
 *  2. Idempotency by construction. Ledger document ids are deterministic
 *     (`tx_{bookingId}_credit`), and the settlement record id is
 *     `settlement_{bookingId}`, so a retried or duplicated invocation can only
 *     ever produce the same writes — never a second credit.
 *  3. Atomicity. The debit, the credit and the settlement record are applied in
 *     one Firestore transaction fired by a Cloud Function; the client has no
 *     write access to `wallets` or `tokenTransactions` at all.
 *  4. A dispute path exists for every settled session.
 */
import { TOKEN_POLICY_CODES } from './tokenPolicy'
import type {
  AttendanceSegment,
  Booking,
  PlatformConfig,
  SettlementRecord,
  TimeWindow,
  TokenTransactionType,
  UserStats,
  Wallet,
} from './domain'
import { roundTokens } from './tokenPolicy'

export const SETTLEMENT_BLOCKED_REASONS = {
  alreadySettled: 'already_settled',
  cancelled: 'cancelled',
  tooEarly: 'session_not_finished',
  insufficientAttendance: 'insufficient_verified_attendance',
  insufficientBalance: 'insufficient_balance',
  notParticipant: 'not_a_participant',
  invalidAmount: 'invalid_token_amount',
  duplicate: 'duplicate_settlement',
} as const

export type SettlementBlockedReason = (typeof SETTLEMENT_BLOCKED_REASONS)[keyof typeof SETTLEMENT_BLOCKED_REASONS]

export type SettlementOutcome = 'settle' | 'partial' | 'refund' | 'blocked'

export interface SettlementPlan {
  outcome: SettlementOutcome
  /** Tokens the session is worth under the active policy. */
  tokenAmount: number
  /** Tokens actually credited to the teacher. */
  creditAmount: number
  /** Tokens actually debited from the learner. */
  debitAmount: number
  /** Tokens returned to the learner (cancellations / blocked sessions). */
  refundAmount: number
  verifiedMinutes: number
  policyCode: string
  /** Machine-readable explanation, shown in the UI and stored on the record. */
  reason: string
  /** Set only when `outcome === 'blocked'`. */
  blockedReason?: SettlementBlockedReason
}

/* ─────────────────────────── Attendance maths ─────────────────────────── */

function toWindow(segment: AttendanceSegment): TimeWindow {
  return { start: segment.joinedAt, end: segment.leftAt ?? new Date().toISOString() }
}

/** Merge overlapping/adjacent windows into a minimal disjoint set. */
export function mergeWindows(windows: TimeWindow[]): TimeWindow[] {
  const sorted = windows
    .map((w) => ({ start: Date.parse(w.start), end: Date.parse(w.end) }))
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start)

  const merged: { start: number; end: number }[] = []
  for (const w of sorted) {
    const last = merged[merged.length - 1]
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end)
    else merged.push({ ...w })
  }
  return merged.map((w) => ({ start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() }))
}

/** Total minutes where both member windows are simultaneously open. */
export function overlapMinutes(a: TimeWindow[], b: TimeWindow[]): number {
  const left = mergeWindows(a).map((w) => ({ s: Date.parse(w.start), e: Date.parse(w.end) }))
  const right = mergeWindows(b).map((w) => ({ s: Date.parse(w.start), e: Date.parse(w.end) }))
  let total = 0
  for (const x of left) {
    for (const y of right) {
      const start = Math.max(x.s, y.s)
      const end = Math.min(x.e, y.e)
      if (end > start) total += end - start
    }
  }
  return Math.round(total / 60_000)
}

/** Minutes a single member was present, clamped to the booked window. */
export function attendedMinutes(segments: AttendanceSegment[], booked: TimeWindow): number {
  const clampToBooking = (w: TimeWindow): TimeWindow => ({
    start: new Date(Math.max(Date.parse(w.start), Date.parse(booked.start))).toISOString(),
    end: new Date(Math.min(Date.parse(w.end), Date.parse(booked.end))).toISOString(),
  })
  const merged = mergeWindows(segments.map(toWindow))
  const withinBooking = merged
    .map(clampToBooking)
    .filter((w) => Date.parse(w.end) > Date.parse(w.start))
  return Math.round(withinBooking.reduce((sum, w) => sum + (Date.parse(w.end) - Date.parse(w.start)), 0) / 60_000)
}

export interface VerificationInput {
  attendance: AttendanceSegment[]
  teacherUid: string
  learnerUid: string
  booking: { startAt: string; endAt: string; durationMinutes: number }
  config: PlatformConfig
  now?: Date
}

export interface VerificationResult {
  verifiedMinutes: number
  teacherMinutes: number
  learnerMinutes: number
  /** Half of the booked duration — the platform's "the session really happened" bar. */
  quorumMinutes: number
  meetsQuorum: boolean
}

/**
 * Server-side proof of attendance: the *overlap* of the two members' presence,
 * clamped to the booked window. One member alone in a room can never settle.
 */
export function verifyAttendance(input: VerificationInput): VerificationResult {
  const booked: TimeWindow = { start: input.booking.startAt, end: input.booking.endAt }
  const now = input.now ?? new Date()

  const segmentsFor = (uid: string) =>
    input.attendance
      .filter((s) => s.uid === uid)
      .map((s) => ({ ...s, leftAt: s.leftAt ?? now.toISOString() }))

  const teacherMinutes = attendedMinutes(segmentsFor(input.teacherUid), booked)
  const learnerMinutes = attendedMinutes(segmentsFor(input.learnerUid), booked)
  const verifiedMinutes = overlapMinutes(
    mergeWindows(segmentsFor(input.teacherUid).map(toWindow)),
    mergeWindows(segmentsFor(input.learnerUid).map(toWindow)),
  )

  const quorumMinutes = Math.min(
    input.config.settlement.minVerifiedMinutes,
    Math.max(1, Math.ceil(input.booking.durationMinutes / 2)),
  )

  return {
    verifiedMinutes,
    teacherMinutes,
    learnerMinutes,
    quorumMinutes,
    meetsQuorum: verifiedMinutes >= quorumMinutes,
  }
}

/* ─────────────────────────── Settlement planning ─────────────────────────── */

export interface SettlementInput {
  booking: Booking
  config: PlatformConfig
  attendance: AttendanceSegment[]
  teacherWallet: Pick<Wallet, 'balance' | 'held'>
  learnerWallet: Pick<Wallet, 'balance' | 'held'>
  /** Explicit confirmations supplied in this call (may be empty for auto-settle). */
  confirmations?: { teacher?: boolean; learner?: boolean }
  /** `null` for server-initiated auto-settlement. */
  requesterUid?: string | null
  /** `true` when the Cloud Function decided the session window has passed. */
  sessionFinished?: boolean
  now?: Date
}

/** Deterministic ledger ids — the foundation of settlement idempotency. */
export function ledgerIds(bookingId: string) {
  return {
    credit: `tx_${bookingId}_credit`,
    debit: `tx_${bookingId}_debit`,
    hold: `tx_${bookingId}_hold`,
    refund: `tx_${bookingId}_refund`,
  }
}

export function settlementRecordId(bookingId: string): string {
  return `settlement_${bookingId}`
}

const blocked = (reason: SettlementBlockedReason, message: string, tokenAmount = 0): SettlementPlan => ({
  outcome: 'blocked',
  tokenAmount,
  creditAmount: 0,
  debitAmount: 0,
  refundAmount: 0,
  verifiedMinutes: 0,
  policyCode: reason,
  reason: message,
  blockedReason: reason,
})

/**
 * Decide what should happen to the tokens for a booking. This is the single
 * decision point used by the `settleSession` Cloud Function.
 */
export function planSettlement(input: SettlementInput): SettlementPlan {
  const { booking, config } = input
  const now = input.now ?? new Date()

  if (booking.settlement.state === 'settled') {
    return blocked(SETTLEMENT_BLOCKED_REASONS.alreadySettled, 'This session has already been settled.', booking.tokenAmount)
  }
  if (booking.settlement.state === 'refunded') {
    return blocked(SETTLEMENT_BLOCKED_REASONS.cancelled, 'This booking was cancelled and refunded.', booking.tokenAmount)
  }
  if (['cancelled', 'declined'].includes(booking.status)) {
    return blocked(SETTLEMENT_BLOCKED_REASONS.cancelled, 'Cancelled or declined bookings never move tokens.', booking.tokenAmount)
  }
  if (['requested'].includes(booking.status)) {
    return blocked(SETTLEMENT_BLOCKED_REASONS.tooEarly, 'The session has not been confirmed yet.', booking.tokenAmount)
  }

  const sessionEnd = Date.parse(booking.endAt)
  const finished = input.sessionFinished ?? now.getTime() >= sessionEnd
  if (!finished) {
    return blocked(SETTLEMENT_BLOCKED_REASONS.tooEarly, 'The booked session has not finished yet.', booking.tokenAmount)
  }

  const verification = verifyAttendance({
    attendance: input.attendance,
    teacherUid: booking.teacherUid,
    learnerUid: booking.learnerUid,
    booking,
    config,
    now,
  })

  const bothConfirmed =
    input.confirmations?.teacher === true && input.confirmations?.learner === true
  const singleConfirmed =
    input.confirmations?.teacher === true || input.confirmations?.learner === true

  const tokenAmount = roundTokens(booking.tokenAmount)

  if (tokenAmount <= 0) {
    return blocked(SETTLEMENT_BLOCKED_REASONS.invalidAmount, 'The booking has no token value to settle.', 0)
  }

  const reasons: string[] = []
  let outcome: SettlementOutcome = 'settle'

  if (!verification.meetsQuorum) {
    if (bothConfirmed) {
      // Humans agree it happened (e.g. a network failure kept them off-platform
      // — they fall back to a phone call). Trust the explicit double confirmation.
      reasons.push('Both members confirmed the session, overriding the attendance quorum.')
    } else if (booking.completion.autoCompletedAt) {
      return blocked(
        SETTLEMENT_BLOCKED_REASONS.insufficientAttendance,
        `Only ${verification.verifiedMinutes} min of verified attendance was recorded; automatic settlement needs at least ${verification.quorumMinutes} min (${singleConfirmed ? 'one confirmation received' : 'no confirmations received'}).`,
        tokenAmount,
      )
    } else {
      return blocked(
        SETTLEMENT_BLOCKED_REASONS.insufficientAttendance,
        `Only ${verification.verifiedMinutes} min of verified attendance was recorded; automatic settlement needs at least ${verification.quorumMinutes} min. Either member may confirm the session or open a dispute.`,
        tokenAmount,
      )
    }
  } else {
    reasons.push(`${verification.verifiedMinutes} min of joint attendance verified against a ${booking.durationMinutes} min booking.`)
  }

  // Token availability. Escrow-covered bookings are always affordable.
  const escrowed = booking.settlement.heldTxId !== null
  const available = roundTokens(Math.max(0, input.learnerWallet.balance - input.learnerWallet.held))
  let debitAmount = tokenAmount

  if (!escrowed && available + 1e-9 < tokenAmount) {
    const increment = Math.max(0.25, config.token.roundingIncrementMinutes / 60)
    const partial = roundTokens(Math.floor(available / increment) * increment)
    if (partial <= 0) {
      return blocked(
        SETTLEMENT_BLOCKED_REASONS.insufficientBalance,
        'The learner no longer has enough Time Tokens for this session. An administrator can review the booking.',
        tokenAmount,
      )
    }
    debitAmount = partial
    outcome = 'partial'
    reasons.push(
      `The learner could only cover ${partial} of ${tokenAmount} Time Tokens; the teacher was credited ${partial} and the remainder was waived.`,
    )
  } else {
    reasons.push(`Teacher credited ${tokenAmount} Time Token(s); learner debited ${tokenAmount}.`)
  }

  return {
    outcome,
    tokenAmount,
    creditAmount: debitAmount,
    debitAmount,
    refundAmount: 0,
    verifiedMinutes: verification.verifiedMinutes,
    // The ledger names the policy that produced the number, so a partial
    // settlement (the learner could only cover part of the session) is
    // distinguishable from a full one when somebody audits the row later.
    policyCode:
      outcome === 'partial' ? TOKEN_POLICY_CODES.partialRounding : TOKEN_POLICY_CODES.standardSettlement,
    reason: reasons.join(' '),
  }
}

/* ─────────────────────────── Ledger construction ─────────────────────────── */

export interface LedgerDraft {
  id: string
  uid: string
  counterpartyUid: string | null
  bookingId: string
  type: TokenTransactionType
  direction: 'credit' | 'debit'
  amount: number
  idempotencyKey: string
  balanceAfter: number
  reason: string
  policyCode: string
  createdBy: string
}

/**
 * Build the two sides of a settlement plus the resulting wallet values.
 * Because both ids are derived from the booking, replaying this function is
 * always safe: identical ids, identical amounts.
 */
export function buildSettlementWrites(input: {
  booking: Booking
  plan: SettlementPlan
  teacher: Wallet
  learner: Wallet
  createdBy: string
  reason: string
}): {
  entries: LedgerDraft[]
  nextTeacher: Wallet
  nextLearner: Wallet
} {
  const { booking, plan, createdBy } = input
  const ids = ledgerIds(booking.id)
  const now = new Date().toISOString()
  const escrowed = booking.settlement.heldTxId !== null
  const heldAmount = escrowed ? plan.tokenAmount : 0

  const nextTeacher: Wallet = {
    ...input.teacher,
    balance: roundTokens(input.teacher.balance + plan.creditAmount),
    lifetimeEarned: roundTokens(input.teacher.lifetimeEarned + plan.creditAmount),
    updatedAt: now,
    updatedBy: createdBy,
  }

  const nextLearner: Wallet = {
    ...input.learner,
    balance: roundTokens(input.learner.balance - plan.debitAmount),
    held: roundTokens(Math.max(0, input.learner.held - heldAmount)),
    lifetimeSpent: roundTokens(input.learner.lifetimeSpent + plan.debitAmount),
    updatedAt: now,
    updatedBy: createdBy,
  }

  const entries: LedgerDraft[] = [
    {
      id: ids.debit,
      uid: booking.learnerUid,
      counterpartyUid: booking.teacherUid,
      bookingId: booking.id,
      type: escrowed ? 'escrow_release' : 'debit',
      direction: 'debit',
      amount: plan.debitAmount,
      idempotencyKey: ids.debit,
      balanceAfter: nextLearner.balance,
      reason: input.reason,
      policyCode: plan.policyCode,
      createdBy,
    },
    {
      id: ids.credit,
      uid: booking.teacherUid,
      counterpartyUid: booking.learnerUid,
      bookingId: booking.id,
      type: 'credit',
      direction: 'credit',
      amount: plan.creditAmount,
      idempotencyKey: ids.credit,
      balanceAfter: nextTeacher.balance,
      reason: input.reason,
      policyCode: plan.policyCode,
      createdBy,
    },
  ]

  return { entries, nextTeacher, nextLearner }
}

/** Refund writes for a cancelled booking (or a dispute resolved in the learner's favour). */
export function buildRefundWrites(input: {
  booking: Booking
  refundAmount: number
  teacher: Wallet
  learner: Wallet
  reason: string
  createdBy: string
  policyCode: string
}): { entries: LedgerDraft[]; nextTeacher: Wallet; nextLearner: Wallet } {
  const { booking, refundAmount, createdBy } = input
  const ids = ledgerIds(booking.id)
  const now = new Date().toISOString()
  const escrowed = booking.settlement.heldTxId !== null

  const nextLearner: Wallet = {
    ...input.learner,
    balance: roundTokens(input.learner.balance + refundAmount),
    held: roundTokens(Math.max(0, input.learner.held - (escrowed ? refundAmount : 0))),
    lifetimeSpent: roundTokens(Math.max(0, input.learner.lifetimeSpent - refundAmount)),
    updatedAt: now,
    updatedBy: createdBy,
  }

  const entries: LedgerDraft[] =
    refundAmount > 0
      ? [
          {
            id: ids.refund,
            uid: booking.learnerUid,
            counterpartyUid: booking.teacherUid,
            bookingId: booking.id,
            type: 'refund',
            direction: 'credit',
            amount: refundAmount,
            idempotencyKey: ids.refund,
            balanceAfter: nextLearner.balance,
            reason: input.reason,
            policyCode: input.policyCode,
            createdBy,
          },
        ]
      : []

  return { entries, nextTeacher: input.teacher, nextLearner }
}

/** A settlement record with a deterministic id — replay safe. */
export function buildSettlementRecord(booking: Booking, plan: SettlementPlan): SettlementRecord {
  const now = new Date().toISOString()
  const ids = ledgerIds(booking.id)
  const settled = plan.outcome === 'settle' || plan.outcome === 'partial'
  return {
    id: settlementRecordId(booking.id),
    bookingId: booking.id,
    teacherUid: booking.teacherUid,
    learnerUid: booking.learnerUid,
    tokenAmount: plan.tokenAmount,
    verifiedMinutes: plan.verifiedMinutes,
    status: settled ? 'settled' : plan.outcome === 'refund' ? 'refunded' : 'blocked',
    debitTxId: settled ? ids.debit : null,
    creditTxId: settled ? ids.credit : null,
    refundTxId: plan.refundAmount > 0 ? ids.refund : null,
    reason: plan.reason,
    idempotencyKey: settlementRecordId(booking.id),
    attempts: 1,
    createdAt: now,
    updatedAt: now,
  }
}

/** Guard against duplicate ledger writes when merging offline/queued batches. */
export function dedupeLedger<T extends { id: string }>(entries: T[], existingIds: Iterable<string> = []): T[] {
  const seen = new Set(existingIds)
  const out: T[] = []
  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(entry)
  }
  return out
}

/* ───────────────────────── denormalised counters ───────────────────────────
 *
 * The profiles and listings carry counters that the UI reads directly
 * (dashboard goals, rating stars, "N completed sessions", the marketplace
 * ranking). They are derivable from the ledger and the bookings, but reading
 * every booking to render a card is not, so they are denormalised — and a
 * denormalised counter is only as good as the write path that maintains it.
 *
 * Both engines call these, so the local reference backend and the deployed
 * functions cannot drift on how a number is computed. The semantics mirror the
 * demo seed, which is the readable statement of intent:
 *   - a settled session counts for both members, whatever the rounding;
 *   - hours are converted at 1 decimal place, like the seed's fixtures;
 *   - a refund or a blocked attempt moves no counter: no verified session, no
 *     completed hour. A steward's refund *after* a settlement deliberately does
 *     not un-count the hour — the work happened, the tokens were returned.
 */

export interface CounterWrite<T> {
  next: T
  changed: boolean
}

/**
 * Adds one settled session to a member's stats, from that member's side.
 *
 * The amounts are the plan's credit and debit — what the learner was actually
 * charged when a settlement rounds down — not the nominal value of the session.
 *
 * Hours accumulate at full floating-point precision and are formatted for
 * display (`formatHours`); the token amounts — which *are* the ledger — stay
 * rounded to four decimals. Rounding each session to a tenth of an hour first,
 * as this used to, drifts visibly: eight fifty-minute sessions are 6.67 hours,
 * but 8 × 0.8 reports 6.4 — half an hour of teaching lost to arithmetic. A
 * rounded-to-four-decimals total would still drift by 0.0003 hours over the same
 * eight sessions, which is the kind of error a member would eventually notice in
 * a bank of hours, so the hours are left alone and only the money is rounded.
 */
export function statsAfterSettlement(
  stats: UserStats,
  side: 'teacher' | 'learner',
  durationMinutes: number,
  amounts: { creditAmount: number; debitAmount: number },
): UserStats {
  const hours = durationMinutes / 60
  return side === 'teacher'
    ? {
        ...stats,
        sessionsCompleted: stats.sessionsCompleted + 1,
        sessionsTaught: stats.sessionsTaught + 1,
        teachingHours: stats.teachingHours + hours,
        tokensEarned: roundTokens(stats.tokensEarned + amounts.creditAmount),
      }
    : {
        ...stats,
        sessionsCompleted: stats.sessionsCompleted + 1,
        learningHours: stats.learningHours + hours,
        tokensSpent: roundTokens(stats.tokensSpent + amounts.debitAmount),
      }
}

/** Adds one review to the reviewed member's rating aggregate. */
export function statsAfterReview(stats: UserStats, rating: number): UserStats {
  return {
    ...stats,
    ratingSum: roundTokens(stats.ratingSum + rating),
    reviewCount: stats.reviewCount + 1,
  }
}

/** Adds one review to the reviewed listing's score. */
export function listingAfterReview(listing: { ratingSum: number; reviewCount: number }, rating: number) {
  return {
    ratingSum: roundTokens(listing.ratingSum + rating),
    reviewCount: listing.reviewCount + 1,
  }
}

/** Adds one booking to a listing's request counter. */
export function listingAfterBooking(listing: { bookingCount: number }) {
  return { bookingCount: listing.bookingCount + 1 }
}

/** Adds one completed session to a listing's counter. */
export function listingAfterSettlement(listing: { completedCount: number }) {
  return { completedCount: listing.completedCount + 1 }
}
