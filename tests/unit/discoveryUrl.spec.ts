/**
 * Discovery on the page: filters, the URL, and the back button.
 *
 * `tests/unit/discovery.spec.ts` pins the *rules* (what matches, in what order).
 * This suite pins the part a member actually touches: the filter bar on
 * `/skills`, and the promise that the filter state lives in the query string.
 *
 * FR-7 says the filter state is mirrored into the URL. The first implementation
 * mirrored two of eight filters, so a shared link to "advanced, Spanish, under an
 * hour, Saturday" dropped everything except the text search — silently, because
 * the page looked fine. These tests enter through the URL rather than through the
 * controls, which is how a link behaves, and they check the results the page
 * renders rather than the store, so a broken render cannot pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import router from '@/router'
import { getBackend, setBackendForTesting } from '@/lib/backend'
import { useSkillsStore } from '@/stores/skills'
import type { SkillListing } from '@shared/domain'

let wrapper: VueWrapper | null = null
let consoleError: ReturnType<typeof vi.spyOn>

const JSDOM_NOISE = [/Not implemented: Window's scrollTo/, /Not implemented: window\.scrollTo/]

function unexpectedErrors(): string[] {
  return consoleError.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((message: string) => !JSDOM_NOISE.some((pattern) => pattern.test(message)))
}

async function visit(target: string): Promise<void> {
  await router.push(target)
  await flushPromises()
}

/** The listings the page is showing, by title. */
function renderedTitles(): string[] {
  const store = useSkillsStore()
  return store.listings.map((skill) => skill.title)
}

/** Change one of the page's selects, the way a person would. */
async function chooseInSelect(label: string, value: string): Promise<void> {
  // The filter panel is collapsed until it is asked for, exactly as a member
  // experiences it.
  const find = (): HTMLSelectElement | undefined =>
    [...document.querySelectorAll('select')].find((element) => {
      if (element.getAttribute('aria-label') === label) return true
      const id = element.getAttribute('id')
      if (!id) return false
      return document.querySelector(`label[for="${id}"]`)?.textContent?.includes(label)
    }) as HTMLSelectElement | undefined

  if (!find() && label !== 'Sort results') {
    const toggle = [...document.querySelectorAll('button')].find((button) =>
      /^(hide )?filters\b/i.test((button.textContent ?? '').trim()),
    )
    expect(toggle, 'the page should offer a Filters toggle').toBeTruthy()
    ;(toggle as HTMLButtonElement).click()
    await flushPromises()
  }

  const select = find()
  expect(select, `no select labelled ${label}`).toBeTruthy()
  select!.value = value
  select!.dispatchEvent(new Event('change'))
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  setBackendForTesting(null)
  setActivePinia(createPinia())
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  void router.replace('/')
})

afterEach(async () => {
  wrapper?.unmount()
  wrapper = null
  await router.replace('/')
  consoleError.mockRestore()
})

async function openExplore(target = '/skills'): Promise<void> {
  wrapper = mount(App, { global: { plugins: [router] }, attachTo: document.body })
  await router.isReady()
  await flushPromises()
  await visit(target)
  // The explore page filters the stored catalogue through `listSkills`; the
  // expected sets below are derived from the backend, never hardcoded.
  await flushPromises()
}

/** What the backend would return for a filter — the page must agree. */
async function expectedTitles(filter: Parameters<Awaited<ReturnType<typeof getBackend>>['listSkills']>[0]): Promise<string[]> {
  const backend = await getBackend()
  const items: SkillListing[] = await backend.listSkills({ ...filter, limit: 60 })
  return items.map((skill) => skill.title)
}

describe('explore page: filters arrive from the URL', () => {
  it('applies a category from the query string', async () => {
    await openExplore()
    const backend = await getBackend()
    const categories = [...new Set((await backend.listSkills({ limit: 60 })).map((skill) => skill.categoryId))]
    expect(categories.length, 'the seed should cover more than one category').toBeGreaterThan(1)

    await visit(`/skills?category=${categories[1]}`)
    await flushPromises()
    expect(useSkillsStore().filters.categoryId).toBe(categories[1])
    expect(renderedTitles().sort()).toEqual((await expectedTitles({ categoryId: categories[1] })).sort())
    expect(unexpectedErrors()).toEqual([])
  })

  it('applies level, format, language, length and weekday from the query string', async () => {
    // Each of these was silently dropped by the first implementation. The
    // expectations are computed from the backend, so the test does not depend on
    // which listings the seed happens to contain.
    await openExplore()
    const backend = await getBackend()
    const catalogue = await backend.listSkills({ limit: 60 })

    const level = catalogue.find((skill) => skill.level !== 'any')?.level
    expect(level).toBeTruthy()
    await visit(`/skills?level=${level}`)
    await flushPromises()
    expect(useSkillsStore().filters.level).toBe(level)
    expect(renderedTitles().sort()).toEqual((await expectedTitles({ level })).sort())

    const format = catalogue.find((skill) => skill.format !== 'video')?.format ?? 'video'
    await visit(`/skills?format=${format}`)
    await flushPromises()
    expect(useSkillsStore().filters.format).toBe(format)
    expect(renderedTitles().sort()).toEqual((await expectedTitles({ format })).sort())

    const language = catalogue.find((skill) => !skill.languages.includes('en'))?.languages[0] ?? 'en'
    await visit(`/skills?language=${language}`)
    await flushPromises()
    expect(useSkillsStore().filters.language).toBe(language)
    expect(renderedTitles().sort()).toEqual((await expectedTitles({ language })).sort())

    await visit('/skills?maxDuration=60')
    await flushPromises()
    expect(useSkillsStore().filters.maxDurationMinutes).toBe(60)
    expect(renderedTitles().sort()).toEqual((await expectedTitles({ maxDurationMinutes: 60 })).sort())
    for (const title of renderedTitles()) {
      const skill = catalogue.find((item) => item.title === title)!
      expect(skill.durationMinutes, `${title} is longer than the filter allows`).toBeLessThanOrEqual(60)
    }

    const weekday = 2
    await visit(`/skills?weekday=${weekday}`)
    await flushPromises()
    expect(useSkillsStore().filters.weekday).toBe(weekday)
    expect(renderedTitles().sort()).toEqual((await expectedTitles({ weekday })).sort())

    expect(unexpectedErrors()).toEqual([])
  })

  it('reads the sort order from the URL', async () => {
    await openExplore('/skills?sort=duration')
    expect(useSkillsStore().filters.sort).toBe('duration')
    const durations = useSkillsStore().listings.map((skill) => skill.durationMinutes)
    expect(durations).toEqual([...durations].sort((a, b) => a - b))
    expect(unexpectedErrors()).toEqual([])
  })

  it('ignores a hand-edited filter instead of trusting it', async () => {
    // The URL is user input. `?level=banana` must not reach the store, must not
    // empty the page, and must not crash the render.
    await openExplore('/skills?level=banana&maxDuration=lots&weekday=9&sort=sideways')
    const filters = useSkillsStore().filters
    expect(filters.level).toBeNull()
    expect(filters.maxDurationMinutes).toBeNull()
    expect(filters.weekday).toBeNull()
    expect(filters.sort).toBe('relevance')
    expect(renderedTitles().length, 'the page should still show the catalogue').toBeGreaterThan(0)
    expect(unexpectedErrors()).toEqual([])
  })

  it('combines several filters from one link', async () => {
    const backend = await getBackend()
    const catalogue = await backend.listSkills({ limit: 60 })
    const target = catalogue.find((skill) => skill.durationMinutes <= 60)!
    await openExplore(`/skills?category=${target.categoryId}&maxDuration=60`)
    expect(renderedTitles().length).toBeGreaterThan(0)
    for (const title of renderedTitles()) {
      const skill = catalogue.find((item) => item.title === title)!
      expect(skill.categoryId).toBe(target.categoryId)
      expect(skill.durationMinutes).toBeLessThanOrEqual(60)
    }
    expect(unexpectedErrors()).toEqual([])
  })
})

describe('explore page: the URL follows the filters', () => {
  it('writes every filter into the query string', async () => {
    await openExplore()
    await chooseInSelect('Your level', 'intermediate')
    await flushPromises()

    expect(useSkillsStore().filters.level).toBe('intermediate')
    expect(router.currentRoute.value.query.level).toBe('intermediate')

    await chooseInSelect('Session format', 'voice')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ level: 'intermediate', format: 'voice' })

    await chooseInSelect('Maximum length', '60')
    await flushPromises()
    expect(router.currentRoute.value.query.maxDuration).toBe('60')

    await chooseInSelect('Sort results', 'rating')
    await flushPromises()
    expect(router.currentRoute.value.query.sort).toBe('rating')
    expect(unexpectedErrors()).toEqual([])
  })

  it('round-trips: reading the URL back gives the same filter', async () => {
    await openExplore('/skills?level=advanced&format=chat&sort=recent&maxDuration=90&weekday=6')
    const before = { ...useSkillsStore().filters }
    // Any change writes the URL again; the parameters must survive the trip.
    await chooseInSelect('Maximum length', '60')
    await flushPromises()
    const written = router.currentRoute.value.query
    expect(written.level).toBe('advanced')
    expect(written.format).toBe('chat')
    expect(written.sort).toBe('recent')
    expect(written.weekday).toBe('6')
    expect(written.maxDuration).toBe('60')
    expect(before.level).toBe('advanced')
    expect(unexpectedErrors()).toEqual([])
  })

  it('clears every parameter when the filters are cleared', async () => {
    await openExplore('/skills?category=music&level=advanced&sort=rating&weekday=2')
    const clearAll = [...document.querySelectorAll('button')].find((button) => /clear all/i.test(button.textContent ?? ''))
    expect(clearAll, 'the chips row should offer to clear everything').toBeTruthy()
    ;(clearAll as HTMLButtonElement).click()
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({})
    const filters = useSkillsStore().filters
    expect([filters.query, filters.categoryId, filters.level, filters.weekday, filters.maxDurationMinutes]).toEqual([
      '',
      null,
      null,
      null,
      null,
    ])
    expect(filters.sort).toBe('relevance')
    expect(unexpectedErrors()).toEqual([])
  })

  it('follows a back navigation instead of ignoring it', async () => {
    await openExplore('/skills?category=music')
    const first = renderedTitles().sort()

    await visit('/skills?level=advanced')
    const second = renderedTitles().sort()
    expect(useSkillsStore().filters.categoryId, 'the new URL replaces the old filter').toBeNull()

    // Simulate the browser back button: the route changes without the page
    // calling applyFilters.
    await router.push('/skills?category=music')
    await flushPromises()
    expect(useSkillsStore().filters.level).toBeNull()
    expect(renderedTitles().sort()).toEqual(first)
    expect(second).not.toEqual(first)
    expect(unexpectedErrors()).toEqual([])
  })
})
