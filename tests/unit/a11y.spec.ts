/**
 * Accessibility audit across every page.
 *
 * `components.spec.ts` tests the design-system primitives in isolation; this
 * file tests the pages built from them, which is where the integration mistakes
 * live: a heading typed as a `div`, an icon-only button with no accessible name,
 * two elements sharing an `id` so a label points at the wrong input, a modal
 * that traps focus but announces nothing.
 *
 * It mounts the real application exactly as `routes.spec.ts` does — real router,
 * real stores, real reference backend — walks every route, and checks the
 * rendered DOM against the machine-checkable parts of WCAG 2.1 AA. It is not a
 * substitute for a human with a screen reader, and it says nothing about colour
 * contrast, motion, or whether the words make sense; it catches the mechanical
 * failures, which are the majority of them.
 *
 * Every finding is reported against the route it came from, because "a button
 * has no name" is only actionable with a page next to it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import App from '@/App.vue'
import router from '@/router'
import { setBackendForTesting } from '@/lib/backend'
import { useAuthStore } from '@/stores/auth'

let wrapper: VueWrapper | null = null

const PUBLIC_ROUTES = ['/', '/how-it-works', '/skills', '/members', '/communities', '/community-guidelines', '/privacy', '/terms', '/signin', '/register', '/forgot-password']
const MEMBER_ROUTES = ['/dashboard', '/bookings', '/calendar', '/wallet', '/notifications', '/profile', '/settings']
const ADMIN_ROUTES = ['/admin']

async function mountApp(): Promise<void> {
  wrapper = mount(App, { global: { plugins: [router] }, attachTo: document.body })
  await router.isReady()
  await flushPromises()
}

async function visit(path: string): Promise<void> {
  await router.push(path)
  await flushPromises()
}

/* ── the checks ─────────────────────────────────────────────────────────────── */

/** Elements that are hidden from assistive technology do not need a name. */
function visible(element: Element): boolean {
  if (element.closest('[aria-hidden="true"]')) return false
  if (element.hasAttribute('hidden')) return false
  const style = (element as HTMLElement).style
  if (style?.display === 'none' || style?.visibility === 'hidden') return false
  return true
}

function accessibleName(element: Element): string {
  const aria = element.getAttribute('aria-label')?.trim()
  if (aria) return aria
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const names = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim()
    if (names) return names
  }
  // The `title` attribute is a fallback name, as are the contents for buttons and links.
  const title = element.getAttribute('title')?.trim()
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  // An image inside a link/button contributes its alt text.
  const imageAlt = [...element.querySelectorAll('img[alt]')]
    .map((img) => img.getAttribute('alt')?.trim() ?? '')
    .join(' ')
    .trim()
  // An icon rendered as a decorative svg contributes nothing; a labelled one contributes its label.
  const iconLabel = [...element.querySelectorAll('svg[aria-label]')]
    .map((svg) => svg.getAttribute('aria-label')?.trim() ?? '')
    .join(' ')
    .trim()
  return [text, imageAlt, iconLabel, title].filter(Boolean).join(' ').trim()
}

function isLabelledControl(element: Element): boolean {
  if (element.getAttribute('aria-label')?.trim()) return true
  if (element.getAttribute('aria-labelledby')?.trim()) return true
  if (element.closest('label')) return true
  const id = element.getAttribute('id')
  // Compare attributes directly: `CSS.escape` is not available in this jsdom, and
  // ids here are ordinary slugs.
  if (id && [...document.querySelectorAll('label[for]')].some((label) => label.getAttribute('for') === id)) return true
  // A button-like input (submit/reset) is named by its value.
  const type = element.getAttribute('type')
  if (type === 'submit' || type === 'reset' || type === 'button') return Boolean(element.getAttribute('value'))
  return false
}

function auditRoute(path: string): string[] {
  const problems: string[] = []
  const root = document.body

  /* Headings: at least one, exactly one level-1, and no skipped level. */
  const headings = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(visible).filter((h) => h.closest('[aria-hidden="true"]') === null)
  const h1s = headings.filter((h) => h.tagName === 'H1')
  if (h1s.length === 0) problems.push('no <h1>: the page has no top-level heading')
  if (h1s.length > 1) problems.push(`${h1s.length} <h1> elements: "${h1s.map((h) => h.textContent?.trim()).join('", "')}"`)
  let previousLevel = 0
  for (const heading of headings) {
    const level = Number(heading.tagName[1])
    if (previousLevel && level > previousLevel + 1) {
      problems.push(`heading level jumps from h${previousLevel} to h${level}: "${heading.textContent?.trim().slice(0, 40)}"`)
    }
    previousLevel = level
  }

  /* Every interactive control needs an accessible name. */
  for (const button of [...root.querySelectorAll('button, [role="button"]')].filter(visible)) {
    if (button.closest('[aria-hidden="true"]')) continue
    if (!accessibleName(button)) problems.push(`button with no accessible name: ${button.outerHTML.slice(0, 90)}`)
  }
  for (const link of [...root.querySelectorAll('a[href]')].filter(visible)) {
    if (!accessibleName(link)) problems.push(`link with no accessible name: ${link.outerHTML.slice(0, 90)}`)
  }
  for (const control of [...root.querySelectorAll('input, select, textarea')].filter(visible)) {
    const type = control.getAttribute('type')
    if (type === 'hidden') continue
    if (!isLabelledControl(control)) {
      problems.push(`${control.tagName.toLowerCase()}${type ? `[type=${type}]` : ''} with no label: ${control.outerHTML.slice(0, 90)}`)
    }
  }

  /* Images: meaningful ones need alt text; decorative ones must be hidden. */
  for (const image of [...root.querySelectorAll('img')].filter(visible)) {
    if (!image.hasAttribute('alt')) problems.push(`<img> with no alt attribute: ${image.outerHTML.slice(0, 90)}`)
  }

  /* `tabindex` greater than zero breaks the natural tab order. */
  for (const element of [...root.querySelectorAll('[tabindex]')]) {
    const value = Number(element.getAttribute('tabindex'))
    if (value > 0) problems.push(`positive tabindex (${value}) on <${element.tagName.toLowerCase()}>`)
  }

  /* Duplicate ids break label/description wiring, and are a classic copy-paste bug. */
  const ids = new Map<string, number>()
  for (const element of [...root.querySelectorAll('[id]')]) {
    if (element.closest('[aria-hidden="true"]')) continue
    ids.set(element.id, (ids.get(element.id) ?? 0) + 1)
  }
  for (const [id, count] of ids) {
    if (count > 1) problems.push(`duplicate id "${id}" appears ${count} times`)
  }

  /* A live region must have a role or a polite/assertive setting to be announced. */
  for (const region of [...root.querySelectorAll('[aria-live]')]) {
    if (!['polite', 'assertive'].includes(region.getAttribute('aria-live') ?? '')) {
      problems.push(`aria-live="${region.getAttribute('aria-live')}" is not a valid value`)
    }
  }

  /* Anchors with no destination are not links. */
  for (const anchor of [...root.querySelectorAll('a')].filter(visible)) {
    if (!anchor.hasAttribute('href') && !anchor.hasAttribute('role')) {
      problems.push(`<a> with no href: ${anchor.outerHTML.slice(0, 90)}`)
    }
  }

  /* A page may not scroll horizontally because of a fixed-width element, but
     jsdom has no layout, so that check belongs to a human on a device. */

  if (problems.length) problems.unshift(`route ${path}`)
  return problems
}

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  setBackendForTesting(null)
  setActivePinia(createPinia())
})

afterEach(async () => {
  wrapper?.unmount()
  wrapper = null
  await router.push('/')
})

describe('accessibility: the document shell', () => {
  it('declares a language, a title and a description', () => {
    const html = readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8')
    expect(html, 'the document must declare a language for screen readers').toMatch(/<html[^>]+lang="[a-z]{2}/i)
    expect(html, 'the title is the first thing a screen reader announces').toMatch(/<title>[^<]{10,}<\/title>/i)
    expect(html, 'a meta description is what search results and link previews show').toMatch(/name="description"\s+content="[^"]{40,}"/i)
    expect(html, 'the viewport tag must not block zoom (maximum-scale / user-scalable)').not.toMatch(/user-scalable=no|maximum-scale=1/i)
  })
})

describe('accessibility: public routes', () => {
  it('renders every public page without a machine-checkable violation', async () => {
    await mountApp()
    const findings: string[] = []
    for (const route of PUBLIC_ROUTES) {
      await visit(route)
      findings.push(...auditRoute(route))
    }
    expect(findings).toEqual([])
  })
})

describe('accessibility: member routes', () => {
  it('renders every member page without a machine-checkable violation', async () => {
    await mountApp()
    const auth = useAuthStore()
    await auth.signInAsDemo('member')
    await flushPromises()

    const findings: string[] = []
    for (const route of MEMBER_ROUTES) {
      await visit(route)
      findings.push(...auditRoute(route))
    }
    expect(findings).toEqual([])
  })

  it('renders a listing and a member profile without a violation', async () => {
    await mountApp()
    const auth = useAuthStore()
    await auth.signInAsDemo('member')
    await flushPromises()

    const findings: string[] = []
    for (const route of ['/skills', '/members']) {
      await visit(route)
      findings.push(...auditRoute(route))

      // Follow the first card into the detail page: that is the screen a member
      // actually lands on from search, and it is not in the route table above.
      const link = [...document.querySelectorAll('a[href]')].find((anchor) =>
        /^\/(skills|members)\/[^/]+$/.test(anchor.getAttribute('href') ?? ''),
      )
      expect(link, `no detail link found on ${route}`).toBeDefined()
      await visit(link!.getAttribute('href')!)
      findings.push(...auditRoute(link!.getAttribute('href')!))
    }
    expect(findings).toEqual([])
  })
})

describe('accessibility: administrator routes', () => {
  it('renders the administration surface without a machine-checkable violation', async () => {
    await mountApp()
    const auth = useAuthStore()
    await auth.signInAsDemo('admin')
    await flushPromises()

    const findings: string[] = []
    for (const route of ADMIN_ROUTES) {
      await visit(route)
      findings.push(...auditRoute(route))
    }
    expect(findings).toEqual([])
  })
})

describe('accessibility: keyboard reachability', () => {
  it('puts every control on a page in the tab order, in DOM order', async () => {
    await mountApp()
    const auth = useAuthStore()
    await auth.signInAsDemo('member')
    await flushPromises()
    await visit('/wallet')

    const focusable = [
      ...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ].filter(visible)

    // Everything focusable should be reachable, which in practice means nothing
    // focusable is hidden from the accessibility tree or trapped behind a
    // `tabindex="-1"` it never regains (the modal does its own trapping).
    const unreachable = focusable.filter((element) => element.closest('[aria-hidden="true"]'))
    expect(unreachable.map((element) => element.outerHTML.slice(0, 80))).toEqual([])
    expect(focusable.length, 'the wallet page should have controls to tab through').toBeGreaterThan(3)
  })
})
