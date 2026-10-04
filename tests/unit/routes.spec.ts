/**
 * Route smoke test.
 *
 * Mounts the real application — real router, real Pinia stores, real reference
 * backend — and walks every route in the table. The point is not to assert
 * pixel-level detail: it is to prove that each page renders without a console
 * error, that the UX guards send the right people where they belong, and that
 * signing in does not break the shell.
 *
 * A console error is treated as a failure because that is how Vue reports
 * render-time exceptions and failed dynamic imports; a page that throws would
 * otherwise pass silently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import router from '@/router'
import { setBackendForTesting } from '@/lib/backend'
import { useAuthStore } from '@/stores/auth'

/** Public routes, with a phrase that proves the right page rendered. */
const PUBLIC_ROUTES: Array<[path: string, expect: string]> = [
  ['/', 'Trade Time'],
  ['/how-it-works', 'How it works'],
  ['/skills', 'Explore'],
  ['/members', 'Members'],
  ['/communities', 'Communities'],
  ['/community-guidelines', 'guideline'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/signin', 'Sign in'],
  ['/register', 'account'],
  ['/forgot-password', 'password'],
]

/** Routes that must bounce a signed-out visitor to the sign-in screen. */
const PROTECTED_ROUTES = ['/dashboard', '/bookings', '/calendar', '/wallet', '/notifications', '/profile', '/settings', '/admin']

let wrapper: VueWrapper | null = null
let consoleError: ReturnType<typeof vi.spyOn>

/**
 * jsdom does not implement scrolling and says so on `console.error`. The router
 * scrolls on every navigation, so these two are expected noise — anything else
 * on `console.error` is a real render problem.
 */
const JSDOM_NOISE = [/Not implemented: Window's scrollTo/, /Not implemented: window\.scrollTo/]

function unexpectedErrors(): string[] {
  return consoleError.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((message: string) => !JSDOM_NOISE.some((pattern) => pattern.test(message)))
}

async function mountApp(): Promise<void> {
  wrapper = mount(App, {
    global: { plugins: [router] },
    attachTo: document.body,
  })
  await router.isReady()
  await flushPromises()
}

async function visit(path: string): Promise<void> {
  await router.push(path)
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  // Force a fresh reference backend and a fresh store graph per test.
  setBackendForTesting(null)
  setActivePinia(createPinia())
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  wrapper?.unmount()
  wrapper = null
  await router.push('/')
  consoleError.mockRestore()
})

describe('route rendering', () => {
  it('renders every public route without a console error', async () => {
    await mountApp()
    for (const [path, expected] of PUBLIC_ROUTES) {
      await visit(path)
      expect(router.currentRoute.value.path, `route ${path} should be current`).toBe(path)
      expect(wrapper!.html(), `route ${path} should render its content`).toContain(expected)
    }
    expect(unexpectedErrors()).toEqual([])
  })

  it('renders the not-found page for an unknown path', async () => {
    await mountApp()
    await visit('/this/does/not/exist')
    expect(wrapper!.text()).toMatch(/not on the calendar/i)
    expect(unexpectedErrors()).toEqual([])
  })

  it('redirects every protected route to sign-in for a guest', async () => {
    await mountApp()
    for (const path of PROTECTED_ROUTES) {
      await visit(path)
      const current = router.currentRoute.value
      expect(current.name, `guest visiting ${path}`).toBe('signin')
      expect(current.query.redirect, `redirect is remembered for ${path}`).toBe(path)
    }
    expect(unexpectedErrors()).toEqual([])
  })
})

describe('member routes', () => {
  beforeEach(async () => {
    await mountApp()
    const auth = useAuthStore()
    await auth.signInAsDemo('member')
    await flushPromises()
  })

  it('renders the member surface without a console error', async () => {
    for (const [path, expected] of [
      ['/dashboard', 'Time Tokens'],
      ['/bookings', ''],
      ['/calendar', ''],
      ['/wallet', 'Time Token'],
      ['/notifications', ''],
      ['/profile', ''],
      ['/settings', ''],
    ] as Array<[string, string]>) {
      await visit(path)
      expect(router.currentRoute.value.path, `route ${path} should be current`).toBe(path)
      if (expected) expect(wrapper!.html()).toContain(expected)
    }
    expect(unexpectedErrors()).toEqual([])
  })

  it('does not let a member into the administration surface', async () => {
    await visit('/admin')
    expect(router.currentRoute.value.name).toBe('dashboard')
    expect(unexpectedErrors()).toEqual([])
  })

  it('returns a member to the sign-in page after signing out', async () => {
    const auth = useAuthStore()
    await auth.signOut()
    await flushPromises()
    await visit('/wallet')
    expect(router.currentRoute.value.name).toBe('signin')
    expect(unexpectedErrors()).toEqual([])
  })
})

describe('administrator routes', () => {
  it('renders the administration dashboard for a steward', async () => {
    await mountApp()
    const auth = useAuthStore()
    await auth.signInAsDemo('admin')
    await flushPromises()
    await visit('/admin')
    expect(router.currentRoute.value.path).toBe('/admin')
    expect(wrapper!.html()).toContain('Platform administration')
    expect(unexpectedErrors()).toEqual([])
  })
})
