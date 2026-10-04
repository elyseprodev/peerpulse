/**
 * Local reference backend (in-browser).
 *
 * Used when `VITE_BACKEND_MODE=local`. It implements the exact same contract as
 * the Firebase adapter, which means:
 *   • every screen, store and component is written once and works in both modes,
 *   • the pure domain rules (token policy, conflicts, settlement) are shared,
 *   • PeerPulse can be demonstrated end-to-end without provisioning a project.
 *
 * ⚠️  It is a development/reference implementation. Authentication here is a
 * demo stand-in (salted SHA-256 in localStorage) and must never be used in
 * production. Production uses Firebase Authentication, Firestore Security Rules
 * and Cloud Functions — see `backend/firebase/` and `firestore.rules`.
 */
import {
  DEFAULT_PLATFORM_CONFIG,
  computeTokenAmount,
  discoverSkills,
  discoveryOwner,
  signupGrantAmount,
  validateSessionDuration,
  type DiscoveryOwner,
} from '@shared'
import {
  type AppNotification,
  type Booking,
  type Community,
  type CommunityComment,
  type CommunityMember,
  type CommunityPost,
  type DisputeCase,
  type IceCandidateMessage,
  type MediaState,
  type ModerationReport,
  type PlatformConfig,
  type Review,
  type Room,
  type RoomPresence,
  type SettlementRecord,
  type SignalingMessage,
  type SkillFilter,
  type SkillListing,
  type TokenTransaction,
  type UserProfile,
  type UserRole,
  type UserStatus,
  type Wallet,
} from '@shared/domain'
import {
  accountStatusChangedDraft,
  roleChangedDraft,
  tokenGrantDraft,
} from '@shared/notify'
import { env } from '../../env'
import {
  BackendRequestError,
  type AuthSession,
  type BookingWindowQuery,
  type CreateBookingInput,
  type CreateCommunityInput,
  type CreatePostInput,
  type CreateReportInput,
  type CreateReviewInput,
  type CreateSkillInput,
  type MemberQuery,
  type PeerPulseBackend,
  type PlatformMetrics,
  type SettlementOutcomeResult,
  type SignUpInput,
  type Unsubscribe,
} from '../types'
import {
  createEmptyDatabase,
  deepClone,
  getDb,
  persist,
  resetLocalDatabase,
  setDb,
  slugify,
  sortBy,
  STORAGE_KEY,
  uid,
  type LocalDatabase,
} from './db'
import { DEMO_CREDENTIALS, DEMO_PASSWORD, demoAccountEmails, seedLocalDatabase } from './seed'
import { pushDraft } from './notify'
import * as sessions from './sessions'
import * as social from './social'

/* ───────────────────────────── auth primitives ───────────────────────────── */

function randomSalt(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Demo-only password digest. Production uses Firebase Authentication. */
async function hashPassword(password: string, salt: string): Promise<string> {
  const input = `${salt}:${password}`
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Deterministic fallback for environments without WebCrypto (e.g. older jsdom).
  let h1 = 0x811c9dc5
  let h2 = 0x1000193
  for (let i = 0; i < input.length; i += 1) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 16777619) >>> 0
    h2 = Math.imul(h2 + input.charCodeAt(i), 2246822519) >>> 0
  }
  return `${h1.toString(16)}${h2.toString(16)}`
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/* ─────────────────────────────── the backend ─────────────────────────────── */

export class LocalBackend implements PeerPulseBackend {
  readonly mode = 'local' as const
  readonly capabilities = {
    realtime: true,
    turnCredentials: env.webrtc.turnUrls.length > 0 ? ('static' as const) : ('none' as const),
    push: false,
    demoAccounts: true,
  }

  private db: LocalDatabase = createEmptyDatabase(DEFAULT_PLATFORM_CONFIG)
  private sessionListeners = new Set<(session: AuthSession | null) => void>()
  private crossTabHandler: ((event: StorageEvent) => void) | null = null

  /* ── lifecycle ─────────────────────────────────────────────────────── */

  async init(): Promise<void> {
    let database: LocalDatabase | null = null
    try {
      database = typeof localStorage !== 'undefined' ? (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as LocalDatabase | null) : null
    } catch {
      database = null
    }

    if (!database || !database.seededAt || !database.users || Object.keys(database.users).length === 0) {
      database = createEmptyDatabase(DEFAULT_PLATFORM_CONFIG)
      seedLocalDatabase(database)
      setDb(database)
      persist('db')
    } else {
      database.config = { ...DEFAULT_PLATFORM_CONFIG, ...database.config }
      setDb(database)
    }

    this.db = database
    await this.ensureDemoCredentials()
    this.attachCrossTabSync()
  }

  /**
   * Seeded demo members are created without credentials (the seed is
   * synchronous, hashing is not). Register the shared demo password for every
   * `demo_*` account so any of them can be signed in by email — which is what
   * makes the two-tab video-room demo possible. Never runs for real accounts.
   */
  private async ensureDemoCredentials(): Promise<void> {
    let changed = false
    for (const email of demoAccountEmails(this.store)) {
      if (this.store.credentials[email]) continue
      const salt = randomSalt()
      this.store.credentials[email] = { salt, hash: await hashPassword(DEMO_PASSWORD, salt) }
      changed = true
    }
    if (changed) persist('db')
  }

  /**
   * Two browser tabs on the same machine share one "database". The `storage`
   * event keeps them in sync, which is what makes the local WebRTC room usable
   * between tabs (tab A signals to tab B through the shared record set).
   */
  private attachCrossTabSync(): void {
    if (typeof window === 'undefined' || this.crossTabHandler) return
    this.crossTabHandler = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return
      try {
        const next = JSON.parse(event.newValue) as LocalDatabase
        setDb(next)
        this.db = next
        this.emitSession()
        import('./db').then(({ bus }) => bus.emit('db'))
      } catch {
        /* ignore malformed updates */
      }
    }
    window.addEventListener('storage', this.crossTabHandler)
  }

  private get store(): LocalDatabase {
    this.db = getDb()
    return this.db
  }

  private sessionFromDb(): AuthSession | null {
    const db = this.store
    const uidValue = db.session.uid
    if (!uidValue) return null
    const user = db.users[uidValue]
    if (!user) return null
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      emailVerified: true,
      demo: Boolean(db.credentials[user.email]?.hash),
    }
  }

  private emitSession(): void {
    const session = this.sessionFromDb()
    this.sessionListeners.forEach((cb) => cb(session))
  }

  onSessionChange(cb: (session: AuthSession | null) => void): Unsubscribe {
    this.sessionListeners.add(cb)
    queueMicrotask(() => cb(this.sessionFromDb()))
    return () => this.sessionListeners.delete(cb)
  }

  getSession(): AuthSession | null {
    return this.sessionFromDb()
  }

  /* ── authentication ────────────────────────────────────────────────── */

  async signUp(input: SignUpInput): Promise<AuthSession> {
    const db = this.store
    const email = input.email.trim().toLowerCase()
    const displayName = input.displayName.trim()
    const fields: Record<string, string> = {}
    if (!displayName || displayName.length < 2) fields.displayName = 'Please use at least 2 characters.'
    if (!EMAIL_PATTERN.test(email)) fields.email = 'Enter a valid email address.'
    if (!input.password || input.password.length < 8) fields.password = 'Use at least 8 characters.'
    if (Object.keys(fields).length) throw new BackendRequestError({ code: 'auth/invalid-input', message: 'Please fix the highlighted fields.', fields })

    if (Object.values(db.users).some((u) => u.email.toLowerCase() === email)) {
      throw new BackendRequestError({
        code: 'auth/email-in-use',
        message: 'An account already exists for that email.',
        fields: { email: 'That email is already registered.' },
      })
    }

    const salt = randomSalt()
    db.credentials[email] = { salt, hash: await hashPassword(input.password, salt) }

    const uidValue = `u_${slugify(email).slice(0, 20)}_${Math.random().toString(36).slice(2, 6)}`
    const now = new Date().toISOString()
    const profile: UserProfile = {
      uid: uidValue,
      email,
      displayName,
      photoURL: null,
      avatarSeed: uidValue,
      headline: '',
      bio: '',
      location: '',
      timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
      role: 'member',
      status: 'active',
      interests: [],
      languages: ['en'],
      teachSkillIds: [],
      learnSkillIds: [],
      teachCategories: [],
      learnCategories: [],
      preferredFormats: ['video'],
      availability: [],
      privacy: {
        profileVisibility: 'public',
        showEmail: false,
        showAvailability: true,
        allowDirectRequests: true,
        appearInDiscovery: true,
      },
      stats: {
        sessionsCompleted: 0,
        sessionsTaught: 0,
        teachingHours: 0,
        learningHours: 0,
        ratingSum: 0,
        reviewCount: 0,
        tokensEarned: 0,
        tokensSpent: 0,
      },
      onboarding: { completed: false, step: 0, completedAt: null, savedAt: now, skipped: false },
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
    }
    db.users[uidValue] = profile

    const grant = signupGrantAmount(db.config)
    const wallet: Wallet = {
      uid: uidValue,
      balance: grant,
      held: 0,
      lifetimeEarned: 0,
      lifetimeSpent: 0,
      lifetimeGranted: grant,
      policyVersion: db.config.version,
      updatedAt: now,
      updatedBy: 'system:signup',
    }
    db.wallets[uidValue] = wallet
    if (grant > 0) {
      const grantId = `tx_grant_${uidValue}`
      db.transactions[grantId] = {
        id: grantId,
        type: 'signup_grant',
        amount: grant,
        direction: 'credit',
        status: 'posted',
        uid: uidValue,
        counterpartyUid: null,
        bookingId: null,
        roomId: null,
        idempotencyKey: grantId,
        balanceAfter: grant,
        reason: 'Welcome grant — new members may receive introductory Time Tokens.',
        policyCode: 'signup_grant',
        createdBy: 'system:signup',
        createdAt: now,
      }
      pushDraft(db, tokenGrantDraft(uidValue, grant, 'Welcome grant — new members may receive introductory Time Tokens.', { signup: true }))
    }

    db.session.uid = uidValue
    persist('db', `wallet|${uidValue}`, `notifications|${uidValue}`)
    this.emitSession()
    return this.sessionFromDb()!
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const db = this.store
    const normalised = email.trim().toLowerCase()
    const credential = db.credentials[normalised]
    if (!credential) {
      throw new BackendRequestError({ code: 'auth/user-not-found', message: 'No account found for that email.' })
    }
    const hash = await hashPassword(password, credential.salt)
    if (hash !== credential.hash) {
      throw new BackendRequestError({ code: 'auth/wrong-password', message: 'That password is not correct.' })
    }
    const user = Object.values(db.users).find((u) => u.email.toLowerCase() === normalised)
    if (!user) throw new BackendRequestError({ code: 'auth/user-not-found', message: 'No account found for that email.' })
    if (user.status === 'suspended') {
      throw new BackendRequestError({ code: 'auth/suspended', message: 'This account is suspended. Contact a steward.' })
    }
    db.session.uid = user.uid
    user.lastActiveAt = new Date().toISOString()
    persist('db')
    this.emitSession()
    return this.sessionFromDb()!
  }

  async signInAsDemo(role: UserRole, uid?: string): Promise<AuthSession> {
    const db = this.store
    const target = uid ?? (role === 'admin' ? 'demo_admin' : 'demo_sam')
    // Only seeded demo identities can be entered this way — this is a demo
    // affordance and does not exist in the Firebase adapter at all.
    if (!target.startsWith('demo_') || !db.users[target]) {
      throw new BackendRequestError({ code: 'demo/unavailable', message: 'That demo account is not seeded in this workspace.' })
    }
    db.session.uid = target
    persist('db')
    this.emitSession()
    return this.sessionFromDb()!
  }

  async signOut(): Promise<void> {
    const db = this.store
    db.session.uid = null
    persist('db')
    this.emitSession()
  }

  async sendPasswordReset(email: string): Promise<void> {
    // Firebase Authentication owns the real email flow. In local mode we simply
    // record the attempt so the UI copy stays truthful.
    void email
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const db = this.store
    const session = this.sessionFromDb()
    if (!session) throw new BackendRequestError({ code: 'auth/required', message: 'Sign in first.' })
    const credential = db.credentials[session.email]
    if (!credential) throw new BackendRequestError({ code: 'auth/unsupported', message: 'This account has no password on file.' })
    const hash = await hashPassword(currentPassword, credential.salt)
    if (hash !== credential.hash) {
      throw new BackendRequestError({ code: 'auth/wrong-password', message: 'Your current password is not correct.' })
    }
    if (newPassword.length < 8) {
      throw new BackendRequestError({ code: 'auth/weak-password', message: 'Use at least 8 characters.', fields: { newPassword: 'Use at least 8 characters.' } })
    }
    const salt = randomSalt()
    db.credentials[session.email] = { salt, hash: await hashPassword(newPassword, salt) }
    persist('db')
  }

  /* ── members ───────────────────────────────────────────────────────── */

  async getUser(uidValue: string): Promise<UserProfile | null> {
    const user = this.store.users[uidValue]
    return user ? deepClone(user) : null
  }

  async getUsers(uids: string[]): Promise<UserProfile[]> {
    const db = this.store
    return uids.map((id) => db.users[id]).filter(Boolean).map((u) => deepClone(u))
  }

  async listMembers(query: MemberQuery = {}): Promise<UserProfile[]> {
    const db = this.store
    let items = Object.values(db.users).filter(
      (u) => u.privacy.appearInDiscovery && u.status === 'active' && u.privacy.profileVisibility === 'public',
    )
    if (query.excludeUid) items = items.filter((u) => u.uid !== query.excludeUid)
    if (query.skillId) items = items.filter((u) => u.teachSkillIds.includes(query.skillId!))
    if (query.categoryId) items = items.filter((u) => u.teachCategories.includes(query.categoryId!))
    if (query.query) {
      const needle = query.query.toLowerCase()
      items = items.filter((u) =>
        [u.displayName, u.headline, u.bio, u.location, ...u.interests].some((field) =>
          field?.toLowerCase().includes(needle),
        ),
      )
    }
    const sorted = sortBy(items, (u) => u.stats.ratingSum / Math.max(1, u.stats.reviewCount), 'desc')
    const limited = query.limit ? sorted.slice(0, query.limit) : sorted
    return limited.map((u) => deepClone(u))
  }

  async saveProfile(uidValue: string, patch: Partial<UserProfile>): Promise<UserProfile> {
    const db = this.store
    const user = db.users[uidValue]
    if (!user) throw new BackendRequestError({ code: 'user/not-found', message: 'Member not found.' })
    const session = this.sessionFromDb()
    const isSelf = session?.uid === uidValue
    const isAdmin = session?.uid ? db.users[session.uid]?.role === 'admin' : false
    if (!isSelf && !isAdmin) {
      throw new BackendRequestError({ code: 'user/forbidden', message: 'You can only edit your own profile.' })
    }

    // Server-owned fields can never be written by a member.
    const protectedKeys: Array<keyof UserProfile> = ['uid', 'email', 'role', 'status', 'stats', 'createdAt']
    const safePatch = { ...patch }
    if (!isAdmin) protectedKeys.forEach((key) => delete safePatch[key])
    if (patch.privacy) safePatch.privacy = { ...user.privacy, ...patch.privacy }

    Object.assign(user, safePatch, { updatedAt: new Date().toISOString() })
    persist('db', `users|${uidValue}`, 'db')
    return deepClone(user)
  }

  async saveOnboarding(
    uidValue: string,
    patch: Partial<UserProfile>,
    onboarding: Partial<UserProfile['onboarding']>,
  ): Promise<UserProfile> {
    const db = this.store
    const user = db.users[uidValue]
    if (!user) throw new BackendRequestError({ code: 'user/not-found', message: 'Member not found.' })
    Object.assign(user, patch, { onboarding: { ...user.onboarding, ...onboarding, savedAt: new Date().toISOString() } })
    user.updatedAt = new Date().toISOString()
    persist('db', `users|${uidValue}`)
    return deepClone(user)
  }

  async setUserRole(uidValue: string, role: UserRole): Promise<UserProfile> {
    await this.assertAdmin()
    const user = this.store.users[uidValue]
    if (!user) throw new BackendRequestError({ code: 'user/not-found', message: 'Member not found.' })
    const previousRole = user.role
    user.role = role
    user.updatedAt = new Date().toISOString()
    if (previousRole !== role) {
      const actor = this.sessionFromDb()
      pushDraft(this.store, roleChangedDraft(uidValue, role, actor?.uid ?? 'a steward'))
    }
    persist('db', `users|${uidValue}`, `notifications|${uidValue}`)
    return deepClone(user)
  }

  async setUserStatus(uidValue: string, status: UserStatus): Promise<UserProfile> {
    await this.assertAdmin()
    const user = this.store.users[uidValue]
    if (!user) throw new BackendRequestError({ code: 'user/not-found', message: 'Member not found.' })
    user.status = status
    user.updatedAt = new Date().toISOString()
    pushDraft(this.store, accountStatusChangedDraft(uidValue, status, ''))
    persist('db', `users|${uidValue}`, `notifications|${uidValue}`)
    return deepClone(user)
  }

  private async assertAdmin(): Promise<UserProfile> {
    const session = this.sessionFromDb()
    const db = this.store
    const user = session ? db.users[session.uid] : null
    if (!user || user.role !== 'admin') {
      throw new BackendRequestError({ code: 'permission/denied', message: 'Administrator permissions are required.' })
    }
    return user
  }

  /* ── skills ────────────────────────────────────────────────────────── */

  async listSkills(filter: SkillFilter & { limit?: number; ownerUid?: string; includeUnpublished?: boolean } = {}): Promise<SkillListing[]> {
    const db = this.store
    // The pipeline lives in `shared/discovery.ts`, which the Firestore backend
    // also calls — see the note at the top of that module for the three ways the
    // two implementations had drifted apart.
    const candidates = filter.ownerUid
      ? Object.values(db.skills).filter((skill) => skill.ownerUid === filter.ownerUid)
      : Object.values(db.skills)
    const owners: Record<string, DiscoveryOwner> = {}
    for (const skill of candidates) {
      const profile = db.users[skill.ownerUid]
      if (profile && !owners[skill.ownerUid]) owners[skill.ownerUid] = discoveryOwner(profile)
    }
    return discoverSkills(candidates, filter, owners, filter.limit, {
      includeUnpublished: filter.includeUnpublished,
    }).map((skill) => deepClone(skill))
  }

  async getSkill(id: string): Promise<SkillListing | null> {
    const skill = this.store.skills[id]
    return skill ? deepClone(skill) : null
  }

  async createSkill(input: CreateSkillInput): Promise<SkillListing> {
    const db = this.store
    const session = this.sessionFromDb()
    if (!session || session.uid !== input.ownerUid) {
      throw new BackendRequestError({ code: 'permission/denied', message: 'You can only create listings on your own profile.' })
    }
    const fields: Record<string, string> = {}
    if (!input.title || input.title.trim().length < 5) fields.title = 'Give your listing a clear title (5+ characters).'
    if (!input.description || input.description.trim().length < 30) {
      fields.description = 'Describe what you will cover — at least 30 characters.'
    }
    if (!input.categoryId) fields.categoryId = 'Choose a category.'
    const durationError = validateSessionDuration(input.durationMinutes, db.config)
    if (durationError) fields.durationMinutes = durationError
    if (Object.keys(fields).length) {
      throw new BackendRequestError({ code: 'skill/invalid', message: 'Please fix the highlighted fields.', fields })
    }

    const id = uid('skill')
    const now = new Date().toISOString()
    const listing: SkillListing = {
      id,
      ownerUid: input.ownerUid,
      title: input.title.trim(),
      slug: slugify(input.title),
      categoryId: input.categoryId,
      description: input.description.trim(),
      outcomes: input.outcomes.filter(Boolean).slice(0, 8),
      level: input.level,
      languages: input.languages.length ? input.languages : ['en'],
      format: input.format,
      durationMinutes: input.durationMinutes,
      tags: input.tags.filter(Boolean).slice(0, 12),
      status: 'published',
      moderation: { state: 'clean', reason: null, reviewedByUid: null, reviewedAt: null },
      bookingCount: 0,
      completedCount: 0,
      ratingSum: 0,
      reviewCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    db.skills[id] = listing
    const owner = db.users[input.ownerUid]
    if (owner && !owner.teachSkillIds.includes(id)) owner.teachSkillIds.push(id)
    if (owner && !owner.teachCategories.includes(input.categoryId)) owner.teachCategories.push(input.categoryId)

    persist('db', 'skills', `users|${input.ownerUid}`)
    return deepClone(listing)
  }

  async updateSkill(id: string, patch: Partial<SkillListing>): Promise<SkillListing> {
    const db = this.store
    const session = this.sessionFromDb()
    const skill = db.skills[id]
    if (!skill) throw new BackendRequestError({ code: 'skill/not-found', message: 'Listing not found.' })
    const isOwner = session?.uid === skill.ownerUid
    const isAdmin = session ? db.users[session.uid]?.role === 'admin' : false
    if (!isOwner && !isAdmin) throw new BackendRequestError({ code: 'permission/denied', message: 'You can only edit your own listings.' })

    const safePatch = { ...patch }
    delete safePatch.id
    delete safePatch.ownerUid
    if (!isAdmin) {
      delete safePatch.moderation
      delete safePatch.ratingSum
      delete safePatch.reviewCount
      delete safePatch.completedCount
    }
    Object.assign(skill, safePatch, { updatedAt: new Date().toISOString() })
    persist('db', 'skills')
    return deepClone(skill)
  }

  async removeSkill(id: string): Promise<void> {
    const db = this.store
    const session = this.sessionFromDb()
    const skill = db.skills[id]
    if (!skill) return
    const isOwner = session?.uid === skill.ownerUid
    const isAdmin = session ? db.users[session.uid]?.role === 'admin' : false
    if (!isOwner && !isAdmin) throw new BackendRequestError({ code: 'permission/denied', message: 'You can only remove your own listings.' })
    skill.status = 'removed'
    skill.updatedAt = new Date().toISOString()
    const owner = db.users[skill.ownerUid]
    if (owner) owner.teachSkillIds = owner.teachSkillIds.filter((s) => s !== id)
    persist('db', 'skills', `users|${skill.ownerUid}`)
  }

  /* ── bookings (delegated) ──────────────────────────────────────────── */

  /** Uid of the signed-in member, or null when nobody is signed in. */
  private sessionUid(): string | null {
    return this.store.session.uid
  }

  /** True when the signed-in member is on the booking that owns this room. */
  private isRoomParticipant(roomId: string): boolean {
    const actor = this.sessionUid()
    const room = this.store.rooms[roomId]
    return Boolean(actor && room && room.participants.includes(actor))
  }

  private actorUid(): string {
    const session = this.sessionFromDb()
    if (!session) throw new BackendRequestError({ code: 'auth/required', message: 'Please sign in to continue.' })
    return session.uid
  }

  listBookings(uidValue: string): Promise<Booking[]> {
    return Promise.resolve(sessions.listBookingsForUser(this.store, uidValue).map(deepClone))
  }

  getBooking(id: string): Promise<Booking | null> {
    const booking = this.store.bookings[id]
    return Promise.resolve(booking ? deepClone(booking) : null)
  }

  listBookingsInWindow(query: BookingWindowQuery): Promise<Booking[]> {
    return Promise.resolve(sessions.listBookingsInWindow(this.store, query).map(deepClone))
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const booking = sessions.createBooking(this.store, input, this.actorUid())
    return deepClone(booking)
  }

  async confirmBooking(id: string): Promise<Booking> {
    return deepClone(sessions.confirmBooking(this.store, id, this.actorUid()))
  }

  async declineBooking(id: string, reason: string): Promise<Booking> {
    return deepClone(sessions.declineBooking(this.store, id, reason, this.actorUid()))
  }

  async cancelBooking(id: string, reason: string): Promise<Booking> {
    return deepClone(sessions.cancelBooking(this.store, id, reason, this.actorUid()))
  }

  async rescheduleBooking(id: string, startAt: string, endAt: string, reason: string): Promise<Booking> {
    return deepClone(sessions.rescheduleBooking(this.store, id, startAt, endAt, reason, this.actorUid()))
  }

  async confirmCompletion(id: string, uidValue: string): Promise<SettlementOutcomeResult> {
    return sessions.confirmCompletion(this.store, id, uidValue)
  }

  async requestSettlement(id: string): Promise<SettlementOutcomeResult> {
    return sessions.settleBooking(this.store, id, `user:${this.actorUid()}`)
  }

  async raiseDispute(id: string, claim: string): Promise<DisputeCase> {
    return deepClone(sessions.raiseDispute(this.store, id, claim, this.actorUid()))
  }

  async listSettlements(): Promise<SettlementRecord[]> {
    await this.assertAdmin()
    return sessions.listSettlements(this.store).map(deepClone)
  }

  /* ── video rooms (delegated) ───────────────────────────────────────── */

  getRoom(roomId: string): Promise<Room | null> {
    const room = this.store.rooms[roomId]
    if (!room) return Promise.resolve(null)
    // Rooms are private to the two members on the booking. Firestore enforces
    // this in the Security Rules; the reference backend mirrors it here.
    const actor = this.sessionUid()
    if (!actor || !room.participants.includes(actor)) return Promise.resolve(null)
    return Promise.resolve(deepClone(room))
  }

  getRoomForBooking(bookingId: string): Promise<Room | null> {
    const booking = this.store.bookings[bookingId]
    const room = booking?.roomId ? this.store.rooms[booking.roomId] : null
    if (!room) return Promise.resolve(null)
    const actor = this.sessionUid()
    if (!actor || !room.participants.includes(actor)) return Promise.resolve(null)
    return Promise.resolve(deepClone(room))
  }

  async ensureRoom(bookingId: string): Promise<Room> {
    return deepClone(sessions.ensureRoom(this.store, bookingId, this.actorUid()))
  }

  async getIceServers(): Promise<RTCIceServer[]> {
    const servers: RTCIceServer[] = [{ urls: [...env.webrtc.stunUrls] }]
    if (env.webrtc.turnUrls.length) {
      servers.push({
        urls: [...env.webrtc.turnUrls],
        username: env.webrtc.turnUsername || undefined,
        credential: env.webrtc.turnCredential || undefined,
      })
    }
    return servers
  }

  async registerPresence(roomId: string, uidValue: string, media: MediaState): Promise<RoomPresence> {
    if (uidValue !== this.actorUid()) {
      throw new BackendRequestError({ code: 'permission/denied', message: 'You can only register your own presence.' })
    }
    return deepClone(sessions.registerPresence(this.store, roomId, uidValue, media))
  }

  async updatePresence(roomId: string, uidValue: string, patch: Partial<RoomPresence>): Promise<void> {
    if (uidValue !== this.actorUid()) {
      throw new BackendRequestError({ code: 'permission/denied', message: 'You can only update your own presence.' })
    }
    sessions.updatePresence(this.store, roomId, uidValue, patch)
  }

  async leavePresence(roomId: string, uidValue: string): Promise<void> {
    if (uidValue !== this.actorUid()) {
      throw new BackendRequestError({ code: 'permission/denied', message: 'You can only update your own presence.' })
    }
    sessions.leavePresence(this.store, roomId, uidValue)
  }

  listPresence(roomId: string): Promise<RoomPresence[]> {
    if (!this.isRoomParticipant(roomId)) return Promise.resolve([])
    return Promise.resolve(sessions.listPresence(this.store, roomId))
  }

  watchPresence(roomId: string, cb: (presence: RoomPresence[]) => void): Unsubscribe {
    const push = () => cb(this.isRoomParticipant(roomId) ? sessions.listPresence(this.store, roomId) : [])
    import('./db').then(({ bus }) => {
      const offTopic = bus.subscribe(`presence|${roomId}`, push)
      const offDb = bus.subscribe('db', push)
      this.presenceUnsubscribers.set(cb, () => {
        offTopic()
        offDb()
      })
    })
    const interval = setInterval(push, 1500)
    return () => {
      clearInterval(interval)
      const off = this.presenceUnsubscribers.get(cb)
      off?.()
      this.presenceUnsubscribers.delete(cb)
    }
  }

  private presenceUnsubscribers = new Map<(presence: RoomPresence[]) => void, () => void>()

  async startSession(roomId: string, uidValue: string): Promise<Room> {
    return deepClone(sessions.startSession(this.store, roomId, uidValue))
  }

  async endSession(roomId: string, uidValue: string): Promise<SettlementOutcomeResult> {
    return sessions.endSession(this.store, roomId, uidValue)
  }

  async sendSignal(roomId: string, message: Omit<SignalingMessage, 'id' | 'createdAt'>): Promise<void> {
    const db = this.store
    // Only the two participants may write into a room's signalling channel, and
    // only under their own identity — otherwise any member could hijack a call.
    sessions.requireRoomAccess(db, roomId, this.actorUid())
    if (message.from !== this.actorUid()) {
      throw new BackendRequestError({ code: 'permission/denied', message: 'Signalling messages must be sent as yourself.' })
    }
    const list = db.signals[roomId] ?? []
    list.push({ ...message, id: uid('sig'), createdAt: new Date().toISOString() })
    // Keep the signalling log bounded — it is a transport, not a history.
    db.signals[roomId] = list.slice(-40)
    persist(`signals|${roomId}`, 'db')
  }

  watchSignals(roomId: string, uidValue: string, cb: (message: SignalingMessage) => void): Unsubscribe {
    const delivered = new Set<string>()
    const push = () => {
      const messages = (this.store.signals[roomId] ?? []).filter((m) => m.to === uidValue && m.from !== uidValue)
      for (const message of messages) {
        if (delivered.has(message.id)) continue
        delivered.add(message.id)
        cb(message)
      }
    }
    push()
    const interval = setInterval(push, 700)
    return () => clearInterval(interval)
  }

  async sendCandidate(roomId: string, message: Omit<IceCandidateMessage, 'id' | 'createdAt'>): Promise<void> {
    const db = this.store
    sessions.requireRoomAccess(db, roomId, this.actorUid())
    if (message.from !== this.actorUid()) {
      throw new BackendRequestError({ code: 'permission/denied', message: 'ICE candidates must be sent as yourself.' })
    }
    const list = db.candidates[roomId] ?? []
    list.push({ ...message, id: uid('ice'), createdAt: new Date().toISOString() })
    db.candidates[roomId] = list.slice(-200)
    persist(`candidates|${roomId}`, 'db')
  }

  watchCandidates(roomId: string, uidValue: string, cb: (message: IceCandidateMessage) => void): Unsubscribe {
    const delivered = new Set<string>()
    const push = () => {
      const messages = (this.store.candidates[roomId] ?? []).filter((m) => m.to === uidValue)
      for (const message of messages) {
        if (delivered.has(message.id)) continue
        delivered.add(message.id)
        cb(message)
      }
    }
    push()
    const interval = setInterval(push, 700)
    return () => clearInterval(interval)
  }

  /* ── wallet & ledger ───────────────────────────────────────────────── */

  async getWallet(uidValue: string): Promise<Wallet> {
    const db = this.store
    const wallet = db.wallets[uidValue]
    if (!wallet) {
      const now = new Date().toISOString()
      const created: Wallet = {
        uid: uidValue,
        balance: 0,
        held: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0,
        lifetimeGranted: 0,
        policyVersion: db.config.version,
        updatedAt: now,
        updatedBy: 'system:reconcile',
      }
      db.wallets[uidValue] = created
      persist('db', `wallet|${uidValue}`)
      return deepClone(created)
    }
    return deepClone(wallet)
  }

  watchWallet(uidValue: string, cb: (wallet: Wallet) => void): Unsubscribe {
    const push = () => {
      const wallet = this.store.wallets[uidValue]
      if (wallet) cb(deepClone(wallet))
    }
    let off: (() => void) | null = null
    import('./db').then(({ bus }) => {
      off = bus.subscribe(`wallet|${uidValue}`, push)
    })
    const interval = setInterval(push, 2000)
    push()
    return () => {
      clearInterval(interval)
      off?.()
    }
  }

  async listTransactions(uidValue: string, options: { limit?: number; bookingId?: string } = {}): Promise<TokenTransaction[]> {
    const db = this.store
    let items = Object.values(db.transactions).filter((t) => t.uid === uidValue)
    if (options.bookingId) items = items.filter((t) => t.bookingId === options.bookingId)
    const sorted = sortBy(items, (t) => Date.parse(t.createdAt), 'desc')
    return (options.limit ? sorted.slice(0, options.limit) : sorted).map(deepClone)
  }

  async listAllTransactions(options: { limit?: number } = {}): Promise<TokenTransaction[]> {
    await this.assertAdmin()
    const sorted = sortBy(Object.values(this.store.transactions), (t) => Date.parse(t.createdAt), 'desc')
    return (options.limit ? sorted.slice(0, options.limit) : sorted).map(deepClone)
  }

  async adjustWallet(uidValue: string, amount: number, reason: string): Promise<Wallet> {
    const admin = await this.assertAdmin()
    const db = this.store
    const wallet = await this.getWallet(uidValue)
    const direction = amount >= 0 ? 'credit' : 'debit'
    const magnitude = Math.abs(amount)
    if (magnitude === 0) throw new BackendRequestError({ code: 'wallet/invalid', message: 'Enter a non-zero adjustment.' })
    if (direction === 'debit' && wallet.balance < magnitude) {
      throw new BackendRequestError({ code: 'wallet/insufficient', message: 'That adjustment would create a negative balance.' })
    }

    const id = uid('tx')
    const now = new Date().toISOString()
    wallet.balance = Math.round((wallet.balance + amount) * 10_000) / 10_000
    if (direction === 'credit') wallet.lifetimeGranted = Math.round((wallet.lifetimeGranted + magnitude) * 10_000) / 10_000
    wallet.updatedAt = now
    wallet.updatedBy = `admin:${admin.uid}`
    db.wallets[uidValue] = wallet
    db.transactions[id] = {
      id,
      type: 'admin_adjustment',
      amount: magnitude,
      direction,
      status: 'posted',
      uid: uidValue,
      counterpartyUid: null,
      bookingId: null,
      roomId: null,
      idempotencyKey: id,
      balanceAfter: wallet.balance,
      reason: reason || 'Administrator adjustment',
      policyCode: 'admin_adjustment',
      createdBy: `admin:${admin.uid}`,
      createdAt: now,
    }
    pushDraft(db, tokenGrantDraft(uidValue, amount, reason))
    persist('db', `wallet|${uidValue}`, `notifications|${uidValue}`)
    return deepClone(wallet)
  }

  /* ── reviews ───────────────────────────────────────────────────────── */

  async listReviewsForUser(uidValue: string): Promise<Review[]> {
    const items = Object.values(this.store.reviews).filter(
      (r) => r.subjectUid === uidValue && r.moderation.state !== 'removed',
    )
    return sortBy(items, (r) => Date.parse(r.createdAt), 'desc').map(deepClone)
  }

  async listReviewsForSkill(skillId: string): Promise<Review[]> {
    const items = Object.values(this.store.reviews).filter((r) => r.skillId === skillId && r.moderation.state !== 'removed')
    return sortBy(items, (r) => Date.parse(r.createdAt), 'desc').map(deepClone)
  }

  async listReviewsForBooking(bookingId: string): Promise<Review[]> {
    const items = Object.values(this.store.reviews).filter((r) => r.bookingId === bookingId)
    return items.map(deepClone)
  }

  async createReview(input: CreateReviewInput): Promise<Review> {
    return deepClone(sessions.createReview(this.store, input))
  }

  async respondToReview(id: string, text: string): Promise<Review> {
    return deepClone(sessions.respondToReview(this.store, id, text, this.actorUid()))
  }

  /* ── notifications ─────────────────────────────────────────────────── */

  async listNotifications(uidValue: string): Promise<AppNotification[]> {
    const items = Object.values(this.store.notifications).filter((n) => n.uid === uidValue)
    return sortBy(items, (n) => Date.parse(n.createdAt), 'desc').map(deepClone)
  }

  watchNotifications(uidValue: string, cb: (items: AppNotification[]) => void): Unsubscribe {
    const push = () => {
      const items = sortBy(
        Object.values(this.store.notifications).filter((n) => n.uid === uidValue),
        (n) => Date.parse(n.createdAt),
        'desc',
      )
      cb(items.map(deepClone))
    }
    let off: (() => void) | null = null
    import('./db').then(({ bus }) => {
      off = bus.subscribe(`notifications|${uidValue}`, push)
    })
    const interval = setInterval(push, 2500)
    push()
    return () => {
      clearInterval(interval)
      off?.()
    }
  }

  async markNotificationRead(id: string): Promise<void> {
    const db = this.store
    const notification = db.notifications[id]
    if (!notification) return
    notification.read = true
    persist('db', `notifications|${notification.uid}`)
  }

  async markAllNotificationsRead(uidValue: string): Promise<void> {
    const db = this.store
    Object.values(db.notifications)
      .filter((n) => n.uid === uidValue && !n.read)
      .forEach((n) => {
        n.read = true
      })
    persist('db', `notifications|${uidValue}`)
  }

  /* ── communities ───────────────────────────────────────────────────── */

  async listCommunities(options?: { limit?: number; memberUid?: string; categoryId?: string }): Promise<Community[]> {
    return social.listCommunities(this.store, options ?? {}).map(deepClone)
  }

  async getCommunity(id: string): Promise<Community | null> {
    const community = social.getCommunity(this.store, id)
    return community ? deepClone(community) : null
  }

  async createCommunity(input: CreateCommunityInput): Promise<Community> {
    const actor = this.actorUid()
    return deepClone(social.createCommunity(this.store, { ...input, ownerUid: actor }))
  }

  async joinCommunity(id: string, uidValue: string): Promise<Community> {
    return deepClone(social.joinCommunity(this.store, id, uidValue))
  }

  async leaveCommunity(id: string, uidValue: string): Promise<Community> {
    return deepClone(social.leaveCommunity(this.store, id, uidValue))
  }

  async listCommunityMembers(communityId: string): Promise<CommunityMember[]> {
    return social.listCommunityMembers(this.store, communityId).map(deepClone)
  }

  async listPosts(options: { communityId?: string; limit?: number; kind?: CommunityPost['kind'] }): Promise<CommunityPost[]> {
    return social.listPosts(this.store, options).map(deepClone)
  }

  async createPost(input: CreatePostInput): Promise<CommunityPost> {
    return deepClone(social.createPost(this.store, input))
  }

  async reactToPost(postId: string, uidValue: string, emoji: string): Promise<CommunityPost> {
    return deepClone(social.reactToPost(this.store, postId, uidValue, emoji))
  }

  async listComments(postId: string): Promise<CommunityComment[]> {
    return social.listComments(this.store, postId).map(deepClone)
  }

  async createComment(input: { postId: string; communityId: string; authorUid: string; body: string }): Promise<CommunityComment> {
    return deepClone(social.createComment(this.store, input))
  }

  /* ── moderation & administration ───────────────────────────────────── */

  async createReport(input: CreateReportInput): Promise<ModerationReport> {
    return deepClone(social.createReport(this.store, input))
  }

  async listReports(): Promise<ModerationReport[]> {
    await this.assertAdmin()
    return social.listReports(this.store).map(deepClone)
  }

  async resolveReport(id: string, patch: { status: ModerationReport['status']; resolution: string }): Promise<ModerationReport> {
    const admin = await this.assertAdmin()
    return deepClone(social.resolveReport(this.store, id, patch, admin.uid))
  }

  async listDisputes(): Promise<DisputeCase[]> {
    await this.assertAdmin()
    return social.listDisputes(this.store).map(deepClone)
  }

  async resolveDispute(id: string, patch: { status: DisputeCase['status']; outcome: string }): Promise<DisputeCase> {
    const admin = await this.assertAdmin()
    return deepClone(social.resolveDispute(this.store, id, patch, admin.uid))
  }

  async getPlatformConfig(): Promise<PlatformConfig> {
    return deepClone(this.store.config)
  }

  async updatePlatformConfig(patch: Partial<PlatformConfig>): Promise<PlatformConfig> {
    const admin = await this.assertAdmin()
    const db = this.store
    db.config = {
      ...db.config,
      ...patch,
      token: { ...db.config.token, ...(patch.token ?? {}) },
      booking: { ...db.config.booking, ...(patch.booking ?? {}) },
      settlement: { ...db.config.settlement, ...(patch.settlement ?? {}) },
      cancellation: { ...db.config.cancellation, ...(patch.cancellation ?? {}) },
      community: { ...db.config.community, ...(patch.community ?? {}) },
      updatedAt: new Date().toISOString(),
      updatedByUid: admin.uid,
    }
    persist('db', 'config')
    return deepClone(db.config)
  }

  async getMetrics(): Promise<PlatformMetrics> {
    await this.assertAdmin()
    const db = this.store
    const bookings = Object.values(db.bookings)
    const completed = bookings.filter((b) => b.status === 'completed')
    const reviews = Object.values(db.reviews)
    return {
      members: Object.keys(db.users).length,
      activeListings: Object.values(db.skills).filter((s) => s.status === 'published').length,
      communities: Object.keys(db.communities).length,
      bookings: bookings.length,
      completedSessions: completed.length,
      disputedSessions: Object.values(db.disputes).filter((d) => d.status === 'open').length,
      tokensInCirculation: Math.round(
        Object.values(db.wallets).reduce((sum, w) => sum + w.balance, 0) * 10_000,
      ) / 10_000,
      tokensSettled: Math.round(
        Object.values(db.transactions)
          .filter((t) => t.status === 'posted')
          .reduce((sum, t) => sum + t.amount, 0) * 10_000,
      ) / 10_000,
      hoursTraded: Math.round((completed.reduce((sum, b) => sum + b.durationMinutes, 0) / 60) * 10) / 10,
      openReports: Object.values(db.reports).filter((r) => r.status === 'open').length,
      averageRating: reviews.length
        ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) * 10) / 10
        : 0,
      generatedAt: new Date().toISOString(),
    }
  }

  /* ── helpers used by the UI in demo mode ───────────────────────────── */

  /** Rebuild the demo world from scratch (Settings → “Reset demo data”). */
  async resetDemoData(): Promise<void> {
    resetLocalDatabase({ ...DEFAULT_PLATFORM_CONFIG })
    const database = createEmptyDatabase({ ...DEFAULT_PLATFORM_CONFIG })
    seedLocalDatabase(database)
    setDb(database)
    this.db = database
    persist('db')
    this.emitSession()
  }

  get demoCredentials() {
    return DEMO_CREDENTIALS
  }

  /** Amount of tokens a given duration costs under the active policy. */
  async quoteTokens(durationMinutes: number): Promise<number> {
    return computeTokenAmount(durationMinutes, this.store.config)
  }
}
