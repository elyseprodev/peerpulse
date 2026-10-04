/**
 * PeerPulse backend contract.
 *
 * Two implementations exist:
 *   • `firebase` — Firebase Auth + Firestore + Cloud Functions (production path)
 *   • `local`    — an in-browser reference implementation of the *same* rules,
 *                  used for demos, offline development and unit tests.
 *
 * Both consume the pure domain modules in `shared/`, so token maths, conflict
 * detection and settlement planning are byte-for-byte identical. Only the
 * persistence and the trust boundary differ.
 */
import type {
  AppNotification,
  BackendError,
  Booking,
  Community,
  CommunityComment,
  CommunityPost,
  CommunityMember,
  DisputeCase,
  MediaState,
  ModerationReport,
  PlatformConfig,
  Review,
  Room,
  RoomPresence,
  SettlementRecord,
  SkillFilter,
  SkillListing,
  TokenTransaction,
  UserProfile,
  UserRole,
  UserStatus,
  Wallet,
  SignalingMessage,
  IceCandidateMessage,
  SettlementOutcomeResult,
} from '@shared/domain'
import type { BackendMode } from '../env'

export type { SettlementOutcomeResult }

export type Unsubscribe = () => void

export interface AuthSession {
  uid: string
  email: string
  displayName: string
  photoURL: string | null
  emailVerified: boolean
  /** Present only in local mode: marks the built-in demo accounts. */
  demo?: boolean
}

/** Error shape thrown by every adapter; the UI maps `fields` onto form inputs. */
export class BackendRequestError extends Error {
  code: string
  fields?: Record<string, string>
  constructor(error: BackendError) {
    super(error.message)
    this.name = 'BackendRequestError'
    this.code = error.code
    this.fields = error.fields
  }
}

export function isBackendError(value: unknown): value is BackendRequestError {
  return value instanceof BackendRequestError
}

export interface SignUpInput {
  email: string
  password: string
  displayName: string
  timezone?: string
}

export interface MemberQuery {
  limit?: number
  query?: string
  categoryId?: string | null
  skillId?: string | null
  excludeUid?: string
}

export interface CreateSkillInput {
  ownerUid: string
  title: string
  categoryId: string
  description: string
  outcomes: string[]
  level: SkillListing['level']
  languages: string[]
  format: SkillListing['format']
  durationMinutes: number
  tags: string[]
}

export interface CreateBookingInput {
  skillId: string
  startAt: string
  endAt: string
  timezone: string
  learnerNote: string
}

export interface BookingWindowQuery {
  uids: string[]
  from: string
  to: string
}

export interface CreateCommunityInput {
  name: string
  description: string
  categoryId: string
  visibility: Community['visibility']
  tags: string[]
  rules: string[]
  ownerUid: string
}

export interface CreatePostInput {
  communityId: string
  authorUid: string
  kind: CommunityPost['kind']
  title: string
  body: string
  link?: string | null
  event?: CommunityPost['event']
}

export interface CreateReviewInput {
  bookingId: string
  authorUid: string
  rating: number
  comment: string
  tags: string[]
}

export interface CreateReportInput {
  reporterUid: string
  targetType: ModerationReport['targetType']
  targetId: string
  targetPath: string
  targetLabel: string
  reason: ModerationReport['reason']
  details: string
}

export interface PlatformMetrics {
  members: number
  activeListings: number
  communities: number
  bookings: number
  completedSessions: number
  disputedSessions: number
  tokensInCirculation: number
  tokensSettled: number
  hoursTraded: number
  openReports: number
  averageRating: number
  generatedAt: string
}

export interface BackendCapabilities {
  /** Live listeners (Firestore `onSnapshot` / local event bus). */
  realtime: boolean
  /** Whether `getIceServers` can mint credentials without extra configuration. */
  turnCredentials: 'server' | 'static' | 'none'
  push: boolean
  demoAccounts: boolean
}

export interface PeerPulseBackend {
  readonly mode: BackendMode
  readonly capabilities: BackendCapabilities

  /* ── lifecycle ─────────────────────────────────────────────────────── */
  init(): Promise<void>
  onSessionChange(cb: (session: AuthSession | null) => void): Unsubscribe
  getSession(): AuthSession | null

  /* ── authentication ────────────────────────────────────────────────── */
  signUp(input: SignUpInput): Promise<AuthSession>
  signIn(email: string, password: string): Promise<AuthSession>
  /**
   * Demo-only shortcut into a seeded account. The optional `uid` selects a
   * specific seeded member (used by the two-tab video-room demo); production
   * adapters do not implement this at all.
   */
  signInAsDemo?(role: UserRole, uid?: string): Promise<AuthSession>
  signOut(): Promise<void>
  sendPasswordReset(email: string): Promise<void>
  changePassword(currentPassword: string, newPassword: string): Promise<void>

  /* ── members ───────────────────────────────────────────────────────── */
  getUser(uid: string): Promise<UserProfile | null>
  getUsers(uids: string[]): Promise<UserProfile[]>
  listMembers(query?: MemberQuery): Promise<UserProfile[]>
  saveProfile(uid: string, patch: Partial<UserProfile>): Promise<UserProfile>
  saveOnboarding(uid: string, patch: Partial<UserProfile>, onboarding: Partial<UserProfile['onboarding']>): Promise<UserProfile>
  setUserRole(uid: string, role: UserRole): Promise<UserProfile>
  setUserStatus(uid: string, status: UserStatus): Promise<UserProfile>

  /* ── skills ────────────────────────────────────────────────────────── */
  listSkills(filter?: SkillFilter & { limit?: number; ownerUid?: string; includeUnpublished?: boolean }): Promise<SkillListing[]>
  getSkill(id: string): Promise<SkillListing | null>
  createSkill(input: CreateSkillInput): Promise<SkillListing>
  updateSkill(id: string, patch: Partial<SkillListing>): Promise<SkillListing>
  removeSkill(id: string): Promise<void>

  /* ── bookings ──────────────────────────────────────────────────────── */
  listBookings(uid: string): Promise<Booking[]>
  getBooking(id: string): Promise<Booking | null>
  listBookingsInWindow(query: BookingWindowQuery): Promise<Booking[]>
  createBooking(input: CreateBookingInput): Promise<Booking>
  confirmBooking(id: string): Promise<Booking>
  declineBooking(id: string, reason: string): Promise<Booking>
  cancelBooking(id: string, reason: string): Promise<Booking>
  rescheduleBooking(id: string, startAt: string, endAt: string, reason: string): Promise<Booking>
  confirmCompletion(id: string, uid: string): Promise<SettlementOutcomeResult>
  requestSettlement(id: string): Promise<SettlementOutcomeResult>
  raiseDispute(id: string, claim: string): Promise<DisputeCase>
  listSettlements(): Promise<SettlementRecord[]>

  /* ── video rooms ───────────────────────────────────────────────────── */
  getRoom(roomId: string): Promise<Room | null>
  getRoomForBooking(bookingId: string): Promise<Room | null>
  ensureRoom(bookingId: string): Promise<Room>
  getIceServers(): Promise<RTCIceServer[]>
  registerPresence(roomId: string, uid: string, media: MediaState): Promise<RoomPresence>
  updatePresence(roomId: string, uid: string, patch: Partial<RoomPresence>): Promise<void>
  leavePresence(roomId: string, uid: string): Promise<void>
  listPresence(roomId: string): Promise<RoomPresence[]>
  watchPresence(roomId: string, cb: (presence: RoomPresence[]) => void): Unsubscribe
  startSession(roomId: string, uid: string): Promise<Room>
  endSession(roomId: string, uid: string): Promise<SettlementOutcomeResult>
  sendSignal(roomId: string, message: Omit<SignalingMessage, 'id' | 'createdAt'>): Promise<void>
  watchSignals(roomId: string, uid: string, cb: (message: SignalingMessage) => void): Unsubscribe
  sendCandidate(roomId: string, message: Omit<IceCandidateMessage, 'id' | 'createdAt'>): Promise<void>
  watchCandidates(roomId: string, uid: string, cb: (message: IceCandidateMessage) => void): Unsubscribe

  /* ── wallet & ledger ───────────────────────────────────────────────── */
  getWallet(uid: string): Promise<Wallet>
  watchWallet(uid: string, cb: (wallet: Wallet) => void): Unsubscribe
  listTransactions(uid: string, options?: { limit?: number; bookingId?: string }): Promise<TokenTransaction[]>
  listAllTransactions(options?: { limit?: number }): Promise<TokenTransaction[]>
  adjustWallet(uid: string, amount: number, reason: string): Promise<Wallet>

  /* ── reviews ───────────────────────────────────────────────────────── */
  listReviewsForUser(uid: string): Promise<Review[]>
  listReviewsForSkill(skillId: string): Promise<Review[]>
  listReviewsForBooking(bookingId: string): Promise<Review[]>
  createReview(input: CreateReviewInput): Promise<Review>
  respondToReview(id: string, text: string): Promise<Review>

  /* ── notifications ─────────────────────────────────────────────────── */
  listNotifications(uid: string): Promise<AppNotification[]>
  watchNotifications(uid: string, cb: (items: AppNotification[]) => void): Unsubscribe
  markNotificationRead(id: string): Promise<void>
  markAllNotificationsRead(uid: string): Promise<void>

  /* ── communities ───────────────────────────────────────────────────── */
  listCommunities(options?: { limit?: number; memberUid?: string; categoryId?: string }): Promise<Community[]>
  getCommunity(id: string): Promise<Community | null>
  createCommunity(input: CreateCommunityInput): Promise<Community>
  joinCommunity(id: string, uid: string): Promise<Community>
  leaveCommunity(id: string, uid: string): Promise<Community>
  listCommunityMembers(communityId: string): Promise<CommunityMember[]>
  listPosts(options: { communityId?: string; limit?: number; kind?: CommunityPost['kind'] }): Promise<CommunityPost[]>
  createPost(input: CreatePostInput): Promise<CommunityPost>
  reactToPost(postId: string, uid: string, emoji: string): Promise<CommunityPost>
  listComments(postId: string): Promise<CommunityComment[]>
  createComment(input: { postId: string; communityId: string; authorUid: string; body: string }): Promise<CommunityComment>

  /* ── moderation & administration ───────────────────────────────────── */
  createReport(input: CreateReportInput): Promise<ModerationReport>
  listReports(): Promise<ModerationReport[]>
  resolveReport(id: string, patch: { status: ModerationReport['status']; resolution: string }): Promise<ModerationReport>
  listDisputes(): Promise<DisputeCase[]>
  resolveDispute(id: string, patch: { status: DisputeCase['status']; outcome: string }): Promise<DisputeCase>
  getPlatformConfig(): Promise<PlatformConfig>
  updatePlatformConfig(patch: Partial<PlatformConfig>): Promise<PlatformConfig>
  getMetrics(): Promise<PlatformMetrics>
}
