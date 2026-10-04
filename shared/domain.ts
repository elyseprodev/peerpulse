/**
 * PeerPulse — canonical domain model.
 *
 * This module is the single source of truth for the data shapes stored in
 * Firestore. It is imported by:
 *   • the Vue application            (`@shared/domain`)
 *   • the Cloud Functions backend    (`functions/src/shared/domain`, synced)
 *   • the unit test suite
 *
 * Timestamps are represented as ISO-8601 strings in TypeScript and converted to
 * `Timestamp` at the Firestore boundary (see `src/lib/backend/firebase/convert.ts`).
 */

/** ISO-8601 timestamp string, e.g. `2026-03-04T09:30:00.000Z`. */
export type IsoDate = string

export type UserRole = 'member' | 'admin'
export type UserStatus = 'active' | 'suspended' | 'deleted'

export type SkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'any'
export type SessionFormat = 'video' | 'voice' | 'chat' | 'async'
export type ListingStatus = 'draft' | 'published' | 'paused' | 'removed'

export type BookingStatus =
  | 'requested'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'declined'
  | 'no_show'
  | 'disputed'

export type SettlementState = 'unsettled' | 'escrowed' | 'settled' | 'refunded' | 'partial' | 'blocked'

export type TokenTransactionType =
  | 'signup_grant'
  | 'credit'
  | 'debit'
  | 'escrow_hold'
  | 'escrow_release'
  | 'refund'
  | 'admin_adjustment'
  | 'penalty'

export type TransactionStatus = 'pending' | 'posted' | 'reversed'

export type ModerationState = 'clean' | 'flagged' | 'hidden' | 'removed'

export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed'
export type ReportTargetType = 'user' | 'skill' | 'post' | 'comment' | 'community' | 'review'

/** A half-open time window. `end` is exclusive. */
export interface TimeWindow {
  start: IsoDate
  end: IsoDate
}

/** One weekly availability block, expressed in the member's own timezone. */
export interface AvailabilityBlock {
  /** 0 = Sunday … 6 = Saturday (matches `Date#getDay`). */
  weekday: number
  /** `HH:mm` in 24-hour form, local to `timezone`. */
  start: string
  /** `HH:mm` in 24-hour form, local to `timezone`. */
  end: string
}

export interface WeeklyAvailability extends Array<AvailabilityBlock> {}

export interface PrivacySettings {
  /** Who may see the member's profile page. */
  profileVisibility: 'public' | 'members' | 'private'
  showEmail: boolean
  showAvailability: boolean
  allowDirectRequests: boolean
  appearInDiscovery: boolean
}

export interface UserStats {
  sessionsCompleted: number
  sessionsTaught: number
  teachingHours: number
  learningHours: number
  ratingSum: number
  reviewCount: number
  /** Derived by the server from the immutable ledger; never client-authored. */
  tokensEarned: number
  tokensSpent: number
}

export interface OnboardingState {
  completed: boolean
  /** 0-based index of the last completed step. */
  step: number
  completedAt?: IsoDate | null
  savedAt?: IsoDate | null
  skipped: boolean
}

export interface UserProfile {
  /** Firebase Auth UID — the canonical identifier everywhere in the system. */
  uid: string
  email: string
  displayName: string
  /** Storage URL, or `null` when the generated avatar is used. */
  photoURL: string | null
  /** Deterministic seed for the generated SVG avatar fallback. */
  avatarSeed: string
  headline: string
  bio: string
  location: string
  /** IANA timezone, e.g. `Europe/Berlin`. */
  timezone: string
  role: UserRole
  status: UserStatus
  interests: string[]
  /** BCP-47 language tags the member speaks. */
  languages: string[]
  /** Skill ids the member offers to teach (listings they own). */
  teachSkillIds: string[]
  /** Skill ids the member wants to learn. */
  learnSkillIds: string[]
  teachCategories: string[]
  learnCategories: string[]
  preferredFormats: SessionFormat[]
  availability: AvailabilityBlock[]
  privacy: PrivacySettings
  stats: UserStats
  onboarding: OnboardingState
  createdAt: IsoDate
  updatedAt: IsoDate
  lastActiveAt: IsoDate
}

export interface SkillListing {
  id: string
  ownerUid: string
  title: string
  slug: string
  categoryId: string
  description: string
  /** What a learner will walk away with — shown as bullets. */
  outcomes: string[]
  level: SkillLevel
  languages: string[]
  format: SessionFormat
  durationMinutes: number
  tags: string[]
  status: ListingStatus
  moderation: {
    state: ModerationState
    reason: string | null
    reviewedByUid: string | null
    reviewedAt: IsoDate | null
  }
  /** Denormalised aggregates maintained by Cloud Functions. */
  bookingCount: number
  completedCount: number
  ratingSum: number
  reviewCount: number
  createdAt: IsoDate
  updatedAt: IsoDate
}

export interface BookingParticipantSnapshot {
  uid: string
  displayName: string
  photoURL: string | null
  avatarSeed: string
}

export interface CancellationRecord {
  byUid: string
  reason: string
  at: IsoDate
  /** Tokens returned to the learner as a result of this cancellation. */
  refundTokens: number
  policyCode: string
}

export interface RescheduleRecord {
  byUid: string
  at: IsoDate
  from: TimeWindow
  to: TimeWindow
  reason: string
}

export interface CompletionEvidence {
  teacherConfirmedAt: IsoDate | null
  learnerConfirmedAt: IsoDate | null
  autoCompletedAt: IsoDate | null
  /** Minutes of overlap actually observed by the server. */
  verifiedMinutes: number | null
  /** Server-generated completion token proving the session ended legitimately. */
  closedBy: 'participants' | 'auto_settle' | 'admin' | null
}

export interface Booking {
  id: string
  skillId: string
  skillTitle: string
  categoryId: string
  teacherUid: string
  learnerUid: string
  /** Sorted pair, used by security rules for participant checks. */
  participants: string[]
  participantsSnapshot: BookingParticipantSnapshot[]
  createdByUid: string
  startAt: IsoDate
  endAt: IsoDate
  durationMinutes: number
  /** Timezone the booking was requested in, for display + reminders. */
  timezone: string
  status: BookingStatus
  roomId: string | null
  /** Tokens this session is expected to move, per the active policy. */
  tokenAmount: number
  settlement: {
    state: SettlementState
    /** Deterministic id: `settlement_{bookingId}` — guarantees idempotency. */
    settlementId: string | null
    settledAt: IsoDate | null
    debitTxId: string | null
    creditTxId: string | null
    refundTxId: string | null
    heldTxId: string | null
    note: string | null
  }
  cancellation: CancellationRecord | null
  reschedules: RescheduleRecord[]
  completion: CompletionEvidence
  learnerNote: string
  teacherNote: string
  /** Server-side optimistic-concurrency counter. */
  revision: number
  createdAt: IsoDate
  updatedAt: IsoDate
}

export interface MediaState {
  camera: boolean
  microphone: boolean
  screen: boolean
}

export interface RoomParticipant {
  uid: string
  displayName: string
  avatarSeed: string
  role: 'teacher' | 'learner' | 'observer'
  joinedAt: IsoDate
  lastSeen: IsoDate
  leftAt: IsoDate | null
  media: MediaState
}

/** Attendance is tracked as closed/open segments so settlement can measure overlap. */
export interface AttendanceSegment {
  uid: string
  joinedAt: IsoDate
  leftAt: IsoDate | null
}

export type RoomStatus = 'scheduled' | 'open' | 'closed' | 'abandoned'

export interface Room {
  id: string
  bookingId: string
  skillTitle: string
  teacherUid: string
  learnerUid: string
  participants: string[]
  status: RoomStatus
  /** ICE servers are minted server-side; never stored here (they expire). */
  createdAt: IsoDate
  openedAt: IsoDate | null
  closedAt: IsoDate | null
  /** Locked when the room closes so late writes cannot alter attendance. */
  attendanceLocked: boolean
  session: {
    startedAt: IsoDate | null
    endedAt: IsoDate | null
    durationMinutes: number | null
    initiatorUid: string | null
  }
}

export interface RoomPresence {
  uid: string
  displayName: string
  avatarSeed: string
  role: RoomParticipant['role']
  joinedAt: IsoDate
  lastSeen: IsoDate
  leftAt: IsoDate | null
  media: MediaState
}

/** WebRTC signalling envelope — exactly one negotiation step per document. */
export interface SignalingMessage {
  id: string
  kind: 'offer' | 'answer' | 'renegotiate' | 'bye'
  from: string
  to: string
  sdp: string | null
  /** Monotonic per-sender counter; stale messages are ignored by receivers. */
  sequence: number
  createdAt: IsoDate
}

export interface IceCandidateMessage {
  id: string
  from: string
  to: string
  candidate: RTCIceCandidateInit
  createdAt: IsoDate
}

export interface Wallet {
  uid: string
  /** Settled, spendable balance. Server-maintained only. */
  balance: number
  /** Tokens reserved by confirmed bookings under the escrow policy. */
  held: number
  lifetimeEarned: number
  lifetimeSpent: number
  lifetimeGranted: number
  policyVersion: string
  updatedAt: IsoDate
  /** Audit trail of which server component last wrote the balance. */
  updatedBy: string
}

export interface TokenTransaction {
  id: string
  type: TokenTransactionType
  /** Always a positive magnitude; `direction` carries the sign. */
  amount: number
  direction: 'credit' | 'debit'
  status: TransactionStatus
  /** Wallet owner for this ledger row. */
  uid: string
  counterpartyUid: string | null
  bookingId: string | null
  roomId: string | null
  /** Deterministic key — a repeated settle() can never post twice. */
  idempotencyKey: string
  balanceAfter: number | null
  reason: string
  policyCode: string
  createdBy: string
  createdAt: IsoDate
}

export interface SettlementRecord {
  id: string
  bookingId: string
  teacherUid: string
  learnerUid: string
  tokenAmount: number
  verifiedMinutes: number
  status: 'settled' | 'refunded' | 'blocked'
  debitTxId: string | null
  creditTxId: string | null
  refundTxId: string | null
  reason: string
  /** Idempotency guard: unique per booking. */
  idempotencyKey: string
  attempts: number
  createdAt: IsoDate
  updatedAt: IsoDate
}

export interface Review {
  id: string
  bookingId: string
  skillId: string
  authorUid: string
  subjectUid: string
  authorRole: 'teacher' | 'learner'
  rating: number
  comment: string
  tags: string[]
  moderation: { state: ModerationState; reason: string | null }
  responseText: string | null
  responseAt: IsoDate | null
  createdAt: IsoDate
}

export type NotificationType =
  | 'booking_requested'
  | 'booking_confirmed'
  | 'booking_declined'
  | 'booking_cancelled'
  | 'booking_rescheduled'
  | 'booking_reminder'
  | 'session_settled'
  | 'session_refunded'
  | 'session_disputed'
  | 'review_received'
  | 'community_reply'
  | 'token_grant'
  | 'moderation_action'
  | 'system'

export interface AppNotification {
  id: string
  uid: string
  type: NotificationType
  title: string
  body: string
  link: string | null
  read: boolean
  priority: 'low' | 'normal' | 'high'
  createdAt: IsoDate
}

export interface Community {
  id: string
  name: string
  slug: string
  description: string
  categoryId: string
  visibility: 'public' | 'members' | 'private'
  ownerUids: string[]
  moderatorUids: string[]
  memberCount: number
  postCount: number
  tags: string[]
  rules: string[]
  createdAt: IsoDate
  updatedAt: IsoDate
}

export interface CommunityMember {
  uid: string
  displayName: string
  avatarSeed: string
  role: 'owner' | 'moderator' | 'member'
  joinedAt: IsoDate
}

export interface CommunityPost {
  id: string
  communityId: string
  authorUid: string
  authorName: string
  authorSeed: string
  kind: 'post' | 'question' | 'resource' | 'event'
  title: string
  body: string
  link: string | null
  /** Map of uid → emoji reaction. One reaction per member per post. */
  reactions: Record<string, string>
  commentCount: number
  pinned: boolean
  moderation: { state: ModerationState; reason: string | null }
  /** Extra payload for `kind === 'event'`. */
  event?: { startAt: IsoDate; durationMinutes: number; location: string; capacity: number | null } | null
  createdAt: IsoDate
  updatedAt: IsoDate
}

export interface CommunityComment {
  id: string
  postId: string
  communityId: string
  authorUid: string
  authorName: string
  authorSeed: string
  body: string
  moderation: { state: ModerationState; reason: string | null }
  createdAt: IsoDate
}

export interface ModerationReport {
  id: string
  reporterUid: string
  targetType: ReportTargetType
  targetId: string
  /** Full Firestore path so moderators can act without extra lookups. */
  targetPath: string
  targetLabel: string
  reason: 'spam' | 'harassment' | 'inappropriate' | 'no_show' | 'misrepresentation' | 'other'
  details: string
  status: ReportStatus
  priority: 'low' | 'normal' | 'high'
  resolution: string | null
  handledByUid: string | null
  handledAt: IsoDate | null
  createdAt: IsoDate
  updatedAt: IsoDate
}

export interface DisputeCase {
  id: string
  bookingId: string
  openedByUid: string
  againstUid: string
  claim: string
  evidence: string
  status: 'open' | 'resolved_refund' | 'resolved_release' | 'resolved_split' | 'closed'
  outcome: string | null
  handledByUid: string | null
  createdAt: IsoDate
  updatedAt: IsoDate
}

/** What every mutating settlement call returns to the client. */
export interface SettlementOutcomeResult {
  booking: Booking
  settlement: SettlementRecord | null
  notices: string[]
}

/** Server-owned platform configuration. Only admins may write. */
export interface PlatformConfig {
  /** Bumped whenever the token rules change; stamped on every ledger row. */
  version: string
  token: {
    /** Standard: one hour of teaching == one Time Token. */
    tokensPerHour: number
    partialHourRule: 'exact' | 'round_up' | 'round_down' | 'nearest'
    /** Granularity used by the rounding rules, in minutes. */
    roundingIncrementMinutes: number
    minSessionMinutes: number
    maxSessionMinutes: number
    /** Tokens a brand-new member starts with. */
    signupGrantEnabled: boolean
    signupGrantAmount: number
  }
  booking: {
    minNoticeHours: number
    maxAdvanceDays: number
    autoConfirm: boolean
    /** When true, confirmed bookings reserve the learner's tokens in escrow. */
    reserveTokensOnConfirm: boolean
    /** Sessions may only end between these minutes and the booked length. */
    earlyEndToleranceMinutes: number
  }
  settlement: {
    /** Minimum verified attendance before an automatic settlement is allowed. */
    minVerifiedMinutes: number
    /** Hours after a session ends before the server settles without both confirmations. */
    autoSettleAfterHours: number
    requireBothConfirmations: boolean
    /** Days a learner has to raise a dispute after settlement. */
    disputeWindowHours: number
  }
  cancellation: {
    /** Cancelling at least this many hours ahead is always free. */
    freeCancellationHours: number
    /** Refund share returned to the learner when cancelling late (0–1). */
    lateCancellationRefundRatio: number
    /** Tokens charged to a no-show teacher's reputation (never cash). */
    noShowPenaltyTokens: number
  }
  community: {
    allowMemberEvents: boolean
    autoFlagKeywords: string[]
    requireModerationForNewMembers: boolean
  }
  updatedAt: IsoDate
  updatedByUid: string
}

/** Result envelope used by every mutating backend call. */
export type BackendResult<T> = { ok: true; data: T } | { ok: false; error: BackendError }

export interface BackendError {
  code: string
  message: string
  /** Field-level validation errors keyed by form field name. */
  fields?: Record<string, string>
}

export interface SkillFilter {
  query?: string
  categoryId?: string | null
  level?: SkillLevel | null
  format?: SessionFormat | null
  language?: string | null
  /** Only listings whose owner has availability overlapping this weekday. */
  weekday?: number | null
  maxDurationMinutes?: number | null
  sort?: 'relevance' | 'rating' | 'recent' | 'duration'
}
