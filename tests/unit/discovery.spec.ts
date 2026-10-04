/**
 * Discovery: the rules the marketplace is built on.
 *
 * `shared/discovery.ts` exists because `listSkills` was implemented twice and the
 * two copies disagreed. These tests pin the shared rules, and the last block
 * asserts that both backends still call the shared module rather than growing a
 * third opinion — the drift is what this file is defending against, and a test
 * that only checked the shared module would pass while the backends ignored it.
 *
 * Specifically it pins the two defects that shipped in the Firestore path:
 *   • text search not looking at the teacher's name or headline (so searching a
 *     teacher's name worked in local mode and returned nothing in production),
 *   • the query's `limit(60)` being applied *before* level/language/duration/
 *     weekday/text filtering, so a matching listing ranked 61st was invisible.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  discoverSkills,
  isDiscoverable,
  matchesSkillFilters,
  matchesSkillQuery,
  needsClientSideFiltering,
  relevanceScore,
  skillRating,
  sortSkills,
} from '@shared/discovery'
import type { AvailabilityBlock, SkillListing } from '@shared/domain'
import { LocalBackend } from '@/lib/backend/local'
import { setBackendForTesting } from '@/lib/backend'
import { useSkillsStore } from '@/stores/skills'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'

/* ────────────────────────────── fixtures ────────────────────────────── */

function listing(overrides: Partial<SkillListing> & { id: string }): SkillListing {
  return {
    ownerUid: 'u_default',
    title: 'A listing',
    slug: overrides.id,
    categoryId: 'music',
    description: 'A description',
    outcomes: [],
    level: 'beginner',
    languages: ['en'],
    format: 'video',
    durationMinutes: 60,
    tags: [],
    status: 'published',
    moderation: { state: 'clean', reason: null, reviewedByUid: null, reviewedAt: null },
    bookingCount: 0,
    completedCount: 0,
    ratingSum: 0,
    reviewCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as SkillListing
}

const AT = (hour: number, weekday: number): AvailabilityBlock => ({
  weekday,
  start: `${String(hour).padStart(2, '0')}:00`,
  end: `${String(hour + 1).padStart(2, '0')}:00`,
})

/** Three listings that differ in every way the filters can ask about. */
const GUITAR = listing({
  id: 'skill_guitar',
  ownerUid: 'u_mei',
  title: 'Fingerstyle guitar for beginners',
  description: 'Learn to play with your fingers, not a pick.',
  categoryId: 'music',
  level: 'beginner',
  format: 'video',
  languages: ['en', 'zh'],
  durationMinutes: 60,
  tags: ['guitar', 'acoustic'],
  completedCount: 4,
  bookingCount: 6,
  ratingSum: 23,
  reviewCount: 5, // 4.6
})

const SPANISH = listing({
  id: 'skill_spanish',
  ownerUid: 'u_jonas',
  title: 'Spanish conversation practice',
  description: 'Friendly conversation for improvers, all topics welcome.',
  categoryId: 'languages',
  level: 'intermediate',
  format: 'voice',
  languages: ['es', 'en'],
  durationMinutes: 45,
  tags: ['spanish', 'conversation'],
  completedCount: 2,
  bookingCount: 3,
  ratingSum: 20,
  reviewCount: 4, // 5.0
})

const WOODWORK = listing({
  id: 'skill_woodwork',
  ownerUid: 'u_amara',
  title: 'Woodwork: make a small stool',
  description: 'Hand tools only, in a shared workshop.',
  categoryId: 'crafts',
  level: 'any',
  format: 'video',
  languages: ['en'],
  durationMinutes: 120,
  tags: ['woodwork', 'diy'],
  completedCount: 1,
  bookingCount: 0,
  ratingSum: 8,
  reviewCount: 2, // 4.0
})

const ALL = [GUITAR, SPANISH, WOODWORK]

const OWNERS: Record<string, { displayName?: string; headline?: string; availability?: AvailabilityBlock[] }> = {
  u_mei: { displayName: 'Mei Tanaka', headline: 'Patient teacher', availability: [AT(18, 2), AT(19, 2)] },
  u_jonas: { displayName: 'Jonas Weber', headline: 'Native speaker', availability: [AT(10, 6)] },
  u_amara: { displayName: 'Amara Okafor', headline: 'Carpenter', availability: [AT(14, 0)] },
}

const ids = (skills: SkillListing[]): string[] => skills.map((skill) => skill.id)

/* ───────────────────────────── search ───────────────────────────── */

describe('discovery: text search', () => {
  it('finds a listing by its title, description or tags', () => {
    expect(ids(discoverSkills(ALL, { query: 'fingerstyle' }, OWNERS))).toEqual(['skill_guitar'])
    expect(ids(discoverSkills(ALL, { query: 'improvers' }, OWNERS))).toEqual(['skill_spanish'])
    expect(ids(discoverSkills(ALL, { query: 'diy' }, OWNERS))).toEqual(['skill_woodwork'])
  })

  it("finds a listing by the teacher's name — the bug that only appeared in production", () => {
    // The Firestore implementation searched only the listing's own fields, so
    // this returned nothing for a real user while local mode worked.
    expect(ids(discoverSkills(ALL, { query: 'mei tanaka' }, OWNERS))).toEqual(['skill_guitar'])
    expect(ids(discoverSkills(ALL, { query: 'amara' }, OWNERS))).toEqual(['skill_woodwork'])
  })

  it("finds a listing by the teacher's headline", () => {
    expect(ids(discoverSkills(ALL, { query: 'native speaker' }, OWNERS))).toEqual(['skill_spanish'])
  })

  it('is case-insensitive and ignores a blank query', () => {
    expect(ids(discoverSkills(ALL, { query: 'GUITAR' }, OWNERS))).toEqual(['skill_guitar'])
    expect(ids(discoverSkills(ALL, { query: '   ' }, OWNERS))).toEqual(ids(discoverSkills(ALL, {}, OWNERS)))
  })

  it('searches outcomes, because that is what a learner actually wants', () => {
    const withOutcomes = listing({ id: 'skill_x', outcomes: ['Read music notation'] })
    expect(matchesSkillQuery(withOutcomes, 'notation')).toBe(true)
  })

  it('returns nothing when nothing matches', () => {
    expect(discoverSkills(ALL, { query: 'underwater basket weaving' }, OWNERS)).toEqual([])
  })
})

/* ───────────────────────────── filters ───────────────────────────── */

describe('discovery: filters', () => {
  it('filters by category, format, language and maximum duration', () => {
    expect(ids(discoverSkills(ALL, { categoryId: 'languages' }, OWNERS))).toEqual(['skill_spanish'])
    expect(ids(discoverSkills(ALL, { format: 'voice' }, OWNERS))).toEqual(['skill_spanish'])
    expect(ids(discoverSkills(ALL, { language: 'zh' }, OWNERS))).toEqual(['skill_guitar'])
    // Ordered by relevance, so the better-rated of the two comes first.
    expect(ids(discoverSkills(ALL, { maxDurationMinutes: 60 }, OWNERS))).toEqual(['skill_spanish', 'skill_guitar'])
  })

  it('treats a level of "any" on a listing as suiting every level', () => {
    // A woodwork listing open to all comers must appear when someone filters for
    // beginners — otherwise the filter hides the most accessible listings.
    expect(ids(discoverSkills(ALL, { level: 'beginner' }, OWNERS))).toContain('skill_woodwork')
    expect(ids(discoverSkills(ALL, { level: 'advanced' }, OWNERS))).toEqual(['skill_woodwork'])
    expect(ids(discoverSkills(ALL, { level: 'intermediate' }, OWNERS))).toEqual(['skill_spanish', 'skill_woodwork'])
  })

  it('matches the weekday filter against the teacher\'s availability, not the listing', () => {
    // Jonas teaches on Saturday (6); Amara on Sunday (0); Mei on Tuesday (2).
    expect(ids(discoverSkills(ALL, { weekday: 6 }, OWNERS))).toEqual(['skill_spanish'])
    expect(ids(discoverSkills(ALL, { weekday: 0 }, OWNERS))).toEqual(['skill_woodwork'])
    expect(ids(discoverSkills(ALL, { weekday: 2 }, OWNERS))).toEqual(['skill_guitar'])
    expect(discoverSkills(ALL, { weekday: 4 }, OWNERS)).toEqual([])
  })

  it('combines filters rather than replacing them', () => {
    expect(
      ids(discoverSkills(ALL, { level: 'intermediate', maxDurationMinutes: 60, format: 'voice' }, OWNERS)),
    ).toEqual(['skill_spanish'])
    expect(discoverSkills(ALL, { categoryId: 'music', language: 'es' }, OWNERS)).toEqual([])
  })

  it('treats an empty filter as "everything published"', () => {
    expect(ids(discoverSkills(ALL, {}, OWNERS)).sort()).toEqual(['skill_guitar', 'skill_spanish', 'skill_woodwork'])
    expect(matchesSkillFilters(GUITAR, { categoryId: null, level: null, format: null, language: null }, OWNERS.u_mei)).toBe(
      true,
    )
  })
})

/* ───────────────────────────── ordering ───────────────────────────── */

describe('discovery: ordering', () => {
  it('orders by rating, recency, duration and relevance', () => {
    expect(skillRating(SPANISH)).toBe(5)
    expect(skillRating(GUITAR)).toBeCloseTo(4.6, 5)
    expect(skillRating(listing({ id: 'no_reviews' }))).toBe(0)

    expect(ids(sortSkills(ALL, 'rating'))).toEqual(['skill_spanish', 'skill_guitar', 'skill_woodwork'])
    expect(ids(sortSkills(ALL, 'duration'))).toEqual(['skill_spanish', 'skill_guitar', 'skill_woodwork'])

    const newest = listing({ id: 'skill_new', createdAt: '2026-09-01T00:00:00.000Z' })
    expect(ids(sortSkills([...ALL, newest], 'recent'))[0]).toBe('skill_new')

    // Relevance = rating × 100 + completed × 5 + bookings × 5: a five-star listing
    // with a handful of sessions beats a four-star one with more bookings.
    expect(relevanceScore(SPANISH)).toBeGreaterThan(relevanceScore(GUITAR))
    expect(relevanceScore(GUITAR)).toBeGreaterThan(relevanceScore(WOODWORK))
    expect(ids(sortSkills(ALL, 'relevance'))).toEqual(['skill_spanish', 'skill_guitar', 'skill_woodwork'])
  })

  it('counts bookings in relevance, as the reference implementation always did', () => {
    // The Firestore sort omitted bookingCount, so a well-booked listing ranked
    // differently depending on which backend happened to serve the page.
    const equal = [
      listing({ id: 'skill_a', completedCount: 1, bookingCount: 0 }),
      listing({ id: 'skill_b', completedCount: 0, bookingCount: 3 }),
    ]
    expect(relevanceScore(equal[1])).toBeGreaterThan(relevanceScore(equal[0]))
  })

  it('breaks ties on id, so the same data always renders in the same order', () => {
    const a = listing({ id: 'skill_a', completedCount: 2 })
    const b = listing({ id: 'skill_b', completedCount: 2 })
    expect(ids(sortSkills([b, a], 'relevance'))).toEqual(['skill_a', 'skill_b'])
    expect(ids(sortSkills([a, b], 'relevance'))).toEqual(['skill_a', 'skill_b'])
    // and the caller's array is not reordered in place
    const original = [b, a]
    sortSkills(original, 'relevance')
    expect(original.map((s) => s.id)).toEqual(['skill_b', 'skill_a'])
  })
})

/* ───────────────────────── visibility and limits ───────────────────────── */

describe('discovery: what may be seen', () => {
  const draft = listing({ id: 'skill_draft', status: 'draft' })
  const paused = listing({ id: 'skill_paused', status: 'paused' })
  const hidden = listing({ id: 'skill_hidden', moderation: { state: 'hidden', reason: 'reported', reviewedByUid: 'admin', reviewedAt: null } })
  const removed = listing({ id: 'skill_removed', moderation: { state: 'removed', reason: 'spam', reviewedByUid: 'admin', reviewedAt: null } })

  it('excludes drafts, paused, hidden and removed listings from discovery', () => {
    const catalogue = [GUITAR, draft, paused, hidden, removed]
    expect(ids(discoverSkills(catalogue, {}, OWNERS))).toEqual(['skill_guitar'])
    for (const skill of [draft, paused, hidden, removed]) expect(isDiscoverable(skill)).toBe(false)
  })

  it('shows the owner their own drafts when they ask for them', () => {
    // The owner's profile editor loads their drafts; the marketplace never does.
    const catalogue = [GUITAR, draft, paused, hidden]
    expect(ids(discoverSkills(catalogue, {}, OWNERS, undefined, { includeUnpublished: true })).sort()).toEqual([
      'skill_draft',
      'skill_guitar',
      'skill_hidden',
      'skill_paused',
    ])
  })

  it('applies the limit after filtering — a listing ranked last is still found', () => {
    // This is the production bug: the query truncated to the first 60 rows and
    // *then* filtered, so a match past the cut-off was invisible.
    const crowd = Array.from({ length: 65 }, (_, index) => listing({ id: `skill_${String(index).padStart(3, '0')}` }))
    const needle = listing({ id: 'skill_zzz_match', title: 'The one I am looking for' })
    const found = discoverSkills([...crowd, needle], { query: 'looking for' }, OWNERS, 60)
    expect(ids(found)).toEqual(['skill_zzz_match'])

    // and a plain limit still limits, after ordering
    const top = discoverSkills(ALL, {}, OWNERS, 2)
    expect(top).toHaveLength(2)
    expect(ids(top)).toEqual(ids(sortSkills(ALL, 'relevance')).slice(0, 2))
  })

  it('knows when a filter can be pushed into the query and when it cannot', () => {
    // Firestore may enforce category and format itself. Anything about the owner,
    // the text, or a numeric cap must be evaluated here — and when it is, the
    // query must not truncate.
    expect(needsClientSideFiltering({ categoryId: 'music', format: 'video' })).toBe(false)
    expect(needsClientSideFiltering({ categoryId: 'music', level: 'beginner' })).toBe(true)
    expect(needsClientSideFiltering({ query: 'guitar' })).toBe(true)
    expect(needsClientSideFiltering({ language: 'es' })).toBe(true)
    expect(needsClientSideFiltering({ maxDurationMinutes: 30 })).toBe(true)
    expect(needsClientSideFiltering({ weekday: 0 })).toBe(true)
    expect(needsClientSideFiltering({ weekday: null })).toBe(false)
  })
})

/* ───────────────────── the results of the newest search ───────────────────── */

describe('discovery: concurrent searches', () => {
  /**
   * A controllable backend: it records each request and lets the test decide the
   * order in which the answers arrive. Waiting on real network timing would make
   * this flaky, and flaky is worse than absent — it would be marked as noise.
   */
  function recordingBackend() {
    const requests: Array<Record<string, unknown>> = []
    const pending: Array<{
      query: string
      resolve: (items: SkillListing[]) => void
      reject: (error: Error) => void
    }> = []
    return {
      requests,
      /**
       * Answer the request that carried `query`. Answering "the next one" would
       * silently swap which request the test means, which is how the first
       * version of this test ended up asserting the opposite of what it said.
       */
      answer(query: string, items: SkillListing[]): void {
        const index = pending.findIndex((entry) => entry.query === query)
        expect(index, `no pending request for "${query}"`).toBeGreaterThan(-1)
        pending.splice(index, 1)[0].resolve(items)
      },
      /** Answer a request with a failure, as a network or permission error would. */
      fail(query: string, error: Error): void {
        const index = pending.findIndex((entry) => entry.query === query)
        expect(index, `no pending request for "${query}"`).toBeGreaterThan(-1)
        pending.splice(index, 1)[0].reject(error)
      },
      get pending() {
        return pending.length
      },
      listSkills(filter: Record<string, unknown>) {
        requests.push({ ...filter })
        return new Promise<SkillListing[]>((resolve, reject) =>
          pending.push({ query: String(filter.query ?? ''), resolve, reject }),
        )
      },
      getUsers() {
        return Promise.resolve([])
      },
    }
  }

  let store: ReturnType<typeof useSkillsStore>

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    store = useSkillsStore()
  })

  it('sends each search the filter it was asked for, even when they overlap', async () => {
    // The filter must be snapshotted before the first await: reading it again
    // after `await getBackend()` lets a concurrent search mutate it, so the
    // request carries filters from neither call.
    const backend = recordingBackend()
    setBackendForTesting(backend as never)

    const slow = store.search({ query: 'guitar' })
    const fast = store.search({ query: 'woodwork' })
    await flushPromises()

    expect(backend.requests.map((request) => request.query)).toEqual(['guitar', 'woodwork'])
    expect(backend.requests.every((request) => request.limit === 60)).toBe(true)

    backend.answer('guitar', [])
    backend.answer('woodwork', [])
    await Promise.all([slow, fast])
  })

  it('keeps the newest results when the older search answers last', async () => {
    const backend = recordingBackend()
    setBackendForTesting(backend as never)

    // The member's latest intent is the one issued last, so that is the one that
    // must win — whatever order the network answers in.
    const superseded = store.search({ query: 'guitar' })
    const latest = store.search({ query: 'woodwork' })
    await flushPromises()
    expect(backend.pending).toBe(2)

    const woodwork = [listing({ id: 'skill_woodwork', title: 'Woodwork: make a small stool' })]
    const guitar = [listing({ id: 'skill_guitar', title: 'Fingerstyle guitar for beginners' })]

    // The latest answers first; the superseded one answers last, as a slow request
    // does. Without the guard this stale response would be the one on screen.
    backend.answer('woodwork', woodwork)
    await latest
    backend.answer('guitar', guitar)
    await superseded

    expect(
      store.listings.map((skill) => skill.id),
      'the slower, older response must not overwrite the newer one',
    ).toEqual(['skill_woodwork'])
    expect(store.loading, 'the store must not be left loading').toBe(false)
  })

  it('does not leave the store loading when a superseded search is still in flight', async () => {
    const backend = recordingBackend()
    setBackendForTesting(backend as never)

    const first = store.search({ query: 'guitar' })
    const second = store.search({ query: 'spanish' })
    await flushPromises()

    backend.answer('guitar', [])
    await first
    expect(store.loading, 'the newest search is still running').toBe(true)
    backend.answer('spanish', [])
    await second
    expect(store.loading).toBe(false)
  })

  it('reports a failure from the newest search only', async () => {
    const backend = recordingBackend()
    setBackendForTesting(backend as never)

    // A permission error on the superseded request must not surface as the
    // page's error state once a newer search has succeeded.
    const failing = store.search({ query: 'guitar' })
    const newest = store.search({ query: 'spanish' })
    await flushPromises()

    backend.fail('guitar', new Error('permission-denied'))
    await failing
    backend.answer('spanish', [listing({ id: 'skill_spanish', title: 'Spanish conversation practice' })])
    await newest

    expect(store.error, 'the stale failure should not be the page error').toBeNull()
    expect(store.listings.map((skill) => skill.id)).toEqual(['skill_spanish'])
    expect(store.loading).toBe(false)
  })
})

/* ───────────────────── the backends use this module ───────────────────── */

describe('discovery: both backends run the shared pipeline', () => {
  const read = (file: string): string => readFileSync(path.resolve(process.cwd(), file), 'utf8')

  it('imports the shared module in both adapters, so a third opinion cannot grow', () => {
    for (const file of ['src/lib/backend/local/index.ts', 'src/lib/backend/firebase/index.ts']) {
      const source = read(file)
      expect(source, `${file} should import the shared discovery pipeline`).toContain('discoverSkills')
      // Reimplementing the rules locally is exactly the drift this guards against.
      expect(source, `${file} should not re-filter on level in its own code`).not.toMatch(
        /skill\.level === filter\.level/,
      )
      expect(source, `${file} should not re-implement the weekday rule`).not.toMatch(
        /some\(\(a\) => a\.weekday === filter\.weekday\)/,
      )
    }
  })

  it('runs the same pipeline through the real backend, including owner names', async () => {
    // A live check that the wiring is real, not just an import: search the seeded
    // catalogue by a teacher's name through the reference backend.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-10T09:00:00.000Z'))
    localStorage.clear()
    const backend = new LocalBackend()
    await backend.init()

    const all = await backend.listSkills({ limit: 60 })
    expect(all.length).toBeGreaterThan(5)

    const firstOwner = await backend.getUser(all[0].ownerUid)
    const needle = (firstOwner?.displayName ?? '').split(' ')[0]
    expect(needle.length, 'the seed should have a named owner').toBeGreaterThan(2)

    const byName = await backend.listSkills({ query: needle, limit: 60 })
    expect(
      byName.map((skill) => skill.ownerUid),
      `searching for "${needle}" should find that teacher's listings`,
    ).toContain(all[0].ownerUid)

    // A filter that only the shared pipeline knows how to answer.
    const owners = await backend.getUsers([...new Set(all.map((skill) => skill.ownerUid))])
    const weekday = (owners[0].availability[0] as AvailabilityBlock | undefined)?.weekday
    if (weekday !== undefined) {
      const byWeekday = await backend.listSkills({ weekday, limit: 60 })
      expect(byWeekday.length, 'at least the owner we derived the weekday from should match').toBeGreaterThan(0)
      expect(
        byWeekday.every((skill) => {
          const owner = owners.find((candidate) => candidate.uid === skill.ownerUid)
          return owner ? owner.availability.some((block) => block.weekday === weekday) : true
        }),
        'every result must have a teacher available on that weekday',
      ).toBe(true)
    }
    vi.useRealTimers()
  })

  it('orders the seeded catalogue the way the rules say', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-10T09:00:00.000Z'))
    localStorage.clear()
    const backend = new LocalBackend()
    await backend.init()

    const byRating = (await backend.listSkills({ sort: 'rating', limit: 60 })).map(skillRating)
    expect(byRating).toEqual([...byRating].sort((a, b) => b - a))

    const byDuration = (await backend.listSkills({ sort: 'duration', limit: 60 })).map((skill) => skill.durationMinutes)
    expect(byDuration).toEqual([...byDuration].sort((a, b) => a - b))

    const byRecent = (await backend.listSkills({ sort: 'recent', limit: 60 })).map((skill) => Date.parse(skill.createdAt))
    expect(byRecent).toEqual([...byRecent].sort((a, b) => b - a))
    vi.useRealTimers()
  })
})

/* ───────────────────── what the profile page sees ───────────────────── */

describe('discovery: the owner\'s own listings', () => {
  let backend: LocalBackend

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-10T09:00:00.000Z'))
    localStorage.clear()
    backend = new LocalBackend()
    await backend.init()
  })

  it('includes drafts and paused listings for their owner, and only for them', async () => {
    const session = await backend.signIn('sam@peerpulse.app', 'peerpulse')
    const owned = await backend.listSkills({ ownerUid: session.uid, includeUnpublished: true, limit: 50 })
    expect(owned.length).toBeGreaterThan(0)

    // The same query without the owner flag is the marketplace's view.
    const publicView = await backend.listSkills({ ownerUid: session.uid, limit: 50 })
    for (const skill of publicView) {
      expect(skill.status, 'the marketplace never shows a draft or a paused listing').toBe('published')
      expect(['hidden', 'removed'], 'nor a moderated listing').not.toContain(skill.moderation.state)
    }
    vi.useRealTimers()
  })

  it('applies filters to the owner\'s own view too', async () => {
    const session = await backend.signIn('sam@peerpulse.app', 'peerpulse')
    const owned = await backend.listSkills({ ownerUid: session.uid, includeUnpublished: true, limit: 50 })
    const oneLanguage = owned.find((skill) => skill.languages.length)
    if (oneLanguage) {
      const filtered = await backend.listSkills({
        ownerUid: session.uid,
        includeUnpublished: true,
        language: oneLanguage.languages[0],
        limit: 50,
      })
      expect(filtered.map((skill) => skill.id)).toContain(oneLanguage.id)
    }
    vi.useRealTimers()
  })
})
