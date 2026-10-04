/**
 * Cloud Functions integration harness.
 *
 * The functions were written (and type-checked) but never executed, because the
 * environment they were authored in had no JDK and therefore no Firestore
 * emulator. This harness removes that blocker by running the functions against
 * `firebase-mocker`, a Node implementation of the Firestore gRPC service and the
 * Identity Toolkit REST API that the **real** `firebase-admin` SDK talks to over
 * the wire — no credentials, no JDK, no network.
 *
 * What that buys, and what it does not:
 *   • The functions run unmodified: `getFirestore()`, timestamps, array-contains
 *     queries, subcollection reads and `runTransaction` all go through the SDK.
 *   • Security Rules are NOT enforced here (rules are tested separately, against
 *     the emulator). These tests therefore prove *behaviour and authorisation
 *     checks inside the functions*, not the rules layer.
 *   • Transaction conflict detection is Level 1 in the mocker (atomic commit, no
 *     version checks). Fine for these single-threaded assertions; it is not a
 *     substitute for a staging environment when testing concurrency.
 */
import { firebaseMocker } from 'firebase-mocker'
import type { Firestore } from 'firebase-admin/firestore'

export const PROJECT_ID = 'peerpulse-functions-test'
export const FIRESTORE_PORT = 3333
export const AUTH_PORT = 9099

/** The identities every test world contains. */
export const TEACHER = 'u_teacher'
export const LEARNER = 'u_learner'
export const OUTSIDER = 'u_outsider'
export const ADMIN = 'u_admin'

export const SKILL_ID = 'sk_guitar'

export interface CallResult<T = unknown> {
  ok: boolean
  data?: T
  /** Our own `namespace/reason` code from the HttpsError details, when present. */
  code?: string
  /** The transport-level gRPC status (`invalid-argument`, `permission-denied`, …). */
  status?: string
  message?: string
}

export interface World {
  db: Firestore
  admin: typeof import('firebase-admin')
  /** Every callable this test suite drives, loaded from `src/` after setup. */
  fns: Record<string, CallableLike>
}

interface CallableLike {
  run: (request: { auth?: { uid: string; token: Record<string, unknown> } | null; data: unknown }) => Promise<unknown>
}

/**
 * `firebase-functions` types each endpoint's request precisely, and those types
 * are not mutually assignable, so one helper cannot drive them all. The harness
 * erases the per-endpoint request type on purpose — this is test scaffolding,
 * not product code, and `call()` below still builds a realistic request.
 */
function asCallable(value: unknown): CallableLike {
  return value as unknown as CallableLike
}

interface CallOptions {
  /** uid of the caller; omit for an unauthenticated call. */
  as?: string
  /** Adds the administrator custom claim to the caller's token. */
  admin?: boolean
  data?: unknown
}

export const world: Partial<World> = {}

export async function startHarness(): Promise<void> {
  await firebaseMocker.startFirestoreServer({ port: FIRESTORE_PORT, host: 'localhost', projectId: PROJECT_ID })
  await firebaseMocker.startAuthServer({ port: AUTH_PORT, host: 'localhost', projectId: PROJECT_ID })

  // The project id reaches the Admin SDK the same way it does in the deployed
  // runtime; `lib/app.ts` then initialises the app before anything binds a
  // client, so the import order here does not matter (that is the point of it).
  process.env.GCLOUD_PROJECT = PROJECT_ID
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.appspot.com` })

  const [index, bookings, rooms, social, adminFns, admin] = await Promise.all([
    import('../src/index'),
    import('../src/bookings'),
    import('../src/rooms'),
    import('../src/social'),
    import('../src/admin'),
    import('firebase-admin'),
  ])

  world.admin = admin
  world.db = admin.firestore()
  const triggers = (await import('../src/triggers')) as unknown as Record<string, unknown>
  const endpoints: Record<string, unknown> = { ...bookings, ...rooms, ...social, ...adminFns, ...index, ...triggers }
  world.fns = Object.fromEntries(
    Object.entries(endpoints)
      .filter(([, value]) => typeof value === 'function')
      .map(([name, value]) => [name, asCallable(value)]),
  )
}

export async function stopHarness(): Promise<void> {
  await firebaseMocker.stopAuthServer()
  await firebaseMocker.stopFirestoreServer()
}

/** Invoke a callable the way the client SDK would, capturing the error contract. */
export async function call<T = unknown>(name: string, options: CallOptions = {}): Promise<CallResult<T>> {
  const fn = world.fns?.[name]
  if (!fn) throw new Error(`No such callable: ${name}`)
  const request = {
    auth: options.as ? { uid: options.as, token: options.admin ? { admin: true } : {} } : null,
    data: options.data ?? {},
  }
  try {
    const data = (await fn.run(request)) as T
    return { ok: true, data }
  } catch (error) {
    const err = error as { code?: string; message?: string; details?: { code?: string } }
    return {
      ok: false,
      code: err.details?.code,
      status: err.code,
      message: err.message,
    }
  }
}

/* ─────────────────────────────── fixtures ─────────────────────────────── */

export async function clearWorld(): Promise<void> {
  const db = world.db!
  for (const collection of [
    'users', 'skills', 'bookings', 'rooms', 'wallets', 'tokenTransactions',
    'settlements', 'reviews', 'notifications', 'communities', 'posts', 'reports', 'disputes', 'config',
  ]) {
    const snapshot = await db.collection(collection).get()
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()))
  }
}

function member(uid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid,
    email: `${uid}@peerpulse.app`,
    displayName: uid.replace('u_', '').replace(/^./, (c) => c.toUpperCase()),
    photoURL: null,
    avatarSeed: `${uid}-seed`,
    headline: 'Test member',
    bio: '',
    location: 'Test',
    timezone: 'UTC',
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
      sessionsCompleted: 0, sessionsTaught: 0, teachingHours: 0, learningHours: 0,
      ratingSum: 0, reviewCount: 0, tokensEarned: 0, tokensSpent: 0,
    },
    onboarding: { completed: true, step: 5, skipped: false },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastActiveAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

export function wallet(uid: string, balance: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid,
    balance,
    held: 0,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
    lifetimeGranted: balance,
    policyVersion: '2026.1',
    updatedAt: new Date(),
    updatedBy: 'test',
    ...overrides,
  }
}

/** Seeds the four members, one published listing and the token policy. */
export async function seedWorld(options: { learnerBalance?: number } = {}): Promise<void> {
  const db = world.db!
  const { DEFAULT_PLATFORM_CONFIG } = await import('../src/shared/tokenPolicy')

  await db.doc('config/platform').set({ ...DEFAULT_PLATFORM_CONFIG })

  // Real accounts exist in both stores: Firebase Auth owns the identity (and the
  // custom claims an administrator is granted), Firestore holds the profile.
  // `setUserRole` talks to the Auth API, so the fixture has to as well.
  const auth = world.admin!.auth()
  await Promise.all(
    [TEACHER, LEARNER, OUTSIDER, ADMIN].map(async (uid) => {
      try {
        await auth.createUser({ uid, email: `${uid}@peerpulse.app`, password: 'peerpulse' })
      } catch {
        /* already created by an earlier test in this file */
      }
    }),
  )

  await Promise.all([
    db.doc(`users/${TEACHER}`).set(member(TEACHER, { displayName: 'Tina Teacher' })),
    db.doc(`users/${LEARNER}`).set(member(LEARNER, { displayName: 'Leo Learner' })),
    db.doc(`users/${OUTSIDER}`).set(member(OUTSIDER, { displayName: 'Ola Outsider' })),
    db.doc(`users/${ADMIN}`).set(member(ADMIN, { displayName: 'Ada Steward', role: 'admin' })),
  ])
  await db.doc(`wallets/${TEACHER}`).set(wallet(TEACHER, 0))
  await db.doc(`wallets/${LEARNER}`).set(wallet(LEARNER, options.learnerBalance ?? 3))
  await db.doc(`wallets/${ADMIN}`).set(wallet(ADMIN, 0))
  await db.doc(`skills/${SKILL_ID}`).set({
    id: SKILL_ID,
    ownerUid: TEACHER,
    title: 'Jazz guitar: chords and comping',
    slug: 'jazz-guitar-chords-and-comping',
    categoryId: 'music',
    description: 'Chord voicings, comping and your first solo.',
    outcomes: ['Play 12 voicings'],
    level: 'intermediate',
    languages: ['en'],
    format: 'video',
    durationMinutes: 60,
    tags: ['guitar'],
    status: 'published',
    moderation: { state: 'clean', reason: null, reviewedByUid: null, reviewedAt: null },
    bookingCount: 0,
    completedCount: 0,
    ratingSum: 0,
    reviewCount: 0,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  })
}

/** A booking window that clears the 2-hour notice rule and stays inside 60 days. */
export function upcomingWindow(hoursFromNow = 48, minutes = 60): { startAt: string; endAt: string } {
  const start = new Date(Date.now() + hoursFromNow * 3_600_000)
  const end = new Date(start.getTime() + minutes * 60_000)
  return { startAt: start.toISOString(), endAt: end.toISOString() }
}

/* ──────────────────────────────── readers ─────────────────────────────── */

export async function readWallet(uid: string): Promise<Record<string, unknown>> {
  const snapshot = await world.db!.doc(`wallets/${uid}`).get()
  if (!snapshot.exists) throw new Error(`No wallet for ${uid}`)
  return snapshot.data()!
}

export async function ledger(): Promise<Array<Record<string, unknown>>> {
  const snapshot = await world.db!.collection('tokenTransactions').get()
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

/**
 * Invoke a v1 trigger the way the runtime does: `run(data, context)`. The auth
 * trigger's data is an `AuthUserRecord`, so only the fields it reads are filled.
 */
export async function invokeAuthTrigger(
  uid: string,
  input: { email?: string; displayName?: string } = {},
): Promise<void> {
  const trigger = world.fns?.onUserCreated
  if (!trigger) throw new Error('onUserCreated is not loaded')
  const run = (trigger as unknown as { run: (data: unknown, context: unknown) => Promise<unknown> }).run
  await run(
    {
      uid,
      email: input.email ?? `${uid}@peerpulse.app`,
      displayName: input.displayName ?? 'New Member',
      photoURL: null,
      emailVerified: false,
      disabled: false,
      metadata: { creationTime: new Date().toISOString(), lastSignInTime: new Date().toISOString() },
      providerData: [],
      toJSON: () => ({}),
    },
    {
      eventId: `evt_${uid}`,
      eventType: 'providers/firebase.auth/eventTypes/user.create',
      timestamp: new Date().toISOString(),
      params: {},
      resource: { name: `projects/${PROJECT_ID}/locations/europe-west1`, service: 'firebaseauth.googleapis.com' },
    },
  )
}

/**
 * Runs the comment-reply body the trigger wraps, against the real database.
 * (The wrapped Cloud Functions event plumbing is Firebase's; this is ours.)
 */
export async function notifyingComment(input: {
  communityId: string
  postId: string
  authorUid: string
  body: string
}): Promise<boolean> {
  const { notifyPostAuthorOfComment } = await import('../src/triggers')
  return notifyPostAuthorOfComment(input)
}

/** Runs the reminder sweep body, optionally against a fixed clock. */
export async function runReminderSweep(now?: Date): Promise<number> {
  const { sendSessionReminders } = await import('../src/triggers')
  return sendSessionReminders(now)
}

/** Runs the scheduled settlement sweep body directly. */
export async function runSettlementSweep(): Promise<{ settled: string[]; skipped: string[] }> {
  const { autoSettleFinishedSessions } = await import('../src/lib/settlement')
  return autoSettleFinishedSessions()
}

export async function readBooking(id: string): Promise<Record<string, unknown>> {
  const snapshot = await world.db!.doc(`bookings/${id}`).get()
  if (!snapshot.exists) throw new Error(`No booking ${id}`)
  return { id: snapshot.id, ...snapshot.data()! }
}

export async function notificationsFor(uid: string): Promise<Array<Record<string, unknown>>> {
  const snapshot = await world.db!.collection('notifications').where('uid', '==', uid).get()
  return snapshot.docs.map((doc) => doc.data()!)
}

/**
 * Books a session through the real callable and returns the booking id, so the
 * tests exercise the same path the app does instead of hand-writing documents.
 */
export async function bookSession(hoursFromNow = 48): Promise<string> {
  const window = upcomingWindow(hoursFromNow)
  const result = await call<{ id: string }>('createBooking', {
    as: LEARNER,
    data: { skillId: SKILL_ID, ...window, timezone: 'UTC', learnerNote: 'Test booking' },
  })
  if (!result.ok || !result.data) throw new Error(`createBooking failed: ${result.code} ${result.message}`)
  return result.data.id
}

/** Moves a confirmed booking to the state it is in while the call is running. */
export async function openRoomFor(bookingId: string, as: string): Promise<void> {
  const result = await call('openRoom', { as, data: { bookingId } })
  if (!result.ok) throw new Error(`openRoom failed: ${result.code} ${result.message}`)
}

/** Writes attendance the way the client does: closed segments as Timestamps. */
export async function seedAttendance(
  bookingId: string,
  segments: Array<{ uid: string; startMinutesFromNow: number; minutes: number }>,
): Promise<void> {
  const admin = world.admin!
  const { Timestamp } = await import('firebase-admin/firestore')
  const roomId = `room_${bookingId}`
  await Promise.all(
    segments.map(async (segment, index) => {
      const joinedAt = new Date(Date.now() + segment.startMinutesFromNow * 60_000)
      const leftAt = new Date(joinedAt.getTime() + segment.minutes * 60_000)
      await world.db!.doc(`rooms/${roomId}/attendance/seg_${index}`).set({
        uid: segment.uid,
        joinedAt: Timestamp.fromDate(joinedAt),
        leftAt: Timestamp.fromDate(leftAt),
      })
    }),
  )
  void admin
}

/** Puts a booking in progress without going through the join-window guard. */
export async function forceInProgress(bookingId: string, participants: string[]): Promise<void> {
  const { Timestamp } = await import('firebase-admin/firestore')
  const roomId = `room_${bookingId}`
  await world.db!.doc(`bookings/${bookingId}`).set(
    { status: 'in_progress', roomId, endAt: Timestamp.fromDate(new Date(Date.now() - 60_000)) },
    { merge: true },
  )
  await world.db!.doc(`rooms/${roomId}`).set({
    id: roomId,
    bookingId,
    skillTitle: 'Jazz guitar: chords and comping',
    teacherUid: participants.includes(TEACHER) ? TEACHER : participants[0],
    learnerUid: participants.includes(LEARNER) ? LEARNER : participants[1],
    participants,
    status: 'open',
    createdAt: Timestamp.now(),
    openedAt: Timestamp.now(),
    closedAt: null,
    attendanceLocked: false,
    session: { startedAt: null, endedAt: null, durationMinutes: null, initiatorUid: null },
  })
}
