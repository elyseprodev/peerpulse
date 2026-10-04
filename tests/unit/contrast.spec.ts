/**
 * Colour contrast, measured rather than asserted.
 *
 * The accessibility audit (`tests/unit/a11y.spec.ts`) checks the DOM and says
 * plainly that it cannot check contrast: contrast is a property of the computed
 * colours, and there is no browser here. That is true of *rendered* pages — but
 * not of the palette. The palette is nine CSS custom properties in
 * `src/assets/styles/main.css`, so WCAG's contrast formula can be applied to it
 * exactly, in both themes.
 *
 * This suite does three things:
 *
 *   1. Parses the tokens out of the stylesheet (never hardcodes them — a test
 *      that restates the values it is checking proves nothing).
 *   2. Derives which tokens are used as *text* by scanning `src/` for
 *      `text-<token>` classes, then requires every one of them to reach 4.5 : 1
 *      against all three page backgrounds, in both themes. Add a `text-warn`
 *      somewhere and `warn` has to survive on canvas, surface and surface-2.
 *   3. Pins the few deliberate exceptions — decorative text, and the label that
 *      sits on a brand fill rather than on a page — so an exemption cannot be
 *      added quietly.
 *
 * It found a real defect on its first run: the light theme reused the dark
 * theme's accent hexes, so `text-brand-bright` measured 2.54 : 1 on white, cyan
 * 1.81 : 1 and warn 1.67 : 1 — a light theme whose links, warnings and errors
 * were unreadable. `docs/design-system.md` §7 records the fix.
 *
 * What it still cannot see: the actual rendered background behind any given
 * element (a card can sit on a gradient, an image or a translucent overlay), and
 * font size, so the 3 : 1 large-text allowance is not used — everything is held
 * to the stricter 4.5 : 1. Opacity modifiers (`text-muted/70`) are also out of
 * reach, since the effective colour depends on what is behind it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const CSS = readFileSync(path.join(ROOT, 'src/assets/styles/main.css'), 'utf8')

/** Every `--color-*: #rrggbb` declaration inside a given block of the stylesheet. */
function palette(block: string): Record<string, string> {
  const themeStart = CSS.indexOf(block)
  expect(themeStart, `the stylesheet should still have a ${block} block`).toBeGreaterThan(-1)
  const themeEnd = CSS.indexOf('\n}', themeStart)
  const theme = CSS.slice(themeStart, themeEnd)

  const tokens: Record<string, string> = {}
  for (const match of theme.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1]] = match[2].toLowerCase()
  }
  expect(Object.keys(tokens).length, `${block} should declare the palette`).toBeGreaterThan(8)
  return tokens
}

const DARK = palette('@theme {')
const LIGHT = palette('html.light {')

/** The three backgrounds the application puts text on. */
const BACKGROUNDS = ['canvas', 'surface', 'surface-2'] as const

/**
 * Tokens used as text that are deliberately below the threshold, with the
 * reason. Anything not listed here must pass.
 */
const DECORATIVE: Record<string, string> = {
  line:
    'never carries information: the empty rating stars are inside an aria-hidden wrapper and the step numerals ' +
    'on /community-guidelines are aria-hidden beside an h3 that says the same thing',
  'on-brand': 'sits on a brand-coloured fill, not on a page background — checked separately below',
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

/** WCAG 2.1 contrast ratio, to two decimals. */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
}

function walk(dir: string, extensions: string[]): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...walk(full, extensions))
    else if (extensions.some((extension) => entry.endsWith(extension))) found.push(full)
  }
  return found
}

/** Which palette tokens the application actually uses as text colours. */
function textTokensInUse(): Map<string, string[]> {
  const used = new Map<string, string[]>()
  for (const file of walk(path.join(ROOT, 'src'), ['.vue', '.ts'])) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/(?:^|[\s"'`:])(?:hover:|focus:|group-hover:|peer-checked:|active:)*text-([a-z0-9-]+)/g)) {
      const token = match[1]
      if (!(token in DARK)) continue
      const files = used.get(token) ?? []
      const relative = path.relative(ROOT, file)
      if (!files.includes(relative)) files.push(relative)
      used.set(token, files)
    }
  }
  return used
}

const IN_USE = textTokensInUse()

describe('contrast: the dark theme (the product default)', () => {
  it('reaches 4.5 : 1 for every text token on every page background', () => {
    const failures: string[] = []
    for (const [token, files] of IN_USE) {
      if (token in DECORATIVE) continue
      for (const background of BACKGROUNDS) {
        const ratio = contrast(DARK[token], DARK[background])
        if (ratio < 4.5) {
          failures.push(
            `text-${token} on bg-${background}: ${ratio} : 1 (used in ${files.slice(0, 2).join(', ')})`,
          )
        }
      }
    }
    expect(failures, 'WCAG 2.1 AA needs 4.5 : 1 for normal-size text').toEqual([])
  })

  it('reaches 4.5 : 1 for the label on a brand-coloured fill', () => {
    expect(contrast(DARK['on-brand'], DARK.brand)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps a focus ring visible against the page (3 : 1 for non-text)', () => {
    for (const background of BACKGROUNDS) {
      expect(
        contrast(DARK.brand, DARK[background]),
        `the focus ring uses the brand colour against ${background}`,
      ).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('contrast: the light theme', () => {
  it('reaches 4.5 : 1 for every text token on every page background', () => {
    const failures: string[] = []
    for (const [token, files] of IN_USE) {
      if (token in DECORATIVE) continue
      for (const background of BACKGROUNDS) {
        const ratio = contrast(LIGHT[token], LIGHT[background])
        if (ratio < 4.5) {
          failures.push(
            `text-${token} on bg-${background}: ${ratio} : 1 (used in ${files.slice(0, 2).join(', ')})`,
          )
        }
      }
    }
    expect(failures, 'WCAG 2.1 AA needs 4.5 : 1 for normal-size text').toEqual([])
  })

  it('reaches 4.5 : 1 for the label on a brand-coloured fill', () => {
    expect(contrast(LIGHT['on-brand'], LIGHT.brand)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps a focus ring visible against the page', () => {
    for (const background of BACKGROUNDS) {
      expect(contrast(LIGHT.brand, LIGHT[background])).toBeGreaterThanOrEqual(3)
    }
  })

  it('declares the same token names as the dark theme', () => {
    // A missing token silently inherits the dark value, which is exactly how the
    // light theme's contrasts broke the first time.
    for (const token of Object.keys(DARK)) {
      expect(LIGHT[token], `html.light should declare --color-${token} explicitly`).toBeDefined()
    }
  })
})

describe('contrast: the rules the palette itself has to follow', () => {
  it('uses no hardcoded text or surface colour outside the tokens', () => {
    // Arbitrary hexes are invisible to a palette test — that is how the primary
    // button's label colour hid from this suite until it was tokenised.
    const allowed = new Set(['#04101a']) // the modal/video scrim, documented in the design system
    const found: string[] = []
    for (const file of walk(path.join(ROOT, 'src'), ['.vue'])) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/(?:text|bg|border)-\[(#[0-9a-fA-F]{6})\]/g)) {
        if (!allowed.has(match[1].toLowerCase())) found.push(`${path.relative(ROOT, file)}: ${match[0]}`)
      }
    }
    expect(found, 'use a design token instead of a literal colour').toEqual([])
  })

  it('keeps the brand palette the brief specified, in the dark theme', () => {
    expect(DARK).toMatchObject({
      canvas: '#071521',
      surface: '#0b1f2d',
      brand: '#10b981',
      'brand-bright': '#34d399',
      muted: '#a7bbc8',
      line: '#1d4553',
      cyan: '#22d3ee',
      ink: '#ffffff',
    })
  })

  it('marks every token used as text as checked, or explains why it is exempt', () => {
    for (const token of IN_USE.keys()) {
      const checked = BACKGROUNDS.every((background) => contrast(DARK[token], DARK[background]) >= 4.5)
      expect(
        checked || token in DECORATIVE,
        `text-${token} is used as text but appears in neither the passing set nor the documented exceptions`,
      ).toBe(true)
    }
    expect(Object.keys(DECORATIVE).length, 'exceptions should be rare and reasoned').toBeLessThanOrEqual(2)
  })
})
