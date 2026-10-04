/**
 * Firebase backend adapter (production path).
 *
 * Trust model
 * -----------
 * • Reads go straight to Firestore. Security rules decide what a member may see,
 *   so a modified client can read nothing extra.
 * • Privileged writes go through Cloud Functions (callables). The client can
 *   never write a wallet, a ledger row, a settlement, a booking status change or
 *   a room's attendance — those live behind server-side assertions.
 * • Convenience writes that a member legitimately owns (profile, listings, own
 *   posts, marking notifications read, presence heartbeats, signalling) write
 *   directly to Firestore, constrained by rules.
 */
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getIdTokenResult,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword,
  updateProfile,
  type User,
} from 'firebase/auth'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as queryLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore'
import { httpsCallable, type Functions } from 'firebase/functions'
import {
  discoverSkills,
  discoveryOwner,
  needsClientSideFiltering,
  type DiscoveryOwner,
} from '@shared'
import type {
  AppNotification,
  Booking,
  Community,
  CommunityComment,
  CommunityMember,
  CommunityPost,
  DisputeCase,
  IceCandidateMessage,
  MediaState,
  ModerationReport,
  ModerationState,
  PlatformConfig,
  Review,
  Room,
  RoomPresence,
  SettlementRecord,
  SignalingMessage,
  SkillFilter,
  SkillListing,
  TokenTransaction,
  UserProfile,
  UserRole,
  UserStatus,
  Wallet,
} from '@shared/domain'
import type {
  AuthSession,
  BackendCapabilities,
  BookingWindowQuery,
  CreateBookingInput,
  CreateCommunityInput,
  CreatePostInput,
  CreateReportInput,
  CreateReviewInput,
  CreateSkillInput,
  MemberQuery,
  PeerPulseBackend,
  PlatformMetrics,
  SettlementOutcomeResult,
  SignUpInput,
  Unsubscribe,
} from '../types'
import { BackendRequestError } from '../types'
import { env } from '../../env'
import {
  COLLECTIONS,
  getCallableFunctions,
  getDb,
  getFirebaseAuth,
  initAppCheck,
  initPersistence,
} from './app'
import { fromFirestoreValue, fromQuery, fromSnapshot, toFirestoreValue } from './convert'

/** Callable function names — must match `functions/src/index.ts` exports. */
export const CALLABLE = {
  createBooking: 'createBooking',
  respondToBooking: 'respondToBooking',
  confirmCompletion: 'confirmCompletion',
  settleSession: 'settleSession',
  openRoom: 'openRoom',
  endSession: 'endSession',
  createReview: 'createReview',
  resolveReport: 'resolveReport',
  resolveDispute: 'resolveDispute',
  adjustWallet: 'adjustWallet',
  updatePlatformConfig: 'updatePlatformConfig',
  setUserRole: 'setUserRole',
  setUserStatus: 'setUserStatus',
  getMetrics: 'getMetrics',
  getTurnCredentials: 'getTurnCredentials',
} as const

function toError(error: unknown, fallback: string): BackendRequestError {
  const candidate = error as { code?: string; message?: string; details?: unknown }
  const code = (candidate?.code ?? 'backend/error').replace('functions/', '')
  const details = candidate?.details as { fields?: Record<string, string>; message?: string } | undefined
  return new BackendRequestError({
    code,
    message: details?.message ?? candidate?.message ?? fallback,
    fields: details?.fields,
  })
}

export class FirebaseBackend implements PeerPulseBackend {
  readonly mode = 'firebase' as const
  readonly capabilities: BackendCapabilities = {
    realtime: true,
    turnCredentials: 'server',
    push: true,
    demoAccounts: false,
  }

  private session: AuthSession | null = null
  private sessionListeners = new Set<(session: AuthSession | null) => void>()
  private unsubscribeAuth: Unsubscribe | null = null

  /* ── lifecycle ─────────────────────────────────────────────────────── */

  async init(): Promise<void> {
    await initPersistence()
    await initAppCheck()

    this.unsubscribeAuth?.()
    this.unsubscribeAuth = onAuthStateChanged(getFirebaseAuth(), (user) => {
      void this.handleUser(user)
    })
  }

  private async handleUser(user: User | null): Promise<void> {
    if (!user) {
      this.session = null
      this.emitSession()
      return
    }
    this.session = {
      uid: user.uid,
      email: user.email ?? '',
      displayName: user.displayName ?? user.email ?? 'PeerPulse member',
      photoURL: user.photoURL,
      emailVerified: user.emailVerified,
    }
    this.emitSession()
  }

  private emitSession(): void {
    this.sessionListeners.forEach((listener) => listener(this.session))
  }

  onSessionChange(cb: (session: AuthSession | null) => void): Unsubscribe {
    this.sessionListeners.add(cb)
    cb(this.session ?? (getFirebaseAuth().currentUser ? null : null))
    return () => this.sessionListeners.delete(cb)
  }

  getSession(): AuthSession | null {
    return this.session
  }

  /** Admins are identified by a custom claim; the profile doc mirrors it for UI. */
  private async isAdmin(): Promise<boolean> {
    const user = getFirebaseAuth().currentUser
    if (!user) return false
    try {
      const token = await getIdTokenResult(user, true)
      return token.claims.admin === true
    } catch {
      return false
    }
  }

  /* ── callables ─────────────────────────────────────────────────────── */

  private callable<T>(name: string) {
    const functions = getCallableFunctions() as Functions
    return httpsCallable<unknown, T>(functions, name)
  }

  private async invoke<T>(name: string, payload?: unknown): Promise<T> {
    try {
      const result = await this.callable<T>(name)(payload ?? {})
      return fromFirestoreValue<T>(result.data)
    } catch (error) {
      throw toError(error, `The ${name} operation failed.`)
    }
  }

  /* ── authentication ────────────────────────────────────────────────── */

  async signUp(input: SignUpInput): Promise<AuthSession> {
    try {
      const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), input.email.trim(), input.password)
      if (input.displayName) await updateProfile(credential.user, { displayName: input.displayName.trim() })
      await credential.user.getIdToken(true)
      // The `onUserCreate` Cloud Function provisions the profile, wallet and
      // initial grant atomically from the auth event.
      let profile: UserProfile | null = null
      for (let attempt = 0; attempt < 6 && !profile; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        profile = await this.getUser(credential.user.uid)
      }
      await this.handleUser(credential.user)
      return this.session!
    } catch (error) {
      throw toError(error, 'Could not create your account.')
    }
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    try {
      const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password)
      await this.handleUser(credential.user)
      return this.session!
    } catch (error) {
      throw toError(error, 'Sign-in failed. Check your email and password.')
    }
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(getFirebaseAuth())
    this.session = null
    this.emitSession()
  }

  async sendPasswordReset(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), email.trim())
    } catch (error) {
      throw toError(error, 'Could not send the reset email.')
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const user = getFirebaseAuth().currentUser
    if (!user || !user.email) throw new BackendRequestError({ code: 'auth/required', message: 'Sign in first.' })
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword))
      await updatePassword(user, newPassword)
    } catch (error) {
      throw toError(error, 'Could not change your password.')
    }
  }

  /* ── members ───────────────────────────────────────────────────────── */

  async getUser(uid: string): Promise<UserProfile | null> {
    const snapshot = await getDoc(doc(getDb(), COLLECTIONS.users, uid))
    return fromSnapshot<UserProfile>(snapshot)
  }

  async getUsers(uids: string[]): Promise<UserProfile[]> {
    const unique = [...new Set(uids)].filter(Boolean).slice(0, 30)
    if (!unique.length) return []
    const db = getDb()
    // Fetch in parallel; getDocByIds has no client SDK equivalent for pagination.
    const results = await Promise.all(unique.map((uid) => getDoc(doc(db, COLLECTIONS.users, uid))))
    return results
      .map((snapshot) => fromSnapshot<UserProfile>(snapshot))
      .filter((profile): profile is UserProfile => Boolean(profile))
  }

  async listMembers(options: MemberQuery = {}): Promise<UserProfile[]> {
    const db = getDb()
    const constraints: QueryConstraint[] = [
      where('status', '==', 'active'),
      where('privacy.appearInDiscovery', '==', true),
      where('privacy.profileVisibility', '==', 'public'),
      queryLimit(options.limit ?? 60),
    ]
    const snapshot = await getDocs(query(collection(db, COLLECTIONS.users), ...constraints))
    let members = fromQuery<UserProfile>(snapshot.docs)
    if (options.excludeUid) members = members.filter((m) => m.uid !== options.excludeUid)
    if (options.skillId) members = members.filter((m) => m.teachSkillIds.includes(options.skillId!))
    if (options.categoryId) members = members.filter((m) => m.teachCategories.includes(options.categoryId!))
    if (options.query) {
      const needle = options.query.toLowerCase()
      members = members.filter((m) =>
        [m.displayName, m.headline, m.bio, m.location].some((field) => field?.toLowerCase().includes(needle)),
      )
    }
    return members
  }

  async saveProfile(uid: string, patch: Partial<UserProfile>): Promise<UserProfile> {
    const db = getDb()
    const safe: Record<string, unknown> = { ...patch, updatedAt: new Date().toISOString() }
    // Fields the client may never author, even for its own document.
    for (const key of ['uid', 'email', 'role', 'status', 'stats', 'createdAt']) delete safe[key]
    try {
      await updateDoc(doc(db, COLLECTIONS.users, uid), toFirestoreValue(safe) as DocumentData)
    } catch (error) {
      throw toError(error, 'Could not save your profile.')
    }
    const profile = await this.getUser(uid)
    if (!profile) throw new BackendRequestError({ code: 'user/not-found', message: 'Profile disappeared after the save.' })
    return profile
  }

  async saveOnboarding(
    uid: string,
    patch: Partial<UserProfile>,
    onboarding: Partial<UserProfile['onboarding']>,
  ): Promise<UserProfile> {
    const db = getDb()
    const safe: Record<string, unknown> = { ...patch }
    for (const key of ['uid', 'email', 'role', 'status', 'stats', 'createdAt']) delete safe[key]
    await updateDoc(doc(db, COLLECTIONS.users, uid), {
      ...(toFirestoreValue(safe) as DocumentData),
      onboarding: {
        ...onboarding,
        savedAt: new Date().toISOString(),
        completedAt: onboarding.completed ? new Date().toISOString() : (onboarding.completedAt ?? null),
      },
      updatedAt: new Date().toISOString(),
    })
    const profile = await this.getUser(uid)
    if (!profile) throw new BackendRequestError({ code: 'user/not-found', message: 'Profile disappeared after the save.' })
    return profile
  }

  async setUserRole(uid: string, role: UserRole): Promise<UserProfile> {
    await this.invoke(CALLABLE.setUserRole, { uid, role })
    const profile = await this.getUser(uid)
    if (!profile) throw new BackendRequestError({ code: 'user/not-found', message: 'Member not found.' })
    return profile
  }

  async setUserStatus(uid: string, status: UserStatus): Promise<UserProfile> {
    await this.invoke(CALLABLE.setUserStatus, { uid, status })
    const profile = await this.getUser(uid)
    if (!profile) throw new BackendRequestError({ code: 'user/not-found', message: 'Member not found.' })
    return profile
  }

  /* ── skills ────────────────────────────────────────────────────────── */

  async listSkills(
    filter: SkillFilter & { limit?: number; ownerUid?: string; includeUnpublished?: boolean } = {},
  ): Promise<SkillListing[]> {
    const db = getDb()
    const constraints: QueryConstraint[] = []
    if (filter.ownerUid) {
      constraints.push(where('ownerUid', '==', filter.ownerUid))
    } else {
      constraints.push(where('status', '==', 'published'))
    }
    if (filter.categoryId) constraints.push(where('categoryId', '==', filter.categoryId))
    if (filter.format) constraints.push(where('format', '==', filter.format))
    // The limit may only be pushed into the query when the database can answer it
    // in full — otherwise a matching listing ranked after the cut-off is lost
    // silently. Everything else is decided by the shared pipeline below, which the
    // local backend runs too.
    if (!needsClientSideFiltering(filter)) constraints.push(queryLimit(filter.limit ?? 60))

    const snapshot = await getDocs(query(collection(db, COLLECTIONS.skills), ...constraints))
    const candidates = fromQuery<SkillListing>(snapshot.docs)

    // Owner names and availability are part of discovery (search and the weekday
    // filter), so fetch the owners of the candidates in one round trip.
    const ownerUids = [...new Set(candidates.map((skill) => skill.ownerUid))]
    const owners: Record<string, DiscoveryOwner> = {}
    if (ownerUids.length) {
      for (const profile of await this.getUsers(ownerUids)) owners[profile.uid] = discoveryOwner(profile)
    }

    return discoverSkills(candidates, filter, owners, filter.limit, {
      includeUnpublished: filter.includeUnpublished,
    })
  }

  async getSkill(id: string): Promise<SkillListing | null> {
    const snapshot = await getDoc(doc(getDb(), COLLECTIONS.skills, id))
    return fromSnapshot<SkillListing>(snapshot)
  }

  async createSkill(input: CreateSkillInput): Promise<SkillListing> {
    const db = getDb()
    const now = new Date().toISOString()
    const slug = input.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .slice(0, 60)
    const payload: Omit<SkillListing, 'id'> = {
      ownerUid: input.ownerUid,
      title: input.title.trim(),
      slug,
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
    try {
      const reference = await addDoc(collection(db, COLLECTIONS.skills), toFirestoreValue(payload) as DocumentData)
      // Keep the denormalised skill references on the profile in sync.
      const profile = await this.getUser(input.ownerUid)
      if (profile) {
        await updateDoc(doc(db, COLLECTIONS.users, input.ownerUid), {
          teachSkillIds: [...new Set([...profile.teachSkillIds, reference.id])],
          teachCategories: [...new Set([...profile.teachCategories, input.categoryId])],
          updatedAt: now,
        })
      }
      return { id: reference.id, ...payload }
    } catch (error) {
      throw toError(error, 'Could not publish the listing.')
    }
  }

  async updateSkill(id: string, patch: Partial<SkillListing>): Promise<SkillListing> {
    const db = getDb()
    const safe: Record<string, unknown> = { ...patch, updatedAt: new Date().toISOString() }
    for (const key of ['id', 'ownerUid', 'ratingSum', 'reviewCount', 'completedCount', 'moderation']) delete safe[key]
    await updateDoc(doc(db, COLLECTIONS.skills, id), toFirestoreValue(safe) as DocumentData)
    const skill = await this.getSkill(id)
    if (!skill) throw new BackendRequestError({ code: 'skill/not-found', message: 'Listing not found.' })
    return skill
  }

  async removeSkill(id: string): Promise<void> {
    const db = getDb()
    const skill = await this.getSkill(id)
    if (!skill) return
    await updateDoc(doc(db, COLLECTIONS.skills, id), {
      status: 'removed',
      updatedAt: new Date().toISOString(),
    })
    const profile = await this.getUser(skill.ownerUid)
    if (profile) {
      await updateDoc(doc(db, COLLECTIONS.users, skill.ownerUid), {
        teachSkillIds: profile.teachSkillIds.filter((skillId) => skillId !== id),
        updatedAt: new Date().toISOString(),
      })
    }
  }

  /* ── bookings ──────────────────────────────────────────────────────── */

  async listBookings(uid: string): Promise<Booking[]> {
    const db = getDb()
    const snapshot = await getDocs(
      query(
        collection(db, COLLECTIONS.bookings),
        where('participants', 'array-contains', uid),
        orderBy('startAt', 'desc'),
        queryLimit(120),
      ),
    )
    return fromQuery<Booking>(snapshot.docs)
  }

  async getBooking(id: string): Promise<Booking | null> {
    const snapshot = await getDoc(doc(getDb(), COLLECTIONS.bookings, id))
    return fromSnapshot<Booking>(snapshot)
  }

  async listBookingsInWindow(query_: BookingWindowQuery): Promise<Booking[]> {
    const db = getDb()
    if (!query_.uids.length) return []
    const results = await Promise.all(
      query_.uids.slice(0, 2).map((uid) =>
        getDocs(
          query(
            collection(db, COLLECTIONS.bookings),
            where('participants', 'array-contains', uid),
            where('startAt', '>=', toFirestoreValue(query_.from)),
            where('startAt', '<=', toFirestoreValue(query_.to)),
            queryLimit(60),
          ),
        ),
      ),
    )
    const merged = new Map<string, Booking>()
    results.forEach((snapshot) => {
      fromQuery<Booking>(snapshot.docs).forEach((booking) => merged.set(booking.id, booking))
    })
    return [...merged.values()]
  }

  async createBooking(input: CreateBookingInput): Promise<Booking> {
    const booking = await this.invoke<Booking>(CALLABLE.createBooking, input)
    return booking
  }

  async confirmBooking(id: string): Promise<Booking> {
    return this.invoke<Booking>(CALLABLE.respondToBooking, { bookingId: id, action: 'confirm' })
  }

  async declineBooking(id: string, reason: string): Promise<Booking> {
    return this.invoke<Booking>(CALLABLE.respondToBooking, { bookingId: id, action: 'decline', reason })
  }

  async cancelBooking(id: string, reason: string): Promise<Booking> {
    return this.invoke<Booking>(CALLABLE.respondToBooking, { bookingId: id, action: 'cancel', reason })
  }

  async rescheduleBooking(id: string, startAt: string, endAt: string, reason: string): Promise<Booking> {
    return this.invoke<Booking>(CALLABLE.respondToBooking, { bookingId: id, action: 'reschedule', startAt, endAt, reason })
  }

  async confirmCompletion(id: string, uid: string): Promise<SettlementOutcomeResult> {
    return this.invoke<SettlementOutcomeResult>(CALLABLE.confirmCompletion, { bookingId: id, uid })
  }

  async requestSettlement(id: string): Promise<SettlementOutcomeResult> {
    return this.invoke<SettlementOutcomeResult>(CALLABLE.settleSession, { bookingId: id })
  }

  async raiseDispute(id: string, claim: string): Promise<DisputeCase> {
    const db = getDb()
    const booking = await this.getBooking(id)
    if (!booking) throw new BackendRequestError({ code: 'booking/not-found', message: 'Booking not found.' })
    const uid = this.session?.uid ?? ''
    const now = new Date().toISOString()
    const payload = {
      bookingId: id,
      openedByUid: uid,
      againstUid: booking.teacherUid === uid ? booking.learnerUid : booking.teacherUid,
      claim,
      evidence: '',
      status: 'open' as const,
      outcome: null,
      handledByUid: null,
      createdAt: now,
      updatedAt: now,
    }
    const reference = await addDoc(collection(db, COLLECTIONS.disputes), toFirestoreValue(payload) as DocumentData)
    await updateDoc(doc(db, COLLECTIONS.bookings, id), { status: 'disputed', updatedAt: now })
    return { id: reference.id, ...payload }
  }

  async listSettlements(): Promise<SettlementRecord[]> {
    const snapshot = await getDocs(
      query(collection(getDb(), COLLECTIONS.settlements), orderBy('createdAt', 'desc'), queryLimit(200)),
    )
    return fromQuery<SettlementRecord>(snapshot.docs)
  }

  /* ── video rooms ───────────────────────────────────────────────────── */

  async getRoom(roomId: string): Promise<Room | null> {
    const snapshot = await getDoc(doc(getDb(), COLLECTIONS.rooms, roomId))
    return fromSnapshot<Room>(snapshot)
  }

  async getRoomForBooking(bookingId: string): Promise<Room | null> {
    const booking = await this.getBooking(bookingId)
    return booking?.roomId ? this.getRoom(booking.roomId) : null
  }

  async ensureRoom(bookingId: string): Promise<Room> {
    return this.invoke<Room>(CALLABLE.openRoom, { bookingId })
  }

  async getIceServers(): Promise<RTCIceServer[]> {
    const staticServers: RTCIceServer[] = [{ urls: [...env.webrtc.stunUrls] }]
    try {
      // Short-lived TURN credentials minted server-side — the shared secret never
      // reaches the browser.
      const response = await this.invoke<{ iceServers: RTCIceServer[] }>(CALLABLE.getTurnCredentials, {})
      if (response?.iceServers?.length) return response.iceServers
    } catch {
      /* Fall back to STUN (or configured static TURN) when TURN is not deployed. */
    }
    if (env.webrtc.turnUrls.length) {
      staticServers.push({
        urls: [...env.webrtc.turnUrls],
        username: env.webrtc.turnUsername || undefined,
        credential: env.webrtc.turnCredential || undefined,
      })
    }
    return staticServers
  }

  async registerPresence(roomId: string, uid: string, media: MediaState): Promise<RoomPresence> {
    const db = getDb()
    const profile = await this.getUser(uid)
    const room = await this.getRoom(roomId)
    if (!room || !room.participants.includes(uid)) {
      throw new BackendRequestError({ code: 'room/forbidden', message: 'Only the two members on this session may enter the room.' })
    }
    const now = new Date().toISOString()
    const presence: RoomPresence = {
      uid,
      displayName: profile?.displayName ?? 'PeerPulse member',
      avatarSeed: profile?.avatarSeed ?? uid,
      role: room.teacherUid === uid ? 'teacher' : 'learner',
      joinedAt: now,
      lastSeen: now,
      leftAt: null,
      media,
    }
    await setDoc(doc(db, COLLECTIONS.rooms, roomId, COLLECTIONS.presence, uid), toFirestoreValue(presence) as DocumentData, {
      merge: true,
    })
    // Attendance segment — the server reads these to verify the session.
    await addDoc(collection(db, COLLECTIONS.rooms, roomId, COLLECTIONS.attendance), {
      uid,
      joinedAt: toFirestoreValue(now),
      leftAt: null,
    })
    return presence
  }

  async updatePresence(roomId: string, uid: string, patch: Partial<RoomPresence>): Promise<void> {
    const db = getDb()
    await setDoc(
      doc(db, COLLECTIONS.rooms, roomId, COLLECTIONS.presence, uid),
      toFirestoreValue({ ...patch, lastSeen: new Date().toISOString() }) as DocumentData,
      { merge: true },
    )
  }

  async leavePresence(roomId: string, uid: string): Promise<void> {
    const db = getDb()
    const now = new Date().toISOString()
    await setDoc(
      doc(db, COLLECTIONS.rooms, roomId, COLLECTIONS.presence, uid),
      toFirestoreValue({ leftAt: now, lastSeen: now, media: { camera: false, microphone: false, screen: false } }) as DocumentData,
      { merge: true },
    )
    // Close the open attendance segment.
    const open = await getDocs(
      query(
        collection(db, COLLECTIONS.rooms, roomId, COLLECTIONS.attendance),
        where('uid', '==', uid),
        where('leftAt', '==', null),
        queryLimit(10),
      ),
    )
    const batch = writeBatch(db)
    open.docs.forEach((document) => batch.update(document.ref, { leftAt: toFirestoreValue(now), closedByClient: true }))
    await batch.commit()
  }

  async listPresence(roomId: string): Promise<RoomPresence[]> {
    const snapshot = await getDocs(collection(getDb(), COLLECTIONS.rooms, roomId, COLLECTIONS.presence))
    return fromQuery<RoomPresence>(snapshot.docs)
  }

  watchPresence(roomId: string, cb: (presence: RoomPresence[]) => void): Unsubscribe {
    return onSnapshot(
      collection(getDb(), COLLECTIONS.rooms, roomId, COLLECTIONS.presence),
      (snapshot) => {
        cb(snapshot.docs.map((document) => fromSnapshot<RoomPresence>(document)!).filter(Boolean))
      },
      (error) => console.warn('[PeerPulse] presence listener error', error),
    )
  }

  async startSession(roomId: string, uid: string): Promise<Room> {
    return this.invoke<Room>(CALLABLE.openRoom, { roomId, uid })
  }

  async endSession(roomId: string, uid: string): Promise<SettlementOutcomeResult> {
    return this.invoke<SettlementOutcomeResult>(CALLABLE.endSession, { roomId, uid })
  }

  async sendSignal(roomId: string, message: Omit<SignalingMessage, 'id' | 'createdAt'>): Promise<void> {
    const db = getDb()
    await addDoc(collection(db, COLLECTIONS.rooms, roomId, COLLECTIONS.signaling), {
      ...message,
      createdAt: serverTimestamp(),
      expiresAt: toFirestoreValue(new Date(Date.now() + 6 * 3_600_000).toISOString()),
    })
  }

  watchSignals(roomId: string, uid: string, cb: (message: SignalingMessage) => void): Unsubscribe {
    const db = getDb()
    const q = query(
      collection(db, COLLECTIONS.rooms, roomId, COLLECTIONS.signaling),
      where('to', '==', uid),
      orderBy('createdAt', 'asc'),
      queryLimit(50),
    )
    let lastSequence = new Map<string, number>()
    return onSnapshot(
      q,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'removed') return
          const message = fromSnapshot<SignalingMessage>(change.doc)
          if (!message || message.from === uid) return
          const seen = lastSequence.get(message.from) ?? 0
          if (message.sequence <= seen) return
          lastSequence = new Map(lastSequence).set(message.from, message.sequence)
          cb(message)
        })
      },
      (error) => {
        // Permission denied simply means "not a participant of this room".
        console.warn('[PeerPulse] signalling listener error', error.code)
      },
    )
  }

  async sendCandidate(roomId: string, message: Omit<IceCandidateMessage, 'id' | 'createdAt'>): Promise<void> {
    const db = getDb()
    await addDoc(collection(db, COLLECTIONS.rooms, roomId, COLLECTIONS.candidates), {
      ...message,
      createdAt: serverTimestamp(),
    })
  }

  watchCandidates(roomId: string, uid: string, cb: (message: IceCandidateMessage) => void): Unsubscribe {
    const db = getDb()
    const q = query(
      collection(db, COLLECTIONS.rooms, roomId, COLLECTIONS.candidates),
      where('to', '==', uid),
      orderBy('createdAt', 'asc'),
      queryLimit(200),
    )
    return onSnapshot(
      q,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'removed') return
          const message = fromSnapshot<IceCandidateMessage>(change.doc)
          if (message && message.from !== uid) cb(message)
        })
      },
      (error) => console.warn('[PeerPulse] candidate listener error', error.code),
    )
  }

  /* ── wallet & ledger ───────────────────────────────────────────────── */

  async getWallet(uid: string): Promise<Wallet> {
    const snapshot = await getDoc(doc(getDb(), COLLECTIONS.wallets, uid))
    const wallet = fromSnapshot<Wallet>(snapshot)
    if (!wallet) {
      throw new BackendRequestError({
        code: 'wallet/not-found',
        message: 'Your wallet is still being created — try again in a moment.',
      })
    }
    return wallet
  }

  watchWallet(uid: string, cb: (wallet: Wallet) => void): Unsubscribe {
    return onSnapshot(doc(getDb(), COLLECTIONS.wallets, uid), (snapshot) => {
      const wallet = fromSnapshot<Wallet>(snapshot)
      if (wallet) cb(wallet)
    })
  }

  async listTransactions(uid: string, options: { limit?: number; bookingId?: string } = {}): Promise<TokenTransaction[]> {
    const db = getDb()
    const constraints: QueryConstraint[] = [where('uid', '==', uid)]
    if (options.bookingId) constraints.push(where('bookingId', '==', options.bookingId))
    constraints.push(orderBy('createdAt', 'desc'))
    constraints.push(queryLimit(options.limit ?? 100))
    const snapshot = await getDocs(query(collection(db, COLLECTIONS.transactions), ...constraints))
    return fromQuery<TokenTransaction>(snapshot.docs)
  }

  async listAllTransactions(options: { limit?: number } = {}): Promise<TokenTransaction[]> {
    const snapshot = await getDocs(
      query(collection(getDb(), COLLECTIONS.transactions), orderBy('createdAt', 'desc'), queryLimit(options.limit ?? 200)),
    )
    return fromQuery<TokenTransaction>(snapshot.docs)
  }

  async adjustWallet(uid: string, amount: number, reason: string): Promise<Wallet> {
    await this.invoke(CALLABLE.adjustWallet, { uid, amount, reason })
    return this.getWallet(uid)
  }

  /* ── reviews ───────────────────────────────────────────────────────── */

  async listReviewsForUser(uid: string): Promise<Review[]> {
    const snapshot = await getDocs(
      query(
        collection(getDb(), COLLECTIONS.reviews),
        where('subjectUid', '==', uid),
        orderBy('createdAt', 'desc'),
        queryLimit(60),
      ),
    )
    return fromQuery<Review>(snapshot.docs).filter((review) => review.moderation?.state !== 'removed')
  }

  async listReviewsForSkill(skillId: string): Promise<Review[]> {
    const snapshot = await getDocs(
      query(collection(getDb(), COLLECTIONS.reviews), where('skillId', '==', skillId), orderBy('createdAt', 'desc'), queryLimit(60)),
    )
    return fromQuery<Review>(snapshot.docs).filter((review) => review.moderation?.state !== 'removed')
  }

  async listReviewsForBooking(bookingId: string): Promise<Review[]> {
    const snapshot = await getDocs(
      query(collection(getDb(), COLLECTIONS.reviews), where('bookingId', '==', bookingId), queryLimit(10)),
    )
    return fromQuery<Review>(snapshot.docs)
  }

  async createReview(input: CreateReviewInput): Promise<Review> {
    return this.invoke<Review>(CALLABLE.createReview, input)
  }

  async respondToReview(id: string, text: string): Promise<Review> {
    const db = getDb()
    await updateDoc(doc(db, COLLECTIONS.reviews, id), {
      responseText: text.slice(0, 1000),
      responseAt: toFirestoreValue(new Date().toISOString()),
    })
    const snapshot = await getDoc(doc(db, COLLECTIONS.reviews, id))
    const review = fromSnapshot<Review>(snapshot)
    if (!review) throw new BackendRequestError({ code: 'review/not-found', message: 'Review not found.' })
    return review
  }

  /* ── notifications ─────────────────────────────────────────────────── */

  async listNotifications(uid: string): Promise<AppNotification[]> {
    const snapshot = await getDocs(
      query(
        collection(getDb(), COLLECTIONS.notifications),
        where('uid', '==', uid),
        orderBy('createdAt', 'desc'),
        queryLimit(80),
      ),
    )
    return fromQuery<AppNotification>(snapshot.docs)
  }

  watchNotifications(uid: string, cb: (items: AppNotification[]) => void): Unsubscribe {
    return onSnapshot(
      query(
        collection(getDb(), COLLECTIONS.notifications),
        where('uid', '==', uid),
        orderBy('createdAt', 'desc'),
        queryLimit(50),
      ),
      (snapshot) => cb(fromQuery<AppNotification>(snapshot.docs)),
      (error) => console.warn('[PeerPulse] notification listener error', error.code),
    )
  }

  async markNotificationRead(id: string): Promise<void> {
    await updateDoc(doc(getDb(), COLLECTIONS.notifications, id), { read: true })
  }

  async markAllNotificationsRead(uid: string): Promise<void> {
    const items = await this.listNotifications(uid)
    const db = getDb()
    const batch = writeBatch(db)
    items.filter((item) => !item.read).forEach((item) => batch.update(doc(db, COLLECTIONS.notifications, item.id), { read: true }))
    await batch.commit()
  }

  /* ── communities ───────────────────────────────────────────────────── */

  async listCommunities(options?: { limit?: number; memberUid?: string; categoryId?: string }): Promise<Community[]> {
    const db = getDb()
    const constraints: QueryConstraint[] = []
    if (options?.categoryId) constraints.push(where('categoryId', '==', options.categoryId))
    constraints.push(queryLimit(options?.limit ?? 50))
    const snapshot = await getDocs(query(collection(db, COLLECTIONS.communities), ...constraints))
    let communities = fromQuery<Community>(snapshot.docs)
    if (options?.memberUid) {
      const memberships = await getDocs(
        query(collection(db, `users/${options.memberUid}/communityMemberships`), queryLimit(100)),
      )
      const joined = new Set(memberships.docs.map((d) => d.id))
      communities = communities.filter((community) => joined.has(community.id))
    }
    return communities.sort((a, b) => b.memberCount - a.memberCount)
  }

  async getCommunity(id: string): Promise<Community | null> {
    const snapshot = await getDoc(doc(getDb(), COLLECTIONS.communities, id))
    return fromSnapshot<Community>(snapshot)
  }

  async createCommunity(input: CreateCommunityInput): Promise<Community> {
    const db = getDb()
    const uid = this.session?.uid
    if (!uid) throw new BackendRequestError({ code: 'auth/required', message: 'Sign in first.' })
    const owner = await this.getUser(uid)
    const now = new Date().toISOString()
    const payload: Omit<Community, 'id'> = {
      name: input.name.slice(0, 80),
      slug: input.name.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60),
      description: input.description.slice(0, 600),
      categoryId: input.categoryId,
      visibility: input.visibility,
      ownerUids: [uid],
      moderatorUids: [uid],
      memberCount: 1,
      postCount: 0,
      tags: input.tags.slice(0, 8),
      rules: input.rules.slice(0, 6),
      createdAt: now,
      updatedAt: now,
    }
    const reference = await addDoc(collection(db, COLLECTIONS.communities), toFirestoreValue(payload) as DocumentData)
    await setDoc(doc(db, COLLECTIONS.communities, reference.id, COLLECTIONS.members, uid), {
      uid,
      displayName: owner?.displayName ?? 'Founder',
      avatarSeed: owner?.avatarSeed ?? uid,
      role: 'owner',
      joinedAt: toFirestoreValue(now),
    })
    return { id: reference.id, ...payload }
  }

  async joinCommunity(id: string, uid: string): Promise<Community> {
    const db = getDb()
    const member = await this.getUser(uid)
    await setDoc(doc(db, COLLECTIONS.communities, id, COLLECTIONS.members, uid), {
      uid,
      displayName: member?.displayName ?? 'Member',
      avatarSeed: member?.avatarSeed ?? uid,
      role: 'member',
      joinedAt: toFirestoreValue(new Date().toISOString()),
    })
    const community = await this.getCommunity(id)
    return community ?? (await this.getCommunity(id))!
  }

  async leaveCommunity(id: string, uid: string): Promise<Community> {
    const db = getDb()
    await setDoc(
      doc(db, COLLECTIONS.communities, id, COLLECTIONS.members, uid),
      { leftAt: toFirestoreValue(new Date().toISOString()) },
      { merge: true },
    )
    const community = await this.getCommunity(id)
    if (!community) throw new BackendRequestError({ code: 'community/not-found', message: 'Community not found.' })
    return community
  }

  async listCommunityMembers(communityId: string): Promise<CommunityMember[]> {
    const snapshot = await getDocs(collection(getDb(), COLLECTIONS.communities, communityId, COLLECTIONS.members))
    return fromQuery<CommunityMember>(snapshot.docs).filter((member) => !(member as unknown as { leftAt?: string }).leftAt)
  }

  async listPosts(options: { communityId?: string; limit?: number; kind?: CommunityPost['kind'] }): Promise<CommunityPost[]> {
    const db = getDb()
    const constraints: QueryConstraint[] = []
    if (options.communityId) constraints.push(where('communityId', '==', options.communityId))
    if (options.kind) constraints.push(where('kind', '==', options.kind))
    constraints.push(orderBy('createdAt', 'desc'))
    constraints.push(queryLimit(options.limit ?? 50))
    const snapshot = await getDocs(query(collection(db, COLLECTIONS.posts), ...constraints))
    return fromQuery<CommunityPost>(snapshot.docs).filter((post) => post.moderation?.state !== 'removed')
  }

  async createPost(input: CreatePostInput): Promise<CommunityPost> {
    const db = getDb()
    const author = await this.getUser(input.authorUid)
    const now = new Date().toISOString()
    const payload: Omit<CommunityPost, 'id'> = {
      communityId: input.communityId,
      authorUid: input.authorUid,
      authorName: author?.displayName ?? 'Member',
      authorSeed: author?.avatarSeed ?? input.authorUid,
      kind: input.kind,
      title: input.title.slice(0, 160),
      body: input.body.slice(0, 6000),
      link: input.link ?? null,
      reactions: {},
      commentCount: 0,
      pinned: false,
      moderation: { state: 'clean', reason: null },
      event: input.event ?? null,
      createdAt: now,
      updatedAt: now,
    }
    const reference = await addDoc(collection(db, COLLECTIONS.posts), toFirestoreValue(payload) as DocumentData)
    return { id: reference.id, ...payload }
  }

  async reactToPost(postId: string, uid: string, emoji: string): Promise<CommunityPost> {
    const db = getDb()
    const reference = doc(db, COLLECTIONS.posts, postId)
    const snapshot = await getDoc(reference)
    const post = fromSnapshot<CommunityPost>(snapshot)
    if (!post) throw new BackendRequestError({ code: 'post/not-found', message: 'Post not found.' })
    const reactions = { ...post.reactions }
    if (reactions[uid] === emoji) delete reactions[uid]
    else reactions[uid] = emoji
    await updateDoc(reference, { reactions, updatedAt: toFirestoreValue(new Date().toISOString()) })
    return { ...post, reactions }
  }

  async listComments(postId: string): Promise<CommunityComment[]> {
    const snapshot = await getDocs(
      query(
        collection(getDb(), COLLECTIONS.posts, postId, COLLECTIONS.comments),
        orderBy('createdAt', 'asc'),
        queryLimit(100),
      ),
    )
    return fromQuery<CommunityComment>(snapshot.docs)
  }

  async createComment(input: { postId: string; communityId: string; authorUid: string; body: string }): Promise<CommunityComment> {
    const db = getDb()
    const author = await this.getUser(input.authorUid)
    const now = new Date().toISOString()
    const payload = {
      postId: input.postId,
      communityId: input.communityId,
      authorUid: input.authorUid,
      authorName: author?.displayName ?? 'Member',
      authorSeed: author?.avatarSeed ?? input.authorUid,
      body: input.body.slice(0, 3000),
      moderation: { state: 'clean' as ModerationState, reason: null },
      createdAt: toFirestoreValue(now),
    }
    const reference = await addDoc(collection(db, COLLECTIONS.posts, input.postId, COLLECTIONS.comments), payload)
    await updateDoc(doc(db, COLLECTIONS.posts, input.postId), {
      commentCount: (await getDocs(collection(db, COLLECTIONS.posts, input.postId, COLLECTIONS.comments))).size,
      updatedAt: toFirestoreValue(now),
    })
    return {
      id: reference.id,
      postId: input.postId,
      communityId: input.communityId,
      authorUid: input.authorUid,
      authorName: payload.authorName,
      authorSeed: payload.authorSeed,
      body: payload.body,
      moderation: payload.moderation,
      createdAt: now,
    }
  }

  /* ── moderation & administration ───────────────────────────────────── */

  async createReport(input: CreateReportInput): Promise<ModerationReport> {
    const db = getDb()
    const now = new Date().toISOString()
    const payload: Omit<ModerationReport, 'id'> = {
      reporterUid: input.reporterUid,
      targetType: input.targetType,
      targetId: input.targetId,
      targetPath: input.targetPath,
      targetLabel: input.targetLabel,
      reason: input.reason,
      details: input.details.slice(0, 2000),
      status: 'open',
      priority: input.reason === 'harassment' ? 'high' : 'normal',
      resolution: null,
      handledByUid: null,
      handledAt: null,
      createdAt: now,
      updatedAt: now,
    }
    const reference = await addDoc(collection(db, COLLECTIONS.reports), toFirestoreValue(payload) as DocumentData)
    return { id: reference.id, ...payload }
  }

  async listReports(): Promise<ModerationReport[]> {
    const snapshot = await getDocs(
      query(collection(getDb(), COLLECTIONS.reports), orderBy('createdAt', 'desc'), queryLimit(200)),
    )
    return fromQuery<ModerationReport>(snapshot.docs)
  }

  async resolveReport(id: string, patch: { status: ModerationReport['status']; resolution: string }): Promise<ModerationReport> {
    await this.invoke(CALLABLE.resolveReport, { reportId: id, ...patch })
    const snapshot = await getDoc(doc(getDb(), COLLECTIONS.reports, id))
    const report = fromSnapshot<ModerationReport>(snapshot)
    if (!report) throw new BackendRequestError({ code: 'report/not-found', message: 'Report not found.' })
    return report
  }

  async listDisputes(): Promise<DisputeCase[]> {
    const snapshot = await getDocs(
      query(collection(getDb(), COLLECTIONS.disputes), orderBy('createdAt', 'desc'), queryLimit(200)),
    )
    return fromQuery<DisputeCase>(snapshot.docs)
  }

  async resolveDispute(id: string, patch: { status: DisputeCase['status']; outcome: string }): Promise<DisputeCase> {
    await this.invoke(CALLABLE.resolveDispute, { disputeId: id, ...patch })
    const snapshot = await getDoc(doc(getDb(), COLLECTIONS.disputes, id))
    const dispute = fromSnapshot<DisputeCase>(snapshot)
    if (!dispute) throw new BackendRequestError({ code: 'dispute/not-found', message: 'Dispute not found.' })
    return dispute
  }

  async getPlatformConfig(): Promise<PlatformConfig> {
    const snapshot = await getDoc(doc(getDb(), COLLECTIONS.config, COLLECTIONS.platform))
    const config = fromSnapshot<PlatformConfig & { id: string }>(snapshot)
    if (!config) {
      throw new BackendRequestError({
        code: 'config/missing',
        message: 'The platform configuration document (config/platform) has not been created yet.',
      })
    }
    return config
  }

  async updatePlatformConfig(patch: Partial<PlatformConfig>): Promise<PlatformConfig> {
    await this.invoke(CALLABLE.updatePlatformConfig, { patch })
    return this.getPlatformConfig()
  }

  async getMetrics(): Promise<PlatformMetrics> {
    if (!(await this.isAdmin())) {
      throw new BackendRequestError({ code: 'permission/denied', message: 'Administrator permissions are required.' })
    }
    return this.invoke<PlatformMetrics>(CALLABLE.getMetrics, {})
  }

  /** Helper for admin screens that need to clear a field. */
}
