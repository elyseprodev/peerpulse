import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Firestore index coverage.
 *
 * A composite index is deployment configuration that only fails in production:
 * the first time a query runs without its index, Firestore throws
 * `FAILED_PRECONDITION: The query requires an index` and hands you a link. The
 * emulator does not reproduce it (it builds indexes on the fly) and the
 * reference backend has no indexes at all, so nothing else in this repository
 * can catch the gap. This suite is that catch: it states every query shape the
 * app issues that *needs* a composite index, and fails if `firestore.indexes.json`
 * stops covering one.
 *
 * The rule the table encodes: Firestore can serve filters from single-field
 * indexes only when the query has a single sort order that those filters agree
 * with. An equality filter plus a sort or range on a *different* field requires
 * a composite index with the equality fields first, then that field — which is
 * why an index like `notifications(uid, createdAt)` is load-bearing for the
 * notification bell and nothing in the code says so.
 *
 * This was written after finding two missing indexes (see the rows marked
 * `found 2026-10-04`), including the one the hourly auto-settlement sweep needs.
 *
 * To add a query: add a row with the source that issues it. To add an index that
 * no query needs yet, list it under SPECULATIVE with the reason it is kept —
 * otherwise the "no unclaimed index" test below fails, which is the point.
 */

interface IndexField {
  fieldPath: string
  order?: 'ASCENDING' | 'DESCENDING'
  arrayConfig?: 'CONTAINS'
}

interface DeclaredIndex {
  '//'?: string
  collectionGroup: string
  queryScope: string
  fields: IndexField[]
}

interface QueryShape {
  /** Where the shape is issued, so the next reader can check it. */
  source: string
  collection: string
  /** Equality (or array-contains) filters, in any order. */
  equality: Array<string | { field: string; arrayConfig: 'CONTAINS' }>
  /** The one field the query sorts or ranges on. */
  sort: { field: string; order: 'ASCENDING' | 'DESCENDING' }
  note?: string
}

const file = path.resolve(process.cwd(), 'firestore.indexes.json')
const parsed = JSON.parse(readFileSync(file, 'utf8')) as { indexes: DeclaredIndex[]; fieldOverrides: unknown[] }
const declared = parsed.indexes

const QUERIES: QueryShape[] = [
  {
    source: 'src/lib/backend/firebase/index.ts — listBookings',
    collection: 'bookings',
    equality: [{ field: 'participants', arrayConfig: 'CONTAINS' }],
    sort: { field: 'startAt', order: 'DESCENDING' },
  },
  {
    source: 'src/lib/backend/firebase/index.ts — listBookingsInWindow; functions/src/bookings.ts — conflict check',
    collection: 'bookings',
    equality: [{ field: 'participants', arrayConfig: 'CONTAINS' }],
    sort: { field: 'startAt', order: 'ASCENDING' },
    note: 'One index serves both the client window query and the server conflict check.',
  },
  {
    source: 'functions/src/lib/settlement.ts — autoSettleFinishedSessions (the hourly sweep)',
    collection: 'bookings',
    equality: ['status'],
    sort: { field: 'endAt', order: 'ASCENDING' },
    note: 'found 2026-10-04 — missing. Without it every scheduled sweep throws and no session ever auto-settles.',
  },
  {
    source: 'functions/src/triggers.ts — sendSessionReminders (the ten-minute sweep)',
    collection: 'bookings',
    equality: ['status'],
    sort: { field: 'startAt', order: 'ASCENDING' },
    note: 'found 2026-10-04 — missing. The reminder sweep asks for confirmed sessions starting inside the next hour; without this index it throws and no reminder is ever sent.',
  },
  {
    source: 'src/lib/backend/firebase/index.ts — listNotifications and watchNotifications',
    collection: 'notifications',
    equality: ['uid'],
    sort: { field: 'createdAt', order: 'DESCENDING' },
    note: 'found 2026-10-04 — missing. Without it the notification bell and page fail on a deployed project.',
  },
  {
    source: 'src/lib/backend/firebase/index.ts — listTransactions',
    collection: 'tokenTransactions',
    equality: ['uid'],
    sort: { field: 'createdAt', order: 'DESCENDING' },
  },
  {
    source: 'src/lib/backend/firebase/index.ts — listTransactions with a booking filter',
    collection: 'tokenTransactions',
    equality: ['uid', 'bookingId'],
    sort: { field: 'createdAt', order: 'DESCENDING' },
  },
  {
    source: 'src/lib/backend/firebase/index.ts — listReviewsForMember',
    collection: 'reviews',
    equality: ['subjectUid'],
    sort: { field: 'createdAt', order: 'DESCENDING' },
  },
  {
    source: 'src/lib/backend/firebase/index.ts — listReviewsForSkill',
    collection: 'reviews',
    equality: ['skillId'],
    sort: { field: 'createdAt', order: 'DESCENDING' },
  },
  {
    source: 'src/lib/backend/firebase/index.ts — listPosts by community',
    collection: 'posts',
    equality: ['communityId'],
    sort: { field: 'createdAt', order: 'DESCENDING' },
  },
  {
    source: 'src/lib/backend/firebase/index.ts — listPosts by community and kind',
    collection: 'posts',
    equality: ['communityId', 'kind'],
    sort: { field: 'createdAt', order: 'DESCENDING' },
  },
  {
    source: 'src/lib/backend/firebase/index.ts — listPosts by kind',
    collection: 'posts',
    equality: ['kind'],
    sort: { field: 'createdAt', order: 'DESCENDING' },
  },
  {
    source: 'src/lib/backend/firebase/index.ts — subscribeSignaling / sendSignal',
    collection: 'signaling',
    equality: ['to'],
    sort: { field: 'createdAt', order: 'ASCENDING' },
    note: 'Subcollection, so the index is declared as a collection group.',
  },
  {
    source: 'src/lib/backend/firebase/index.ts — subscribeCandidates / sendCandidate',
    collection: 'candidates',
    equality: ['to'],
    sort: { field: 'createdAt', order: 'ASCENDING' },
  },
]

/**
 * Indexes the file declares that no *current* query requires. They cost a little
 * write latency, so the reason to keep one has to be worth writing down.
 */
const SPECULATIVE: Array<{ signature: string; reason: string }> = [
  {
    signature: 'users: status ASC, privacy.appearInDiscovery ASC, privacy.profileVisibility ASC, createdAt DESC',
    reason:
      'The members directory filters on three equality fields. Current Firestore can merge single-field indexes for that, so this is precautionary, and it makes the list robust if it ever gains a sort.',
  },
  { signature: 'skills: categoryId ASC, status ASC, createdAt DESC', reason: 'Marketplace category filter, newest first.' },
  { signature: 'skills: level ASC, status ASC, createdAt DESC', reason: 'Marketplace level filter, newest first.' },
  { signature: 'skills: format ASC, status ASC, createdAt DESC', reason: 'Marketplace format filter, newest first.' },
  { signature: 'skills: ownerUid ASC, status ASC, createdAt DESC', reason: "A teacher's own listings, published first." },
  { signature: 'skills: ownerUid ASC, createdAt DESC', reason: "A teacher's own listings including drafts, newest first." },
  {
    signature: 'bookings: status ASC, startAt DESC',
    reason:
      'An administrative view of bookings by status, newest first. Today getMetrics counts by status and the queues sort in memory, so nothing issues this shape.',
  },
  {
    signature: 'tokenTransactions: uid ASC, bookingId ASC, createdAt ASC',
    reason:
      'The ascending twin of the ledger index. Nothing reads a booking ledger oldest-first, so this is the first candidate for deletion if the list ever needs pruning.',
  },
  {
    signature: 'notifications: uid ASC, read ASC, createdAt DESC',
    reason: 'Unread notifications, newest first. The bell reads all notifications and counts unread in the client today.',
  },
  { signature: 'notifications: uid ASC, read ASC', reason: 'Unread-count query, same reasoning.' },
  {
    signature: 'communities: categoryId ASC, memberCount DESC',
    reason: 'Community directory filtered by category and ranked by size; minutes the query sorts in memory.',
  },
  { signature: 'reports: status ASC, createdAt DESC', reason: 'Moderation queue filtered by status. The queue reads all reports and filters client-side.' },
  { signature: 'disputes: status ASC, createdAt DESC', reason: 'Dispute queue filtered by status, same reasoning.' },
  { signature: 'settlements: bookingId ASC, createdAt DESC', reason: "A single booking's settlement history — the audit view the brief asks for." },
  { signature: 'presence: uid ASC', reason: 'Room presence by member, for the attendance view.' },
  { signature: 'bookings: teacherUid ASC, startAt DESC', reason: "A teacher's schedule without reading the participants array; kept for the calendar export on the roadmap." },
  { signature: 'bookings: learnerUid ASC, startAt DESC', reason: 'As above, for the learner side.' },
]

function signatureOf(fields: IndexField[]): string {
  return fields
    .map((f) => (f.arrayConfig === 'CONTAINS' ? `${f.fieldPath} (array-contains)` : `${f.fieldPath} ${f.order === 'DESCENDING' ? 'DESC' : 'ASC'}`))
    .join(', ')
}

function describeQuery(query: QueryShape): string {
  const filters = query.equality
    .map((f) => (typeof f === 'string' ? `${f} ==` : `${f.field} array-contains`))
    .join(' + ')
  return `${query.collection}: ${filters} + sort ${query.sort.field} ${query.sort.order === 'DESCENDING' ? 'DESC' : 'ASC'}`
}

/**
 * Firestore accepts an index for a query when the index starts with the query's
 * equality fields (their relative order is free) followed by its sort field with
 * a matching direction; trailing fields are allowed because a longer index can
 * serve a shorter query.
 */
function covers(index: DeclaredIndex, query: QueryShape): boolean {
  if (index.collectionGroup !== query.collection) return false
  const equalityFields = query.equality.map((f) => (typeof f === 'string' ? f : f.field))

  const head = index.fields.slice(0, equalityFields.length)
  const headPaths = head.map((f) => f.fieldPath)
  if ([...headPaths].sort().join('|') !== [...equalityFields].sort().join('|')) return false

  // An array-contains filter has to be declared as such, not as an equality.
  for (const wanted of query.equality) {
    if (typeof wanted === 'string') continue
    const match = head.find((f) => f.fieldPath === wanted.field)
    if (!match || match.arrayConfig !== 'CONTAINS') return false
  }

  const sortField = index.fields[equalityFields.length]
  if (!sortField || sortField.fieldPath !== query.sort.field) return false
  return (sortField.order ?? 'ASCENDING') === query.sort.order
}

describe('firestore.indexes.json', () => {
  it('is valid, declares no duplicate index, and pairs every index with a reason', () => {
    expect(Array.isArray(declared)).toBe(true)
    expect(declared.length).toBeGreaterThan(0)

    const seen = new Set<string>()
    for (const index of declared) {
      const signature = `${index.collectionGroup}: ${signatureOf(index.fields)}`
      expect(seen.has(signature), `duplicate index: ${signature}`).toBe(false)
      seen.add(signature)
      expect(index.queryScope, `missing queryScope on ${signature}`).toBe('COLLECTION')
      expect(index['//'], `every index should say what it is for: ${signature}`).toBeTruthy()
    }
  })

  it.each(QUERIES.map((query) => [describeQuery(query), query] as const))(
    'has a composite index for %s',
    (_label, query) => {
      const match = declared.find((index) => covers(index, query))
      expect(
        match,
        `No index in firestore.indexes.json covers:\n  ${describeQuery(query)}\n  issued by ${query.source}\n` +
          `Add one to firestore.indexes.json (and a row here), or the query will fail on a deployed project with ` +
          `FAILED_PRECONDITION: The query requires an index.`,
      ).toBeDefined()
    },
  )

  it('owns up to every index it declares that no query needs', () => {
    // Build the set of declared indexes that no row in QUERIES covers.
    const unclaimed = declared.filter((index) => !QUERIES.some((query) => covers(index, query)))

    // Convert each unclaimed index into "collection: field ORDER, …" and compare
    // against the SPECULATIVE list, which must account for all of them.
    const unclaimedSignatures = unclaimed.map(
      (index) =>
        `${index.collectionGroup}: ${index.fields
          .map((f) => (f.arrayConfig === 'CONTAINS' ? `${f.fieldPath} (array-contains)` : `${f.fieldPath} ${f.order === 'DESCENDING' ? 'DESC' : 'ASC'}`))
          .join(', ')}`,
    )

    const documented = new Set(SPECULATIVE.map((entry) => entry.signature))
    const undocumented = unclaimedSignatures.filter((signature) => !documented.has(signature))

    expect(
      undocumented,
      'These indexes are declared but no query shape claims them. Either add a row to QUERIES, or list it in ' +
        'SPECULATIVE with the reason it is kept, or delete it — an index nobody needs still costs every write.',
    ).toEqual([])
  })
})

