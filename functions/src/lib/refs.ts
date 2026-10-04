/**
 * Firestore access helpers.
 *
 * The functions always work with **native Firestore `Timestamp` values** for
 * date fields (the client converts them to ISO strings on read — see
 * src/lib/backend/firebase/convert.ts). `iso()`/`ts()` below keep that split
 * explicit, because a settlement that writes a plain string into `settledAt`
 * would silently break range queries and ordering.
 */
import { getFirestore, Timestamp, type DocumentData, type DocumentSnapshot, type Transaction } from 'firebase-admin/firestore'
import type {
  AppNotification,
  Booking,
  Community,
  CommunityPost,
  DisputeCase,
  ModerationReport,
  PlatformConfig,
  Room,
  SkillListing,
  TokenTransaction,
  UserProfile,
  Wallet,
} from '../shared/domain'
import { initializeAdminApp } from './app'
import { fail } from './errors'

// Before `getFirestore()`: see lib/app.ts for why the order matters.
initializeAdminApp()

export const db = getFirestore()

export const COLLECTIONS = {
  users: 'users',
  skills: 'skills',
  bookings: 'bookings',
  rooms: 'rooms',
  presence: 'presence',
  attendance: 'attendance',
  signaling: 'signaling',
  candidates: 'candidates',
  wallets: 'wallets',
  transactions: 'tokenTransactions',
  settlements: 'settlements',
  reviews: 'reviews',
  notifications: 'notifications',
  communities: 'communities',
  members: 'members',
  posts: 'posts',
  comments: 'comments',
  reports: 'reports',
  disputes: 'disputes',
  config: 'config',
} as const

/** The policy document every token decision reads. */
export const CONFIG_PATH = `${COLLECTIONS.config}/platform`

export const nowIso = (): string => new Date().toISOString()
export const ts = (value: string | Date | null | undefined): Timestamp | null =>
  value === null || value === undefined ? null : Timestamp.fromDate(value instanceof Date ? value : new Date(value))

/* ─────────────────────────────── readers ─────────────────────────────── */

export function readDocument<T>(snapshot: DocumentSnapshot<DocumentData>): T | null {
  if (!snapshot.exists) return null
  return { ...(snapshot.data() as DocumentData), id: snapshot.id } as T
}

export async function mustGet<T>(path: [string, ...string[]], code: Parameters<typeof fail>[0], label: string): Promise<T> {
  const snapshot = await db.doc(path.join('/')).get()
  const value = readDocument<T>(snapshot)
  if (!value) fail(code, `${label} could not be found.`)
  return value
}

export function getBooking(id: string): Promise<Booking> {
  return mustGet<Booking>([COLLECTIONS.bookings, id], 'booking/not-found', 'That booking')
}

export function getUser(uid: string): Promise<UserProfile> {
  return mustGet<UserProfile>([COLLECTIONS.users, uid], 'user/not-found', 'That member')
}

export function getWallet(uid: string): Promise<Wallet> {
  return mustGet<Wallet>([COLLECTIONS.wallets, uid], 'wallet/not-found', 'That wallet')
}

export function getRoom(roomId: string): Promise<Room> {
  return mustGet<Room>([COLLECTIONS.rooms, roomId], 'room/not-found', 'That video room')
}

export function getConfig(): Promise<PlatformConfig> {
  return mustGet<PlatformConfig>([COLLECTIONS.config, 'platform'], 'config/invalid', 'The platform policy')
}

export function getCommunity(id: string): Promise<Community> {
  return mustGet<Community>([COLLECTIONS.communities, id], 'community/not-found', 'That community')
}

/* ───────────────────────────── authorisation ─────────────────────────── */

/**
 * Administrators carry a custom claim that only this project's own functions can
 * set. Nothing on the client can add it, so this check cannot be spoofed.
 */
export function isAdmin(context: { auth?: { token?: Record<string, unknown> } }): boolean {
  return context.auth?.token?.admin === true
}

export function requireAdmin(context: { auth?: { uid?: string; token?: Record<string, unknown> } }): string {
  const uid = requireUid(context)
  if (!isAdmin(context)) fail('permission/denied', 'Administrator permissions are required.')
  return uid
}

export function requireUid(context: { auth?: { uid?: string } }): string {
  const uid = context.auth?.uid
  if (!uid) fail('auth/not-signed-in', 'Sign in to continue.')
  return uid
}

export function isParticipant(booking: Booking, uid: string): boolean {
  return booking.participants.includes(uid)
}

export function requireParticipant(booking: Booking, uid: string): void {
  if (!isParticipant(booking, uid)) {
    fail('booking/forbidden', 'Only the teacher or the learner on this booking can do that.')
  }
}

/* ─────────────────────────────── writers ─────────────────────────────── */

export interface NotificationInput {
  uid: string
  type: AppNotification['type']
  title: string
  body: string
  link?: string | null
  priority?: AppNotification['priority']
}

/** Notifications are written by the server only (see firestore.rules). */
export async function pushNotification(input: NotificationInput, tx?: Transaction): Promise<void> {
  const reference = db.collection(COLLECTIONS.notifications).doc()
  const payload: DocumentData = {
    uid: input.uid,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link ?? null,
    read: false,
    priority: input.priority ?? 'normal',
    createdAt: ts(nowIso()),
  }
  if (tx) tx.set(reference, payload)
  else await reference.set(payload)
}

export type { Booking, Community, CommunityPost, DisputeCase, ModerationReport, Room, SkillListing, TokenTransaction, UserProfile, Wallet }
