/**
 * Navigation integrity.
 *
 * Every other suite mounts pages and asserts that they *render*. None of them
 * assert that the links inside those pages *go anywhere*: a CTA with a typo
 * ("/skiils/…"), a renamed route that a component still points at, or a
 * `href="#"` placeholder renders perfectly, passes every render and
 * accessibility check, and dead-ends a user.
 *
 * Two passes, because they catch different things:
 *
 *   1. **Static** — every route-shaped string literal in `to=`, `href=`,
 *      `router.push(...)` and `router.replace(...)` across `src/`, with each
 *      template parameter replaced by a dummy segment, resolved against the real
 *      router. This reaches components in states no sweep can render (error
 *      states, empty states, admin-only branches).
 *   2. **Runtime** — the anchors each page actually renders, resolved the same
 *      way, plus the promises that matter for a public site: no `href="#"` dead
 *      links, no `javascript:` URLs, external links over https, and every page a
 *      member is supposed to be able to reach reachable by clicking.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '@/App.vue'
import router from '@/router'
import { setBackendForTesting } from '@/lib/backend'
import { useAuthStore } from '@/stores/auth'

const ROOT = process.cwd()

function walk(dir: string, extensions: string[]): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...walk(full, extensions))
    else if (extensions.some((extension) => entry.endsWith(extension))) found.push(full)
  }
  return found
}

/** Does `target` land on a real route, rather than the catch-all? */
function resolves(target: string): boolean {
  const resolved = router.resolve(target)
  return resolved.matched.length > 0 && resolved.name !== 'not-found'
}

/** A route-shaped string, with template parameters replaced by a dummy segment. */
function concrete(target: string): string {
  return target.replace(/\$\{[^}]*\}/g, 'x')
}

/** Is this a string that is supposed to be an in-app path? */
function inAppPath(target: string): boolean {
  return target.startsWith('/') && !target.startsWith('//')
}

describe('navigation: every link in the source resolves to a route', () => {
  /**
   * `to=`, `href=`, `push(` and `replace(` — the four ways this codebase sends a
   * user somewhere. Captures the literal that follows, then filters to paths.
   */
  const LINK_PATTERNS = [
    /(?::?to|:?href)\s*=\s*"([^"]+)"/g,
    /(?::?to|:?href)\s*=\s*'([^']+)'/g,
    /\.(?:push|replace)\(\s*'([^']+)'/g,
    /\.(?:push|replace)\(\s*"([^"]+)"/g,
  ]

  const files = [...walk(path.join(ROOT, 'src'), ['.vue', '.ts'])]

  it('covers the whole source tree', () => {
    expect(files.length, 'the scanner should find the application source').toBeGreaterThan(60)
  })

  it('resolves every route-shaped literal it finds', () => {
    const broken: string[] = []
    let checked = 0

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const pattern of LINK_PATTERNS) {
        pattern.lastIndex = 0
        for (const match of source.matchAll(pattern)) {
          // `:to="`/skills/${id}`"` captures the surrounding backticks too.
          const raw = match[1].replace(/^[`'"]+|[`'"]+$/g, '')
          if (!inAppPath(raw) || raw === '/') continue
          const target = concrete(raw)
          checked += 1
          if (!resolves(target)) {
            broken.push(`${path.relative(ROOT, file)}: "${raw}" → ${target} matches no route`)
          }
        }
      }
    }

    expect(checked, 'the scan should have found the app\'s links').toBeGreaterThan(40)
    expect(broken, 'these links would dead-end a user').toEqual([])
  })

  it('never sends a user to a placeholder address', () => {
    const placeholders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const pattern of [/href="#"|to="#"/g, /href="javascript:/gi, /href=""/g]) {
        pattern.lastIndex = 0
        if (pattern.test(source)) placeholders.push(`${path.relative(ROOT, file)}: ${pattern.source}`)
      }
    }
    expect(placeholders).toEqual([])
  })

  it('keeps every external link on https, and every mailto a mailto', () => {
    const problems: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/(?:href|:href)\s*=\s*["'](https?:[^"']+)["']/g)) {
        if (match[1].startsWith('http://')) problems.push(`${path.relative(ROOT, file)}: ${match[1]}`)
      }
      for (const match of source.matchAll(/href\s*=\s*["'](mailto:[^"']+)["']/g)) {
        // A mailto may carry a subject/body query string; the address is the part
        // before the `?`.
        const address = match[1].split('?')[0]
        if (!/^mailto:[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(address)) {
          problems.push(`${path.relative(ROOT, file)}: ${match[1]}`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})

describe('navigation: the pages the app renders', () => {
  const GUEST_PAGES = [
    '/',
    '/how-it-works',
    '/skills',
    '/members',
    '/communities',
    '/community-guidelines',
    '/privacy',
    '/terms',
    '/signin',
    '/register',
    '/forgot-password',
  ]

  let wrapper: VueWrapper | null = null
  let consoleError: ReturnType<typeof vi.spyOn>

  const JSDOM_NOISE = [/Not implemented: Window's scrollTo/, /Not implemented: window\.scrollTo/]

  function unexpectedErrors(): string[] {
    return consoleError.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .filter((message: string) => !JSDOM_NOISE.some((pattern) => pattern.test(message)))
  }

  async function mountApp(): Promise<void> {
    wrapper = mount(App, { global: { plugins: [router] }, attachTo: document.body })
    await router.isReady()
    await flushPromises()
  }

  async function visit(target: string): Promise<void> {
    await router.push(target)
    await flushPromises()
  }

  /** Every anchor currently in the document, as { href, label, path }. */
  function anchors(): Array<{ href: string; label: string }> {
    return [...document.querySelectorAll('a')].map((anchor) => ({
      href: anchor.getAttribute('href') ?? '',
      label: (anchor.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60) || '(no text)',
    }))
  }

  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
    setBackendForTesting(null)
    setActivePinia(createPinia())
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // The router keeps the last location between tests; start each one at the root.
    void router.replace('/')
  })

  afterEach(async () => {
    wrapper?.unmount()
    wrapper = null
    await router.replace('/')
    consoleError.mockRestore()
  })

  it('renders only internal links that resolve, on every public page', async () => {
    await mountApp()
    const broken: string[] = []
    let internal = 0

    for (const page of GUEST_PAGES) {
      await visit(page)
      for (const anchor of anchors()) {
        const href = anchor.href
        if (!inAppPath(href)) continue
        internal += 1
        if (!resolves(href)) broken.push(`${page} → "${anchor.label}" points at ${href}`)
      }
    }

    expect(internal, 'the public pages should link to each other').toBeGreaterThan(15)
    expect(broken, 'these anchors would dead-end a visitor').toEqual([])
    expect(unexpectedErrors()).toEqual([])
  })

  it('resolves every link on the member surface, including detail pages', async () => {
    await mountApp()
    const auth = useAuthStore()
    await auth.signInAsDemo('member')
    await flushPromises()

    const pages = [
      '/dashboard',
      '/bookings',
      '/calendar',
      '/wallet',
      '/notifications',
      '/profile',
      '/settings',
      '/skills',
      '/members',
      '/communities',
    ]
    const broken: string[] = []
    let internal = 0

    for (const page of pages) {
      await visit(page)
      for (const anchor of anchors()) {
        if (!inAppPath(anchor.href)) continue
        internal += 1
        if (!resolves(anchor.href)) broken.push(`${page} → "${anchor.label}" points at ${anchor.href}`)
      }
    }

    expect(internal, 'the member surface should link around').toBeGreaterThan(20)
    expect(broken, 'a member clicking one of these would hit the 404 page').toEqual([])
    expect(unexpectedErrors()).toEqual([])
  })

  it('links a listing, a member and a community through to their detail pages', async () => {
    await mountApp()
    const auth = useAuthStore()
    await auth.signInAsDemo('member')
    await flushPromises()

    // The listing cards link with a template literal; prove one of them lands on
    // a detail route whose page then renders, not just resolves.
    await visit('/skills')
    const skillLink = anchors().find((anchor) => inAppPath(anchor.href) && anchor.href.startsWith('/skills/'))
    expect(skillLink, 'a listing card should link to its detail page').toBeDefined()
    await visit(skillLink!.href)
    expect(router.currentRoute.value.name).toBe('skill-detail')
    expect(unexpectedErrors()).toEqual([])

    await visit('/members')
    const memberLink = anchors().find((anchor) => inAppPath(anchor.href) && anchor.href.startsWith('/members/'))
    expect(memberLink, 'a member card should link to its profile').toBeDefined()
    await visit(memberLink!.href)
    expect(router.currentRoute.value.name).toBe('member-profile')
    expect(unexpectedErrors()).toEqual([])

    await visit('/communities')
    const communityLink = anchors().find(
      (anchor) => inAppPath(anchor.href) && anchor.href.startsWith('/communities/'),
    )
    expect(communityLink, 'a community card should link to its page').toBeDefined()
    await visit(communityLink!.href)
    expect(router.currentRoute.value.name).toBe('community-detail')
    expect(unexpectedErrors()).toEqual([])
  })

  it('makes every member page reachable by clicking from the dashboard', async () => {
    await mountApp()
    const auth = useAuthStore()
    await auth.signInAsDemo('member')
    await flushPromises()

    // One hop from the dashboard, which is the hub the navigation points at.
    await visit('/dashboard')
    const firstHop = new Set(anchors().map((anchor) => anchor.href).filter(inAppPath))
    const reachable = new Set(['/dashboard', ...firstHop])

    // Two hops: from everything the dashboard links to.
    for (const page of [...firstHop]) {
      if (!resolves(page)) continue
      await visit(page)
      for (const anchor of anchors()) {
        if (inAppPath(anchor.href)) reachable.add(anchor.href)
      }
    }

    const expected = ['/dashboard', '/bookings', '/calendar', '/wallet', '/notifications', '/profile', '/settings']
    const missing = expected.filter((page) => !reachable.has(page))
    expect(missing, 'these member pages are not reachable by clicking from the dashboard').toEqual([])
    expect(unexpectedErrors()).toEqual([])
  })

  it('gives a signed-out visitor a way in and a signed-in member a way out', async () => {
    await mountApp()
    await visit('/')
    const guestLinks = anchors().map((anchor) => anchor.href)
    expect(guestLinks, 'the landing page should offer sign-in').toContain('/signin')
    expect(guestLinks, 'and a way to register').toContain('/register')

    const auth = useAuthStore()
    await auth.signInAsDemo('member')
    await flushPromises()
    await visit('/dashboard')

    // Sign-out is an action inside the account menu, not a link: open the menu the
    // way a member would, then look for it. (This caught a genuine dead end in an
    // earlier shell — a menu whose only exit was a link to a route that no longer
    // existed — so it is asserted by opening it, never by grepping the source.)
    const accountMenu = [...document.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Account menu',
    )
    expect(accountMenu, 'a signed-in member needs an account menu').toBeDefined()
    ;(accountMenu as HTMLButtonElement).click()
    await flushPromises()
    const signOut = [...document.querySelectorAll('button')].find((button) =>
      /sign out|log out/i.test(`${button.textContent ?? ''} ${button.getAttribute('aria-label') ?? ''}`),
    )
    expect(signOut, 'the account menu must offer a way to sign out').toBeDefined()

    await auth.signOut()
    await flushPromises()
    await visit('/wallet')
    expect(router.currentRoute.value.name, 'signing out must close the member surface').toBe('signin')
    expect(unexpectedErrors()).toEqual([])
  })
})
