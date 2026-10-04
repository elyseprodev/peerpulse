/**
 * Firestore Security Rules: static contracts.
 *
 * **This is a lint, not enforcement.** Rules only execute inside Firestore, and
 * the emulator suite (`tests/rules/firestore.rules.spec.ts`) is the real test —
 * it is written and has never been executed here because the emulator jar cannot
 * be downloaded in this environment (see docs/testing.md §4). Nothing in this
 * file proves that a rule *works*; it proves that the rules file still *says*
 * what the docs claim it says, and that nobody added a client write path without
 * noticing.
 *
 * That is worth having because the rules file is 400 lines of the product's
 * central promise — "no client moves a Time Token" — and until now no test read
 * it at all. A refactor, a merge or a hurried fix could grant `wallets` a write
 * path and every suite in this repository would stay green.
 *
 * What it checks:
 *   1. The collections that must never accept a client write still do not.
 *   2. The set of paths that *do* accept a client write equals the table in
 *      docs/security.md §3 — in both directions, so an undocumented write path
 *      fails, and a documented feature whose rule disappeared also fails.
 *   3. The trust primitives are what everything else assumes: the admin claim
 *      comes from the token, `touchesServerFields()` names the server-owned
 *      profile fields, and there is a catch-all deny.
 *   4. The rules that stop specific abuses are still shaped the way the docs
 *      describe: signalling is addressed to the reader and authored by the
 *      sender, an attendance segment can be closed but never reopened, a client
 *      booking write is limited to the dispute transition, and no rule grants a
 *      write on `request.auth == null`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

interface Allow {
  ops: string[]
  condition: string
}

interface RuleBlock {
  /** `/users/{uid}`, `/rooms/{roomId}/signaling/{messageId}`, … */
  path: string
  allows: Allow[]
  text: string
}

interface Rules {
  source: string
  blocks: RuleBlock[]
  functions: Map<string, string>
}

function parseRules(source: string): Rules {
  const lines = source.split('\n')
  const blocks: RuleBlock[] = []
  const functions = new Map<string, string>()
  const stack: Array<{ path: string; start: number; indent: number }> = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const indent = line.match(/^\s*/)?.[0].length ?? 0

    const fn = line.match(/^\s*function\s+([A-Za-z0-9_]+)\s*\(/)
    if (fn) {
      // Capture the whole function body (it ends at the first line that is a lone `}`).
      const body: string[] = [line]
      for (let i = index + 1; i < lines.length; i += 1) {
        body.push(lines[i])
        if (/^\s*\}\s*$/.test(lines[i])) break
      }
      functions.set(fn[1], body.join('\n'))
      continue
    }

    const match = line.match(/^\s*match\s+(\S+)\s*\{\s*$/)
    if (match) {
      stack.push({ path: match[1], start: index, indent })
      continue
    }

    if (/^\s*\}\s*$/.test(line) && stack.length) {
      const open = stack.pop()!
      const prefix = stack.map((entry) => entry.path).join('')
      const fullPath = `${prefix}${open.path}`
      const blockLines = lines.slice(open.start, index + 1)
      blocks.push({ path: fullPath, allows: parseAllows(blockLines), text: blockLines.join('\n') })
    }
  }

  return { source, blocks, functions }
}

/**
 * `allow` statements that belong to *this* block, not to a nested one. Statements
 * are routinely several lines long, so they are buffered until the closing `;`.
 */
function parseAllows(blockLines: string[]): Allow[] {
  const allows: Allow[] = []
  let depth = 0
  let buffer: string | null = null
  // Skip the opening `match … {` line: it is this block's own header, not a nested block.
  for (const line of blockLines.slice(1)) {
    // Rules carry trailing `//` comments; they are not part of the statement and
    // would otherwise stop it from looking terminated.
    const trimmed = line.split('//')[0].trim()
    if (!trimmed && buffer === null) continue

    if (buffer === null) {
      if (/^match\s/.test(trimmed)) {
        depth += 1
        continue
      }
      if (trimmed === '}' || trimmed === '};') {
        if (depth > 0) depth -= 1
        continue
      }
      if (depth > 0) continue
      if (!/^allow\s/.test(trimmed)) continue
      buffer = trimmed
    } else {
      // A statement that wrapped onto the next line.
      buffer += ` ${trimmed}`
    }

    if (!buffer.endsWith(';')) continue
    const allow = buffer.replace(/\s+/g, ' ').match(/^allow\s+([a-z,\s]+):\s*if\s+(.+);$/)
    if (allow) {
      allows.push({
        ops: allow[1].split(',').map((op) => op.trim()).filter(Boolean),
        condition: allow[2].trim(),
      })
    }
    buffer = null
  }
  return allows
}

const source = readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8')
const rules = parseRules(source)

/** `/skills/{skillId}` and the docs' `skills/{id}` → `skills/{*}`. */
function canonical(path: string): string {
  return path.replace(/^\//, '').replace(/\{[^}]+\}/g, '{*}')
}

/** Every path whose rules let a client write, with the operations allowed. */
function clientWritePaths(): Map<string, string[]> {
  const writes = new Map<string, string[]>()
  for (const candidate of rules.blocks) {
    const granted = candidate.allows
      .filter((allow) => allow.condition !== 'false')
      .flatMap((allow) => allow.ops)
      .filter((op) => op !== 'read')
    if (granted.length) writes.set(canonical(candidate.path), [...new Set(granted)].sort())
  }
  return writes
}

/** The client write surface as documented in docs/security.md §3. */
function documentedWritePaths(): Set<string> {
  const docs = readFileSync(path.resolve(process.cwd(), 'docs/security.md'), 'utf8')
  const lines = docs.split('\n')
  const start = lines.findIndex((line) => /^## 3\./.test(line))
  const end = lines.findIndex((line, index) => index > start && /^## 4\./.test(line))
  expect(start, 'docs/security.md should still have a §3').toBeGreaterThan(-1)
  expect(end, 'docs/security.md §3 should end where §4 begins').toBeGreaterThan(start)

  const paths = new Set<string>()
  for (const line of lines.slice(start, end)) {
    const first = line.match(/^\|\s*`([^`]+)`\s*\|/)
    if (first) paths.add(canonical(first[1].trim()))
  }
  expect(paths.size, 'the write-surface table in docs/security.md §3 should list the paths').toBeGreaterThan(10)
  return paths
}

/** The one statement of `path_` that grants `op` to a client (never `if false`). */
function grant(path_: string, op: string): Allow {
  const found = block(path_).allows.find((allow) => allow.ops.includes(op) && allow.condition !== 'false')
  expect(found, `${path_} should grant "${op}" to a client`).toBeDefined()
  return found!
}

/** The operations `path_` actually grants a client (statements guarded by `if false` do not count). */
function clientOps(path_: string): string[] {
  return [
    ...new Set(
      block(path_)
        .allows.filter((allow) => allow.condition !== 'false')
        .flatMap((allow) => allow.ops),
    ),
  ].sort()
}

function block(path_: string): RuleBlock {
  const found = rules.blocks.find((candidate) => canonical(candidate.path) === canonical(path_))
  expect(found, `no match block for ${path_} in firestore.rules`).toBeDefined()
  return found!
}

describe('rules: the money is untouchable from a client', () => {
  const FORBIDDEN_WRITES = [
    '/wallets/{uid}',
    '/tokenTransactions/{transactionId}',
    '/settlements/{settlementId}',
    '/config/{document}',
    '/rooms/{roomId}',
    '/users/{uid}/wallets/{document}',
    '/bookings/{bookingId}/settlements/{document}',
  ]

  it.each(FORBIDDEN_WRITES)('grants no write to %s', (path_) => {
    const found = rules.blocks.find((candidate) => canonical(candidate.path) === canonical(path_))
    if (!found) return // no block at all: the catch-all at the bottom of the file denies it
    const writes = found!.allows.filter((allow) => allow.ops.some((op) => op !== 'read'))
    for (const allow of writes) {
      expect(allow.condition, `${path_} grants "${allow.ops.join(', ')}" when ${allow.condition}`).toBe('false')
    }
  })

  it('keeps every wallet balance and ledger row writable only by the Admin SDK', () => {
    // The Admin SDK bypasses rules entirely, so the strongest statement a rules
    // file can make is that there is no client path at all — not even for admins.
    for (const path_ of ['/wallets/{uid}', '/tokenTransactions/{transactionId}', '/settlements/{settlementId}']) {
      const found = block(path_)
      expect(found.text, `${path_} should be readable but never writable by a client`).toMatch(/allow\s+write:\s*if\s+false/)
      expect(found.text, `${path_} must not even let an administrator write`).not.toMatch(/isAdmin\(\)\s*$/m)
    }
  })
})

describe('rules: the client write surface matches the documentation', () => {
  it('grants client writes to exactly the documented paths', () => {
    const granted = [...clientWritePaths().keys()].sort()
    const documented = [...documentedWritePaths()].sort()

    const undocumented = granted.filter((path_) => !documented.includes(path_))
    expect(
      undocumented,
      'These paths accept a client write but are not in docs/security.md §4. Either remove the rule or document it — ' +
        'an undocumented write path is how a rule audit goes wrong.',
    ).toEqual([])

    const missing = documented.filter((path_) => !granted.includes(path_))
    expect(
      missing,
      'docs/security.md §4 promises a client write that firestore.rules does not grant: the documented feature is broken.',
    ).toEqual([])
  })

  it('records the granted operations, so a widened rule is a visible change', () => {
    const granted = clientWritePaths()
    expect(Object.fromEntries([...granted.entries()].sort())).toEqual({
      'bookings/{*}': ['update'],
      'communities/{*}': ['create', 'update'],
      'communities/{*}/members/{*}': ['create', 'delete', 'update'],
      'disputes/{*}': ['create'],
      'notifications/{*}': ['update'],
      'posts/{*}': ['create', 'update'],
      'posts/{*}/comments/{*}': ['create', 'update'],
      'reports/{*}': ['create'],
      'reviews/{*}': ['update'],
      'rooms/{*}/attendance/{*}': ['create', 'update'],
      // The `delete`/`update` on the two WebRTC subcollections are the only
      // administrator writes in the client surface: housekeeping of stale
      // signalling rows. Nobody, administrator included, can write a wallet,
      // a ledger row, a settlement or a booking from a client.
      'rooms/{*}/candidates/{*}': ['create', 'delete', 'update'],
      'rooms/{*}/presence/{*}': ['create', 'delete', 'update'],
      'rooms/{*}/signaling/{*}': ['create', 'delete', 'update'],
      'skills/{*}': ['create', 'update'],
      'users/{*}': ['create', 'update'],
    })
    // Nothing else: no collection may quietly gain a delete, and no new
    // collection may appear without this expectation and the docs changing.
  })
})

describe('rules: the administrator surface', () => {
  /**
   * `isAdmin()` reads a custom claim that only `setUserRole` can mint, so this
   * is not a hole — but it is the part of the write surface that a code review
   * is least likely to look at, and it is worth pinning. The list is derived from
   * every `allow` whose condition mentions `isAdmin()`.
   */
  function adminSurface(ops: (op: string) => boolean) {
    const surface: Array<[string, string[]]> = []
    for (const candidate of rules.blocks) {
      const granted = candidate.allows
        .filter((allow) => allow.condition !== 'false' && allow.condition.includes('isAdmin()'))
        .flatMap((allow) => allow.ops)
        .filter(ops)
      if (granted.length) surface.push([canonical(candidate.path), [...new Set(granted)].sort()])
    }
    return Object.fromEntries(surface.sort())
  }

  it('lets an administrator write only these five things from a client', () => {
    expect(adminSurface((op) => op !== 'read')).toEqual({
      'communities/{*}': ['update'],
      'communities/{*}/members/{*}': ['delete'],
      'rooms/{*}/candidates/{*}': ['delete', 'update'],
      'rooms/{*}/signaling/{*}': ['delete', 'update'],
      'skills/{*}': ['update'],
    })
  })

  it('gives an administrator no client write to any token-bearing collection', () => {
    const writes = Object.keys(adminSurface((op) => op !== 'read'))
    for (const forbidden of ['wallets', 'tokenTransactions', 'settlements', 'bookings']) {
      expect(
        writes.some((path_) => path_.startsWith(`${forbidden}/`)),
        `an administrator must not be able to write ${forbidden} from a client either: tokens move only in Cloud Functions`,
      ).toBe(false)
    }
  })
})

describe('rules: the trust primitives', () => {
  it('reads the administrator claim from the token, never from a document', () => {
    const isAdmin = rules.functions.get('isAdmin')
    expect(isAdmin, 'isAdmin() should exist').toBeDefined()
    expect(isAdmin).toMatch(/request\.auth\.token\.admin\s*==\s*true/)
    expect(isAdmin, 'the claim must not be read from Firestore: a user document is client-writable in part').not.toMatch(
      /get\(/,
    )
  })

  it('names the server-owned profile fields', () => {
    const touches = rules.functions.get('touchesServerFields')
    expect(touches, 'touchesServerFields() should exist').toBeDefined()
    for (const field of ['role', 'status', 'stats', 'uid', 'email']) {
      expect(touches, `${field} should be server-owned`).toContain(`'${field}'`)
    }
  })

  it('ends with a catch-all deny', () => {
    expect(source).toMatch(/match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;/)
  })

  it('never grants an unconditional write, and never writes without a signed-in caller', () => {
    for (const candidate of rules.blocks) {
      for (const allow of candidate.allows) {
        const writes = allow.ops.filter((op) => op !== 'read')
        if (!writes.length || allow.condition === 'false') continue
        if (candidate.path === '/databases/{database}/documents') continue
        // `config` is a deliberate, documented exception: world-readable, never writable.
        expect(allow.condition, `${candidate.path} grants a write without any condition`).not.toBe('true')
        expect(
          /request\.auth|signedIn\(\)|isSelf\(|isAdmin\(\)|isRoomParticipant\(|isCommunity|get\(/.test(allow.condition),
          `${candidate.path} grants "${writes.join(', ')}" without checking who is calling: ${allow.condition}`,
        ).toBe(true)
      }
    }
  })
})

describe('rules: the specific abuses the docs promise to stop', () => {
  it('addresses signalling to its reader and authors it as the sender', () => {
    const signaling = '/rooms/{roomId}/signaling/{messageId}'
    expect(grant(signaling, 'read').condition, 'a member may only read envelopes addressed to them').toMatch(
      /isRoomParticipant\(roomId\)\s*&&\s*resource\.data\.to\s*==\s*request\.auth\.uid/,
    )
    const create = grant(signaling, 'create').condition
    expect(create, 'an envelope must be authored by the caller').toMatch(
      /request\.resource\.data\.from\s*==\s*request\.auth\.uid/,
    )
    expect(create, 'the recipient must be a participant of the room').toMatch(
      /request\.resource\.data\.to\s+in\s+room\(roomId\)\.participants/,
    )
    expect(create, 'the sequence must be an integer, so ordering cannot be forged').toMatch(
      /request\.resource\.data\.sequence\s+is\s+int/,
    )
    expect(create, 'only the four signalling kinds exist').toMatch(
      /kind\s+in\s+\['offer',\s*'answer',\s*'renegotiate',\s*'bye'\]/,
    )

    const candidates = '/rooms/{roomId}/candidates/{candidateId}'
    expect(grant(candidates, 'read').condition).toMatch(/resource\.data\.to\s*==\s*request\.auth\.uid/)
    expect(grant(candidates, 'create').condition).toMatch(
      /request\.resource\.data\.from\s*==\s*request\.auth\.uid/,
    )
  })

  it('lets a member close their own attendance segment but never reopen one', () => {
    const attendance = '/rooms/{roomId}/attendance/{segmentId}'
    const create = grant(attendance, 'create').condition
    expect(create, 'a segment opens for the caller only').toMatch(/request\.resource\.data\.uid\s*==\s*request\.auth\.uid/)
    expect(create, 'and it must open open — no back-dating a closed segment').toMatch(
      /request\.resource\.data\.leftAt\s*==\s*null/,
    )

    const update = grant(attendance, 'update').condition
    expect(update, 'only the owner may close a segment').toMatch(/resource\.data\.uid\s*==\s*request\.auth\.uid/)
    expect(update, 'only closing fields may change').toMatch(/hasOnly\(\['leftAt',\s*'closedByClient'\]\)/)
    expect(update, 'and only an open segment may be closed, so it cannot be reopened or rewritten').toMatch(
      /resource\.data\.leftAt\s*==\s*null/,
    )

    expect(clientOps(attendance), 'segments are never deleted, by anyone, from a client').not.toContain('delete')
  })

  it('limits a client booking write to the dispute transition', () => {
    const bookings = block('/bookings/{bookingId}')
    const update = bookings.allows.find((allow) => allow.ops.includes('update'))
    expect(update, 'bookings should allow exactly one client update').toBeDefined()
    expect(update!.condition, 'only the status/updatedAt pair may move').toMatch(/hasOnly\(\['status',\s*'updatedAt'\]\)/)
    expect(update!.condition, "and only to 'disputed'").toMatch(/status\s*==\s*'disputed'/)
    expect(update!.condition, 'from a state that can be disputed').toMatch(/in\s+\[/)
    expect(update!.condition, 'and only by a participant').toMatch(/request\.auth\.uid\s+in\s+resource\.data\.participants/)
    expect(
      bookings.allows.some((allow) => allow.ops.includes('create') && allow.condition !== 'false'),
      'bookings are created by createBooking, never by a client',
    ).toBe(false)
  })

  it('keeps presence, memberships and reports tied to the caller', () => {
    const presence = '/rooms/{roomId}/presence/{uid}'
    for (const op of ['create', 'update', 'delete']) {
      expect(grant(presence, op).condition, `presence ${op} must be the caller's own document`).toMatch(
        /isSelf\(uid\)/,
      )
    }

    const membership = '/communities/{communityId}/members/{uid}'
    expect(grant(membership, 'create').condition, 'you may only join as yourself').toMatch(/isSelf\(uid\)/)
    const leave = grant(membership, 'update').condition
    expect(leave, 'and only change your own row').toMatch(/isSelf\(uid\)/)
    expect(leave, 'and only your own display fields').toMatch(/hasOnly\(\['leftAt',\s*'displayName',\s*'avatarSeed'\]\)/)

    const reports = '/reports/{reportId}'
    const report = grant(reports, 'create').condition
    expect(report, 'a report is filed as yourself').toMatch(/request\.resource\.data\.reporterUid\s*==\s*request\.auth\.uid/)
    expect(report, 'it starts open and unhandled').toMatch(/status\s*==\s*'open'/)
    expect(report, 'a client cannot mark its own report handled').toMatch(/handledByUid\s*==\s*null/)
    for (const op of ['update', 'delete']) {
      expect(
        block(reports).allows.filter((allow) => allow.ops.includes(op) && allow.condition !== 'false'),
        `a client may never ${op} a report`,
      ).toEqual([])
    }
  })

  it('requires a dispute to be about a booking the caller is part of', () => {
    const disputes = '/disputes/{disputeId}'
    const open = grant(disputes, 'create').condition
    expect(open, 'a caller may only open their own dispute').toMatch(
      /request\.resource\.data\.openedByUid\s*==\s*request\.auth\.uid/,
    )
    expect(open, 'and only about a booking they are part of').toMatch(/in\s+get\(.*bookings.*\)\.data\.participants/)
    expect(open, 'and it must start open').toMatch(/status\s*==\s*'open'/)
    for (const op of ['update', 'delete']) {
      expect(
        block(disputes).allows.filter((allow) => allow.ops.includes(op) && allow.condition !== 'false'),
        `only a steward may ${op} a dispute, through resolveDispute`,
      ).toEqual([])
    }
  })

  it('lets only the subject of a review reply to it', () => {
    const reviews = block('/reviews/{reviewId}')
    const update = reviews.allows.find((allow) => allow.ops.includes('update'))
    expect(update).toBeDefined()
    expect(update!.condition).toMatch(/resource\.data\.subjectUid\s*==\s*request\.auth\.uid/)
    expect(update!.condition, 'the reply fields and nothing else').toMatch(/hasOnly\(\['responseText',\s*'responseAt'\]\)/)
    expect(reviews.allows.some((allow) => allow.ops.includes('create') && allow.condition !== 'false')).toBe(false)
  })
})
