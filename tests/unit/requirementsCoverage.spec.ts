/**
 * Requirements coverage, checked.
 *
 * `docs/requirements-coverage.md` maps all 34 functional requirements to the code
 * that implements them and the test that proves them. A table like that rots the
 * moment a file is renamed, a test is reworded, or a requirement is quietly
 * dropped — and a coverage document that has drifted is worse than none, because
 * it is read as evidence.
 *
 * This suite checks the claims a machine can check:
 *   1. Every FR-1…FR-34 appears exactly once — no requirement goes unlisted, and
 *      none is listed twice with different answers.
 *   2. Every repository path cited in the table exists.
 *   3. Every test title in quotes really appears in the test file it is
 *      attributed to.
 *   4. A row claiming `verified` cites at least one test file; a row claiming
 *      `not implemented` cites none (if it had a test, it would be implemented).
 *   5. Statuses come from the fixed vocabulary the document defines.
 *
 * What it cannot check: whether a test is *good*, or whether the code in the
 * "implemented in" column really does what the row says. Those need a reader.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const DOC_PATH = path.join(ROOT, 'docs/requirements-coverage.md')
const DOC = readFileSync(DOC_PATH, 'utf8')

const STATUSES = ['verified', 'partial', 'not implemented'] as const
type Status = (typeof STATUSES)[number]

/** Straighten curly quotes so a citation can be written in ASCII. */
function normalise(text: string): string {
  return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
}

interface Row {
  fr: string
  requirement: string
  implementedIn: string
  verifiedBy: string
  status: Status
  limits: string
}

function cells(line: string): string[] {
  // The table has no escaped pipes; split on the delimiters and trim.
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

const ROWS: Row[] = DOC.split('\n')
  .filter((line) => /^\|\s*FR-\d+\s*\|/.test(line))
  .map((line) => {
    const [fr, requirement, implementedIn, verifiedBy, status, limits] = cells(line)
    return {
      fr,
      requirement,
      implementedIn,
      verifiedBy,
      status: status.replace(/`/g, '') as Status,
      limits,
    }
  })

/** Every `path/like/this.ext` in a cell, in backticks, that could be a repo path. */
function pathsIn(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((value) => /^(src|docs|shared|functions|tests)\//.test(value) && !value.includes(' '))
}

/**
 * Every `tests/...spec.ts`: "a title", "another title" attribution in a cell.
 * A cell can name several files, so each file owns only the titles between it and
 * the next file — otherwise a title from the second file is attributed to the first.
 */
function attributionsIn(cell: string): Array<{ file: string; titles: string[] }> {
  const markers = [...cell.matchAll(/`((?:tests|functions\/tests)\/[^`]+\.spec\.ts)`/g)]
  return markers.map((marker, index) => {
    const start = (marker.index ?? 0) + marker[0].length
    const end = index + 1 < markers.length ? (markers[index + 1].index ?? cell.length) : cell.length
    const chunk = cell.slice(start, end)
    return { file: marker[1], titles: [...chunk.matchAll(/"([^"]+)"/g)].map((title) => title[1]) }
  })
}

describe('requirements coverage: the document is complete', () => {
  it('lists every requirement exactly once', () => {
    expect(ROWS.length, 'the table should have one row per requirement').toBe(34)
    const ids = ROWS.map((row) => row.fr)
    const expected = Array.from({ length: 34 }, (_, index) => `FR-${index + 1}`)
    expect([...ids].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))).toEqual(expected)
    expect(new Set(ids).size, 'a requirement listed twice is a contradiction').toBe(34)
  })

  it('uses only the statuses the document defines', () => {
    for (const row of ROWS) {
      expect(STATUSES, `${row.fr} has status "${row.status}"`).toContain(row.status)
    }
    // The vocabulary is defined in the document, not only in this test.
    for (const status of STATUSES) expect(DOC).toContain(`\`${status}\``)
  })

  it('says something in the column that matters', () => {
    for (const row of ROWS) {
      expect(row.requirement.length, `${row.fr} needs a requirement summary`).toBeGreaterThan(10)
      const emptyImplementation = row.implementedIn.trim() === '—'
      expect(
        emptyImplementation || row.implementedIn.length > 3,
        `${row.fr} needs an implementation column, or an em dash if there is none`,
      ).toBe(true)
      expect(
        emptyImplementation && row.status !== 'not implemented',
        `${row.fr} has no implementation but is not marked "not implemented"`,
      ).toBe(false)
      expect(row.limits.length, `${row.fr} must say what is not proven, "—" at minimum`).toBeGreaterThan(0)
    }
  })
})

describe('requirements coverage: the evidence exists', () => {
  it('cites only files that are in the repository', () => {
    const missing: string[] = []
    for (const row of ROWS) {
      for (const cell of [row.implementedIn, row.verifiedBy, row.limits]) {
        for (const target of pathsIn(cell)) {
          if (!existsSync(path.join(ROOT, target))) missing.push(`${row.fr}: ${target}`)
        }
      }
    }
    expect(missing, 'a renamed or deleted file makes the coverage table a lie').toEqual([])
  })

  it('attributes every quoted test title to a test file that contains it', () => {
    const wrong: string[] = []
    let checked = 0
    for (const row of ROWS) {
      for (const { file, titles } of attributionsIn(row.verifiedBy)) {
        if (!existsSync(path.join(ROOT, file))) {
          wrong.push(`${row.fr}: ${file} does not exist`)
          continue
        }
        const source = normalise(readFileSync(path.join(ROOT, file), 'utf8'))
        for (const title of titles) {
          checked += 1
          if (!source.includes(normalise(title))) wrong.push(`${row.fr}: "${title}" is not in ${file}`)
        }
      }
    }
    expect(checked, 'the table should cite test titles, not just test files').toBeGreaterThan(25)
    expect(wrong, 'these citations no longer match the tests they name').toEqual([])
  })

  it('cites a test for every verified row, and none for an unimplemented one', () => {
    for (const row of ROWS) {
      const tests = pathsIn(row.verifiedBy).filter((target) => target.endsWith('.spec.ts'))
      if (row.status === 'verified') {
        expect(tests.length, `${row.fr} claims "verified" without a test`).toBeGreaterThan(0)
      }
      if (row.status === 'not implemented') {
        expect(tests.length, `${row.fr} claims to be unimplemented but cites a test`).toBe(0)
        expect(row.implementedIn.trim(), `${row.fr} claims to be unimplemented but names an implementation`).toBe('—')
      }
    }
  })

  it('keeps the summary at the top of the document true', () => {
    // Hand-written counts drift the moment a row changes status. This one is
    // recomputed from the rows, and the same numbers are asserted in the README.
    const counts = ROWS.reduce<Record<Status, number>>(
      (totals, row) => ({ ...totals, [row.status]: totals[row.status] + 1 }),
      { verified: 0, partial: 0, 'not implemented': 0 },
    )
    const summary = `**${counts.verified} verified · ${counts.partial} partial · ${counts['not implemented']} not implemented**`
    expect(DOC, `the summary line should read ${summary}`).toContain(summary)

    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8')
    const claim = readme.match(/(\d+) verified, (\d+) partial, (\d+) not implemented/)
    expect(claim, 'the README describes the coverage table').not.toBeNull()
    expect([Number(claim![1]), Number(claim![2]), Number(claim![3])]).toEqual([
      counts.verified,
      counts.partial,
      counts['not implemented'],
    ])
  })

  it('keeps the unimplemented list short and known', () => {
    const notImplemented = ROWS.filter((row) => row.status === 'not implemented').map((row) => row.fr)
    // Not an aspiration: if this list grows, the product got smaller and the
    // change should be a deliberate one, reviewed rather than discovered.
    expect(notImplemented).toEqual(['FR-34'])
  })

  it('explains the test count it reports', () => {
    const claimed = DOC.match(/Root suites run with `npm test` \((\d+) tests\)/)
    expect(claimed, 'the document should state how many tests it relies on').not.toBeNull()

    // Count the tests the suites actually declare, rather than running them from
    // inside a test run (which vitest cannot do). `it(`/`it.each(`/`test(` are all
    // forms used in this repository; each `it(` is one test per title.
    let declared = 0
    for (const file of [
      'a11y',
      'booking',
      'components',
      'contrast',
      'indexes',
      'links',
      'localBackend',
      'rulesContracts',
      'routes',
      'seedIntegrity',
      'settlement',
      'tokenPolicy',
      'webrtc',
    ]) {
      const source = readFileSync(path.join(ROOT, `tests/unit/${file}.spec.ts`), 'utf8')
      declared += [...source.matchAll(/^\s*it(?:\.each\([^)]*\))?\(\s*['"`]/gm)].length
    }
    // `it.each` declares one call but runs several cases, so the declared count is
    // a lower bound: the documented total must sit just above it. The window is
    // wide enough for the parametrised suites and narrow enough that a stale
    // number (say, one from twenty tests ago) fails.
    expect(
      Number(claimed![1]),
      `the document claims ${claimed![1]} tests but the suites declare at least ${declared}`,
    ).toBeGreaterThanOrEqual(declared)
    expect(
      Number(claimed![1]) - declared,
      'recount the suites and update docs/requirements-coverage.md — this looks stale',
    ).toBeLessThan(60)
  })
})
