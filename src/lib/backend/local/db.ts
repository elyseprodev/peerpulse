/**
 * Local persistence layer for the in-browser reference backend.
 *
 * ⚠️  This is NOT the production data store. It exists so PeerPulse can be
 * demonstrated, developed offline and unit-tested without a cloud project. It
 * mimics the Firestore document/collection model (flat collections keyed by id,
 * sub-collections stored as keyed maps) and publishes change events so the UI
 * can use the same reactive subscriptions in both modes.
 *
 * Everything that matters for correctness — token maths, conflict detection,
 * attendance verification, settlement planning — is executed through the shared
 * domain modules, exactly like the Cloud Functions do.
 */
import type {
  AppNotification,
  AttendanceSegment,
  Booking,
  Community,
  CommunityComment,
  CommunityMember,
  CommunityPost,
  DisputeCase,
  IceCandidateMessage,
  ModerationReport,
  PlatformConfig,
  Review,
  Room,
  RoomPresence,
  SettlementRecord,
  SignalingMessage,
  SkillListing,
  TokenTransaction,
  UserProfile,
  Wallet,
} from '@shared/domain'

export interface LocalDatabase {
  version: 1
  seededAt: string | null
  session: { uid: string | null }
  users: Record<string, UserProfile>
  credentials: Record<string, { hash: string; salt: string }>
  skills: Record<string, SkillListing>
  bookings: Record<string, Booking>
  rooms: Record<string, Room>
  presence: Record<string, RoomPresence[]>
  attendance: Record<string, AttendanceSegment[]>
  signals: Record<string, SignalingMessage[]>
  candidates: Record<string, IceCandidateMessage[]>
  wallets: Record<string, Wallet>
  transactions: Record<string, TokenTransaction>
  settlements: Record<string, SettlementRecord>
  reviews: Record<string, Review>
  notifications: Record<string, AppNotification>
  communities: Record<string, Community>
  communityMembers: Record<string, CommunityMember[]>
  posts: Record<string, CommunityPost>
  comments: Record<string, CommunityComment>
  reports: Record<string, ModerationReport>
  disputes: Record<string, DisputeCase>
  config: PlatformConfig
}

export const STORAGE_KEY = 'peerpulse.local.v1'

/* ─────────────────────────── change bus ─────────────────────────── */

type Listener = () => void

class ChangeBus {
  private listeners = new Map<string, Set<Listener>>()

  subscribe(topic: string, listener: Listener): () => void {
    const set = this.listeners.get(topic) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(topic, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(topic)
    }
  }

  emit(...topics: string[]): void {
    const notified = new Set<Listener>()
    for (const topic of topics) {
      // Topic `a/b/*` notifications fan out to `a/b/*` and any `a/b/*:` prefix.
      for (const [key, set] of this.listeners) {
        if (key === topic || topic.startsWith(`${key}|`) || key.startsWith(`${topic}|`)) {
          for (const listener of set) notified.add(listener)
        }
      }
    }
    notified.forEach((listener) => listener())
  }
}

export const bus = new ChangeBus()

/* ─────────────────────────── storage ─────────────────────────── */

let db: LocalDatabase | null = null

/** Minimal deep clone that is safe for our JSON-shaped documents. */
function clone<T>(value: T): T {
  return structuredClone ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T)
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

export function createEmptyDatabase(config: PlatformConfig): LocalDatabase {
  return {
    version: 1,
    seededAt: null,
    session: { uid: null },
    users: {},
    credentials: {},
    skills: {},
    bookings: {},
    rooms: {},
    presence: {},
    attendance: {},
    signals: {},
    candidates: {},
    wallets: {},
    transactions: {},
    settlements: {},
    reviews: {},
    notifications: {},
    communities: {},
    communityMembers: {},
    posts: {},
    comments: {},
    reports: {},
    disputes: {},
    config,
  }
}

export function getDb(): LocalDatabase {
  if (db) return db
  if (hasLocalStorage()) {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        db = JSON.parse(raw) as LocalDatabase
        return db
      } catch {
        localStorage.removeItem(STORAGE_KEY)
      }
    }
  }
  throw new Error('Local database has not been initialised. Call initLocalDatabase() first.')
}

export function setDb(next: LocalDatabase): void {
  db = next
}

export function persist(...topics: string[]): void {
  if (db && hasLocalStorage()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
    } catch {
      /* quota exceeded — the in-memory copy remains authoritative for this tab */
    }
  }
  if (topics.length) bus.emit(...topics)
}

export function resetLocalDatabase(config: PlatformConfig): void {
  if (hasLocalStorage()) localStorage.removeItem(STORAGE_KEY)
  db = createEmptyDatabase(config)
  persist('db')
}

/* ─────────────────────────── helpers ─────────────────────────── */

export function uid(prefix = 'pp'): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}${random}`
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Firestore-style `where in` chunking (max 30 values per query). */
export function chunk<T>(items: T[], size = 30): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function sortBy<T>(items: T[], key: (item: T) => number | string, direction: 'asc' | 'desc' = 'asc'): T[] {
  const dir = direction === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const av = key(a)
    const bv = key(b)
    if (av === bv) return 0
    return av > bv ? dir : -dir
  })
}

export function deepClone<T>(value: T): T {
  return clone(value)
}
