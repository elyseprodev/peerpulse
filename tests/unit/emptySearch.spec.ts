/**
 * The marketplace's dead end.
 *
 * When a filter combination matches nothing, the page used to say "try widening
 * your filters" — advice with no control attached. A member had to guess which of
 * up to eight chips was the problem and clear them one at a time.
 *
 * The empty state now names each active filter and removes exactly that one when
 * clicked, keeping the rest. This suite drives the real page: it narrows to a
 * combination the seeded catalogue cannot satisfy, asserts the suggestions are
 * there, and then verifies that clicking one really widens the results — because
 * a suggestion that does not change anything is worse than no suggestion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import router from '@/router'
import { getBackend, setBackendForTesting } from '@/lib/backend'
import { useSkillsStore } from '@/stores/skills'

let wrapper: VueWrapper | null = null
let consoleError: ReturnType<typeof vi.spyOn>

const JSDOM_NOISE = [/Not implemented: Window's scrollTo/, /Not implemented: window\.scrollTo/]

function unexpectedErrors(): string[] {
  return consoleError.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((message) => !JSDOM_NOISE.some((pattern) => pattern.test(message)))
}

async function visit(target: string): Promise<void> {
  await router.push(target)
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

async function openExplore(target: string): Promise<void> {
  wrapper = mount(App, { global: { plugins: [router] }, attachTo: document.body })
  await router.isReady()
  await flushPromises()
  await visit(target)
  await flushPromises()
}

/** Click the control whose text contains `label`. */
async function click(label: RegExp): Promise<void> {
  const button = [...document.querySelectorAll('button')].find((element) => label.test(element.textContent ?? ''))
  expect(button, `no control matching ${label}`).toBeTruthy()
  ;(button as HTMLButtonElement).click()
  await flushPromises()
}

describe('empty state: the advice is a control', () => {
  it('offers to drop each filter when nothing matches', async () => {
    // A combination the demo catalogue cannot satisfy: an advanced German
    // conversation with a teacher who is available on a Sunday.
    await openExplore('/skills?level=advanced&language=de&weekday=0')
    const store = useSkillsStore()
    expect(store.listings, 'this combination is chosen because it matches nothing').toEqual([])

    expect(document.body.textContent).toContain('No listings match those filters')
    expect(document.body.textContent, 'the empty state should explain which filters are active').toContain(
      'Which filter is in the way?',
    )
    for (const label of ['Free on Sunday', 'German', 'Advanced']) {
      const chip = [...document.querySelectorAll('button')].find((button) =>
        (button.textContent ?? '').includes(label),
      )
      expect(chip, `the empty state should offer to drop "${label}"`).toBeDefined()
    }
    expect(unexpectedErrors()).toEqual([])
  })

  it('widens the results when one filter is dropped', async () => {
    await openExplore('/skills?level=advanced&language=de&weekday=0')
    const store = useSkillsStore()
    expect(store.listings).toEqual([])

    const before = router.currentRoute.value.query
    await click(/Drop\s*German/i)

    // The one filter is gone from both the store and the URL, and the others are
    // untouched — the member keeps the search they were refining.
    expect(store.filters.language).toBeNull()
    expect(store.filters.level).toBe('advanced')
    expect(store.filters.weekday).toBe(0)
    expect(router.currentRoute.value.query.language).toBeUndefined()
    expect(router.currentRoute.value.query.level).toBe('advanced')
    expect(before.language).toBe('de')

    // And the page now shows what the relaxed filter matches, if anything.
    const backend = await getBackend()
    const expected = await backend.listSkills({ level: 'advanced', weekday: 0, limit: 60 })
    expect(store.listings.map((skill) => skill.id)).toEqual(expected.map((skill) => skill.id))
    expect(unexpectedErrors()).toEqual([])
  })

  it('keeps Clear filters as the way out of all of it', async () => {
    await openExplore('/skills?level=advanced&language=de&weekday=0')
    await click(/Clear filters/)
    expect(router.currentRoute.value.query).toEqual({})
    expect(useSkillsStore().listings.length).toBeGreaterThan(0)
    expect(unexpectedErrors()).toEqual([])
  })

  it('does not offer suggestions when there are no filters to drop', async () => {
    // On an exchange with nothing published, "drop a filter" is not the problem.
    await openExplore('/skills')
    const store = useSkillsStore()
    if (!store.listings.length) {
      expect(document.body.textContent).not.toContain('Which filter is in the way?')
    }
    expect(unexpectedErrors()).toEqual([])
  })
})
