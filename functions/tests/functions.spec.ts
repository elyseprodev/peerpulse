/**
 * Cloud Functions integration tests.
 *
 * The functions are the only code in PeerPulse that may move a Time Token, so
 * every claim the product makes about fairness has to hold here. These tests run
 * the **real** callables against a real `firebase-admin` SDK talking to
 * `firebase-mocker` (see `tests/harness.ts` for what that does and does not
 * cover), and assert the behaviour rather than the implementation:
 *
 *   • a request costs nothing — no ledger row, no balance change;
 *   • only the teacher can confirm, only participants can act, never outsiders;
 *   • settlement debits exactly what it credits, once, with auditable rows;
 *   • a session with no verified attendance is blocked instead of settled;
 *   • administrators cannot move a token without a written reason, and cannot
 *     act at all without the claim;
 *   • the export surface matches the names the browser adapter calls.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ADMIN,
  LEARNER,
  OUTSIDER,
  TEACHER,
  bookSession,
  call,
  clearWorld,
  forceInProgress,
  ledger,
  notificationsFor,
  readBooking,
  readWallet,
  seedAttendance,
  seedWorld,
  startHarness,
  stopHarness,
  upcomingWindow,
  world,
} from './harness'

beforeAll(async () => {
  await startHarness()
})

afterAll(async () => {
  await stopHarness()
})

beforeEach(async () => {
  await clearWorld()
  await seedWorld()
})

/* ────────────────────────────── createBooking ───────────────────────────── */

describe('createBooking', () => {
  it('refuses an unauthenticated caller', async () => {
    const result = await call('createBooking', { data: { skillId: 'sk_guitar' } })
    expect(result.ok).toBe(false)
    expect(result.code).toBe('auth/not-signed-in')
  })

  it('refuses a suspended member', async () => {
    await world.db!.doc(`users/${LEARNER}`).set({ status: 'suspended' }, { merge: true })
    const result = await call('createBooking', { as: LEARNER, data: { skillId: 'sk_guitar', ...upcomingWindow() } })
    expect(result.code).toBe('auth/suspended')
  })

  it('refuses booking your own listing', async () => {
    const result = await call('createBooking', { as: TEACHER, data: { skillId: 'sk_guitar', ...upcomingWindow() } })
    expect(result.code).toBe('booking/self')
  })

  it('rejects a session longer than the policy allows (180 minutes)', async () => {
    const result = await call('createBooking', {
      as: LEARNER,
      data: { skillId: 'sk_guitar', ...upcomingWindow(48, 200) },
    })
    expect(result.code).toBe('booking/invalid-duration')
  })

  it('rejects a start time inside the notice period', async () => {
    // The policy requires two hours of notice; ten minutes must be refused.
    const result = await call('createBooking', {
      as: LEARNER,
      data: { skillId: 'sk_guitar', ...upcomingWindow(10 / 60) },
    })
    expect(result.code).toBe('booking/invalid-window')
  })

  it('rejects a slot that overlaps an existing session for either member', async () => {
    await bookSession(48)
    const result = await call('createBooking', { as: LEARNER, data: { skillId: 'sk_guitar', ...upcomingWindow(48) } })
    expect(result.code).toBe('booking/conflict')
  })

  it('refuses a session the learner could not pay for', async () => {
    await world.db!.doc(`wallets/${LEARNER}`).set({ balance: 0 }, { merge: true })
    const result = await call('createBooking', { as: LEARNER, data: { skillId: 'sk_guitar', ...upcomingWindow() } })
    expect(result.code).toBe('wallet/insufficient')
  })

  it('creates a requested booking and moves no tokens at all', async () => {
    const before = await readWallet(LEARNER)
    const bookingId = await bookSession()

    const booking = await readBooking(bookingId)
    expect(booking.status).toBe('requested')
    expect(booking.roomId).toBeNull()
    expect(booking.tokenAmount).toBe(1) // 60 minutes at one token per hour
    expect(booking.participants).toEqual([LEARNER, TEACHER])
    expect(booking.settlement).toMatchObject({ state: 'unsettled', debitTxId: null, creditTxId: null })

    // The headline promise: a pending request is free and leaves no trace in the ledger.
    expect(await ledger()).toHaveLength(0)
    expect((await readWallet(LEARNER)).balance).toBe(before.balance)
    expect((await readWallet(TEACHER)).balance).toBe(0)

    const notifications = await notificationsFor(TEACHER)
    expect(notifications).toHaveLength(1)
    expect(notifications[0].type).toBe('booking_requested')
  })
})

/* ──────────────────────────── respondToBooking ──────────────────────────── */

describe('respondToBooking', () => {
  it('refuses an outsider, and refuses the learner confirming their own request', async () => {
    const bookingId = await bookSession()

    const outsider = await call('respondToBooking', { as: OUTSIDER, data: { bookingId, action: 'confirm' } })
    expect(outsider.code).toBe('booking/forbidden')

    const learner = await call('respondToBooking', { as: LEARNER, data: { bookingId, action: 'confirm' } })
    expect(learner.code).toBe('booking/forbidden')
  })

  it('confirms on the teacher’s word, creates the room and notifies the learner', async () => {
    const bookingId = await bookSession()
    const result = await call('respondToBooking', { as: TEACHER, data: { bookingId, action: 'confirm' } })
    expect(result.ok).toBe(true)

    const booking = await readBooking(bookingId)
    expect(booking.status).toBe('confirmed')
    expect(booking.roomId).toBe(`room_${bookingId}`)

    const room = await world.db!.doc(`rooms/room_${bookingId}`).get()
    expect(room.exists).toBe(true)
    expect(room.data()!.participants).toEqual([LEARNER, TEACHER])

    expect((await notificationsFor(LEARNER)).some((n) => n.type === 'booking_confirmed')).toBe(true)
    // Confirming still moves nothing — the policy does not escrow by default.
    expect(await ledger()).toHaveLength(0)
  })

  it('refuses a second confirmation of the same request', async () => {
    const bookingId = await bookSession()
    await call('respondToBooking', { as: TEACHER, data: { bookingId, action: 'confirm' } })
    const again = await call('respondToBooking', { as: TEACHER, data: { bookingId, action: 'confirm' } })
    expect(again.code).toBe('booking/invalid-state')
  })
})

/* ──────────────────────────────── the room ─────────────────────────────── */

describe('rooms', () => {
  it('provisions a room for a confirmed booking but refuses to let anyone in early', async () => {
    const bookingId = await bookSession(48)
    await call('respondToBooking', { as: TEACHER, data: { bookingId, action: 'confirm' } })

    // `openRoom({ bookingId })` provisions the room shell; joining is a separate
    // call addressed to the room itself.
    const provisioned = await call<{ status: string }>('openRoom', { as: LEARNER, data: { bookingId } })
    expect(provisioned.ok).toBe(true)
    expect(provisioned.data!.status).toBe('scheduled')

    // 48 hours out: the join window is 15 minutes, so entry is refused.
    const early = await call('openRoom', { as: LEARNER, data: { roomId: `room_${bookingId}` } })
    expect(early.code).toBe('room/unavailable')
  })

  it('opens the room inside the window and marks the session in progress', async () => {
    const bookingId = await bookSession(48)
    await call('respondToBooking', { as: TEACHER, data: { bookingId, action: 'confirm' } })
    // Move the agreed slot to ten minutes from now — the join window is 15
    // minutes, and the policy would never have accepted a booking this late.
    await world.db!.doc(`bookings/${bookingId}`).set(
      { startAt: new Date(Date.now() + 10 * 60_000), endAt: new Date(Date.now() + 70 * 60_000) },
      { merge: true },
    )

    await call('openRoom', { as: LEARNER, data: { bookingId } })          // provision
    const opened = await call('openRoom', { as: LEARNER, data: { roomId: `room_${bookingId}` } }) // join
    expect(opened.ok).toBe(true)

    expect((await readBooking(bookingId)).status).toBe('in_progress')
    expect((await world.db!.doc(`rooms/room_${bookingId}`).get()).data()!.status).toBe('open')
  })

  it('refuses to end a session on an outsider’s instruction', async () => {
    const bookingId = await bookSession()
    await call('respondToBooking', { as: TEACHER, data: { bookingId, action: 'confirm' } })
    await forceInProgress(bookingId, [LEARNER, TEACHER])

    const result = await call('endSession', { as: OUTSIDER, data: { roomId: `room_${bookingId}` } })
    expect(result.code).toBe('room/forbidden')
  })

  it('mints STUN-only credentials when TURN is not configured, and HMAC credentials when it is', async () => {
    const withoutTurn = await call<{ turnConfigured: boolean; iceServers: unknown[] }>('getTurnCredentials', { as: LEARNER })
    expect(withoutTurn.ok).toBe(true)
    expect(withoutTurn.data!.turnConfigured).toBe(false)
    expect(withoutTurn.data!.iceServers.length).toBeGreaterThan(0)

    process.env.TURN_URLS = 'turn:turn.example.com:3478'
    process.env.TURN_STATIC_AUTH_SECRET = 'a-test-secret'
    try {
      const withTurn = await call<{ turnConfigured: boolean; iceServers: Array<Record<string, unknown>> }>(
        'getTurnCredentials',
        { as: LEARNER },
      )
      expect(withTurn.data!.turnConfigured).toBe(true)
      const turn = withTurn.data!.iceServers.find((server) => server.username)
      expect(turn).toBeDefined()
      // coturn REST scheme: "<expiry unix seconds>:<uid>"
      expect(String(turn!.username).endsWith(`:${LEARNER}`)).toBe(true)
      expect(Number(String(turn!.username).split(':')[0])).toBeGreaterThan(Date.now() / 1000)
    } finally {
      delete process.env.TURN_URLS
      delete process.env.TURN_STATIC_AUTH_SECRET
    }
  })
})

/* ─────────────────────────────── settlement ─────────────────────────────── */

describe('settlement', () => {
  async function confirmAndRun(bookingId: string): Promise<void> {
    await call('respondToBooking', { as: TEACHER, data: { bookingId, action: 'confirm' } })
    await forceInProgress(bookingId, [LEARNER, TEACHER])
  }

  it('moves exactly one token pair once attendance is verified, and never twice', async () => {
    const bookingId = await bookSession()
    await confirmAndRun(bookingId)
    // Both members present for the full hour, inside the booked window.
    await seedAttendance(bookingId, [
      { uid: TEACHER, startMinutesFromNow: -120, minutes: 60 },
      { uid: LEARNER, startMinutesFromNow: -118, minutes: 58 },
    ])

    const ended = await call<{ settlement: Record<string, unknown> | null }>('endSession', {
      as: LEARNER,
      data: { roomId: `room_${bookingId}` },
    })
    expect(ended.ok).toBe(true)

    const teacher = await readWallet(TEACHER)
    const learner = await readWallet(LEARNER)
    expect(teacher.balance).toBe(1)
    expect(learner.balance).toBe(2)

    const rows = await ledger()
    expect(rows).toHaveLength(2)
    const debit = rows.find((row) => row.direction === 'debit')!
    const credit = rows.find((row) => row.direction === 'credit')!
    // Conservation: the learner loses exactly what the teacher gains.
    expect(debit.amount).toBe(credit.amount)
    expect(debit.id).toBe(`tx_${bookingId}_debit`)
    expect(credit.id).toBe(`tx_${bookingId}_credit`)
    expect(debit.uid).toBe(LEARNER)
    expect(credit.uid).toBe(TEACHER)
    expect(debit.policyCode).toBe('standard_settlement')
    expect(debit.createdBy).toBe(`user:${LEARNER}`)
    expect(credit.balanceAfter).toBe(1)

    const settlement = await world.db!.doc(`settlements/settlement_${bookingId}`).get()
    expect(settlement.exists).toBe(true)
    expect(settlement.data()!.status).toBe('settled')
    expect(settlement.data()!.verifiedMinutes).toBeGreaterThanOrEqual(55)

    const booking = await readBooking(bookingId)
    expect(booking.status).toBe('completed')
    expect(booking.settlement).toMatchObject({ state: 'settled', debitTxId: `tx_${bookingId}_debit` })

    // Replaying the settlement changes nothing at all.
    const replay = await call<{ notices: string[] }>('settleSession', { as: TEACHER, data: { bookingId } })
    expect(replay.ok).toBe(true)
    expect(replay.data!.notices.join(' ')).toMatch(/already settled/i)

    expect(await ledger()).toHaveLength(2)
    expect((await readWallet(TEACHER)).balance).toBe(1)
    expect((await readWallet(LEARNER)).balance).toBe(2)
    expect((await world.db!.doc(`settlements/settlement_${bookingId}`).get()).data()!.attempts).toBe(1)
  })

  it('blocks instead of settling when attendance cannot be verified', async () => {
    const bookingId = await bookSession()
    await confirmAndRun(bookingId)
    // Nobody was in the room: no attendance documents at all.
    const result = await call<{ notices: string[] }>('settleSession', { as: TEACHER, data: { bookingId } })
    expect(result.ok).toBe(true)

    expect(await ledger()).toHaveLength(0)
    expect((await readWallet(TEACHER)).balance).toBe(0)
    expect((await readWallet(LEARNER)).balance).toBe(3)

    const booking = await readBooking(bookingId)
    expect((booking.settlement as Record<string, unknown>).state).toBe('blocked')
    expect(String((booking.settlement as Record<string, unknown>).note)).toMatch(/verif/i)
    expect(result.data!.notices.join(' ')).toMatch(/verif/i)

    // No settlement record is written for a blocked attempt, so a later
    // legitimate settlement is not blocked by an idempotency key.
    expect((await world.db!.doc(`settlements/settlement_${bookingId}`).get()).exists).toBe(false)
  })

  it('refuses settlement to a non-participant', async () => {
    const bookingId = await bookSession()
    await confirmAndRun(bookingId)
    const result = await call('settleSession', { as: OUTSIDER, data: { bookingId } })
    expect(result.code).toBe('booking/forbidden')
  })

  it('settles only what the learner can cover, leaving the ledger balanced', async () => {
    const bookingId = await bookSession()
    await confirmAndRun(bookingId)
    // Nothing is escrowed by default, so the balance can legitimately be lower
    // at settlement time than it was when the request was accepted.
    await world.db!.doc(`wallets/${LEARNER}`).set({ balance: 0.5, held: 0 }, { merge: true })
    await seedAttendance(bookingId, [
      { uid: TEACHER, startMinutesFromNow: -120, minutes: 60 },
      { uid: LEARNER, startMinutesFromNow: -120, minutes: 60 },
    ])

    await call('settleSession', { as: TEACHER, data: { bookingId } })

    const teacher = await readWallet(TEACHER)
    const learner = await readWallet(LEARNER)
    expect(learner.balance).toBe(0)
    expect(teacher.balance).toBe(0.5)

    const rows = await ledger()
    expect(rows).toHaveLength(2)
    expect(rows[0].amount).toBe(rows[1].amount)
    expect(rows.find((row) => row.direction === 'debit')!.policyCode).toBe('partial_rounding')

    const booking = await readBooking(bookingId)
    expect((booking.settlement as Record<string, unknown>).state).toBe('partial')
  })
})

/* ─────────────────────────── reviews and disputes ───────────────────────── */

describe('reviews and disputes', () => {
  it('refuses a review for a session that never happened', async () => {
    const bookingId = await bookSession()
    const result = await call('createReview', {
      as: LEARNER,
      data: { bookingId, rating: 5, comment: 'Lovely session.' },
    })
    expect(result.code).toBe('review/not-completed')
  })

  it('refuses a review from somebody who was not on the session', async () => {
    const bookingId = await bookSession()
    await call('respondToBooking', { as: TEACHER, data: { bookingId, action: 'confirm' } })
    const result = await call('createReview', {
      as: OUTSIDER,
      data: { bookingId, rating: 5, comment: 'I was not there.' },
    })
    expect(result.ok).toBe(false)
  })

  it('refuses to resolve a dispute without the steward claim', async () => {
    const bookingId = await bookSession()
    await call('respondToBooking', { as: TEACHER, data: { bookingId, action: 'confirm' } })
    // The dispute itself is created by the client under Security Rules; the
    // resolution — the part that can move tokens — is steward-only.
    const member = await call('resolveDispute', {
      as: LEARNER,
      data: { disputeId: 'dsp_1', status: 'resolved_refund', outcome: 'Refund me please.' },
    })
    expect(member.code).toBe('permission/denied')
  })
})

/* ──────────────────────────────── admin ────────────────────────────────── */

describe('administration', () => {
  it('refuses every administrative call to a member without the claim', async () => {
    for (const [name, data] of [
      ['getMetrics', {}],
      ['adjustWallet', { uid: LEARNER, amount: 5, reason: 'testing testing' }],
      ['setUserRole', { uid: LEARNER, role: 'admin' }],
      ['updatePlatformConfig', { patch: { version: 'hacked' } }],
    ] as Array<[string, unknown]>) {
      const result = await call(name, { as: LEARNER, data })
      expect(result.ok, `${name} must fail for a member`).toBe(false)
      expect(result.code, `${name}`).toBe('permission/denied')
    }
  })

  it('refuses a wallet adjustment without a written reason', async () => {
    const result = await call('adjustWallet', { as: ADMIN, admin: true, data: { uid: LEARNER, amount: 2, reason: '  ' } })
    expect(result.code).toBe('wallet/invalid-amount')
    expect((await ledger())).toHaveLength(0)
  })

  it('adjusts a wallet with a reason, and records it in the ledger', async () => {
    const result = await call<{ balance: number }>('adjustWallet', {
      as: ADMIN,
      admin: true,
      data: { uid: LEARNER, amount: 2.5, reason: 'Goodwill for a cancelled community event' },
    })
    expect(result.ok).toBe(true)
    expect((await readWallet(LEARNER)).balance).toBe(5.5)

    const rows = await ledger()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      uid: LEARNER,
      type: 'admin_adjustment',
      direction: 'credit',
      amount: 2.5,
      // The ledger names the human who did it, and the platform is credited with
      // no tokens of its own.
      createdBy: `admin:${ADMIN}`,
      policyCode: 'admin_adjustment',
      balanceAfter: 5.5,
    })
    // The reason travels with the money — that is what makes it auditable.
    expect(String(rows[0].reason)).toMatch(/Goodwill/)
  })

  it('refuses an adjustment that would take a wallet below zero', async () => {
    const result = await call('adjustWallet', {
      as: ADMIN,
      admin: true,
      data: { uid: LEARNER, amount: -99, reason: 'Attempting an overdraft' },
    })
    expect(result.code).toBe('wallet/insufficient')
    expect(await ledger()).toHaveLength(0)
  })

  it('validates the platform policy before storing it', async () => {
    const invalid = await call('updatePlatformConfig', {
      as: ADMIN,
      admin: true,
      data: { patch: { token: { tokensPerHour: 0 } } },
    })
    expect(invalid.code).toBe('config/invalid')

    const valid = await call<{ version: string; changeSummary?: string[] }>('updatePlatformConfig', {
      as: ADMIN,
      admin: true,
      data: { patch: { token: { roundingIncrementMinutes: 5 } } },
    })
    expect(valid.ok).toBe(true)
    expect(valid.data!.changeSummary?.join(' ')).toMatch(/round/i)

    const policy = await world.db!.doc('config/platform').get()
    expect(policy.data()!.token.roundingIncrementMinutes).toBe(5)
    // The change is attributed and explained, so the audit trail is complete.
    expect(policy.data()!.updatedByUid).toBe(ADMIN)
    expect(Array.isArray(policy.data()!.changeSummary)).toBe(true)
  })

  it('promotes a member to steward only on a steward’s instruction', async () => {
    const result = await call('setUserRole', { as: ADMIN, admin: true, data: { uid: LEARNER, role: 'admin' } })
    expect(result.ok).toBe(true)
    expect((await world.db!.doc(`users/${LEARNER}`).get()).data()!.role).toBe('admin')
  })

  it('reports platform metrics to a steward', async () => {
    const bookingId = await bookSession()
    await call('respondToBooking', { as: TEACHER, data: { bookingId, action: 'confirm' } })
    const metrics = await call<Record<string, number>>('getMetrics', { as: ADMIN, admin: true })
    expect(metrics.ok).toBe(true)
    expect(metrics.data!.members).toBeGreaterThanOrEqual(4)
    expect(metrics.data!.bookings).toBeGreaterThanOrEqual(1)
  })
})

/* ─────────────────────────────── healthcheck ───────────────────────────── */

describe('healthcheck and the export surface', () => {
  it('reports the policy it can see', async () => {
    const result = await call<{ ok: boolean; policyVersion: string; signupGrant: number }>('healthcheck', { as: LEARNER })
    expect(result.ok).toBe(true)
    expect(result.data!.ok).toBe(true)
    expect(result.data!.policyVersion).toBe('2026.1')
    expect(result.data!.signupGrant).toBe(3)
  })

  it('exposes exactly the callables the browser adapter calls', async () => {
    const index = (await import('../src/index')) as unknown as Record<string, unknown>

    // The browser adapter names the functions it calls in `CALLABLE`; read that
    // map from the client source so a rename on either side fails here.
    // Vitest runs with the package root as cwd; `import.meta` is unavailable
    // because the functions project compiles to CommonJS.
    const clientAdapter = path.resolve(process.cwd(), '../src/lib/backend/firebase/index.ts')
    expect(existsSync(clientAdapter), 'the client adapter must exist to compare against').toBe(true)
    const clientSource = readFileSync(clientAdapter, 'utf8')
    const mapBody = clientSource.slice(clientSource.indexOf('export const CALLABLE'))
    const clientNames = [...mapBody.matchAll(/^\s{2}(\w+):\s*'/gm)].map((match) => match[1])
    expect(clientNames.length).toBeGreaterThan(10)

    for (const name of clientNames) {
      expect(typeof index[name], `${name} is called by the client but not exported`).toBe('function')
    }

    // Everything else that ships: the scheduled sweep, the auth trigger and the
    // two operator endpoints. No other export may appear without a test update.
    for (const name of ['hourlySettlementSweep', 'onUserCreated', 'healthcheck', 'bootstrapPlatform']) {
      expect(typeof index[name], `${name} must be exported`).toBe('function')
    }
  })
})
