import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalBackend } from '@/lib/backend/local'
import { isBackendError, type AuthSession } from '@/lib/backend/types'
import { computeTokenAmount, DEFAULT_PLATFORM_CONFIG } from '@shared'
import type { Booking, SkillListing } from '@shared/domain'

/**
 * End-to-end exercise of the reference backend.
 *
 * It runs the *same* shared domain modules the Cloud Functions run, so these
 * assertions describe the server contract too: who may move tokens, when, and
 * with what evidence. Fake timers are essential — booking rules enforce a
 * minimum notice window and settlement refuses to run before the session ends.
 */

let backend: LocalBackend
const EMAILS = {
  demo_sam: 'sam@peerpulse.app',
  demo_lena: 'lena@peerpulse.app',
  demo_jonas: 'jonas@peerpulse.app',
  demo_admin: 'admin@peerpulse.app',
} as const

type DemoUid = keyof typeof EMAILS

async function freshBackend(): Promise<LocalBackend> {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-10T09:00:00.000Z'))
  localStorage.clear()
  backend = new LocalBackend()
  await backend.init()
  return backend
}

async function signInAs(uid: DemoUid): Promise<AuthSession> {
  const session = await backend.signIn(EMAILS[uid], 'peerpulse')
  expect(session.uid).toBe(uid)
  return session
}

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

/** Resolve a seeded listing by its owner instead of hard-coding generated ids. */
async function skillOwnedBy(ownerUid: string, index = 0): Promise<SkillListing> {
  const listings = await backend.listSkills({ ownerUid })
  const listing = listings[index]
  expect(listing).toBeDefined()
  return listing
}

let teaching: SkillListing

/** Create a booking that satisfies the minimum-notice rule. */
async function requestBooking(startInMinutes = 180, durationMinutes?: number): Promise<Booking> {
  const minutes = durationMinutes ?? teaching.durationMinutes
  const startAt = minutesFromNow(startInMinutes)
  const endAt = new Date(Date.parse(startAt) + minutes * 60_000).toISOString()
  return backend.createBooking({
    skillId: teaching.id,
    startAt,
    endAt,
    timezone: 'UTC',
    learnerNote: 'Looking forward to practising.',
  })
}

const expectedTokens = () => computeTokenAmount(teaching.durationMinutes, DEFAULT_PLATFORM_CONFIG)

beforeEach(async () => {
  await freshBackend()
  await signInAs('demo_sam')
  teaching = await skillOwnedBy('demo_lena')
})

describe('local backend: authentication and profile', () => {
  it('starts signed out and rejects bad credentials', async () => {
    await backend.signOut()
    expect(backend.getSession()).toBeNull()
    await expect(backend.signIn('sam@peerpulse.app', 'wrong-password')).rejects.toSatisfy(isBackendError)
  })

  it('signs the demo member in and exposes the session', async () => {
    expect(backend.getSession()?.displayName).toBeTruthy()
    expect(backend.getSession()?.demo).toBe(true)
  })

  it('creates a wallet that is consistent with the member ledger', async () => {
    const wallet = await backend.getWallet('demo_sam')
    const ledger = await backend.listTransactions('demo_sam', { limit: 200 })

    expect(wallet.uid).toBe('demo_sam')
    expect(wallet.balance).toBeGreaterThan(0)
    expect(wallet.policyVersion).toBe(DEFAULT_PLATFORM_CONFIG.version)

    // Every posted row is auditable: it names an actor, a reason and a policy.
    expect(ledger.length).toBeGreaterThan(0)
    for (const tx of ledger) {
      expect(tx.createdBy).toBeTruthy()
      expect(tx.reason).toBeTruthy()
      expect(tx.idempotencyKey).toBe(tx.id)
      expect(tx.balanceAfter).toBeGreaterThanOrEqual(0)
    }

    const credits = ledger.filter((tx) => tx.direction === 'credit').reduce((sum, tx) => sum + tx.amount, 0)
    const debits = ledger.filter((tx) => tx.direction === 'debit').reduce((sum, tx) => sum + tx.amount, 0)
    expect(wallet.lifetimeGranted + wallet.lifetimeEarned).toBeCloseTo(credits + wallet.held * 0, 5)
    expect(wallet.lifetimeSpent).toBeCloseTo(debits, 5)
  })

  it('refuses to let a member promote themselves', async () => {
    await expect(backend.setUserRole('demo_sam', 'admin')).rejects.toMatchObject({ code: 'permission/denied' })
  })

  it('lets an admin promote another member', async () => {
    await signInAs('demo_admin')
    const updated = await backend.setUserRole('demo_jonas', 'admin')
    expect(updated.role).toBe('admin')
  })

  it('strips server-owned fields from a self-service profile update', async () => {
    const before = await backend.getUser('demo_sam')
    const updated = await backend.saveProfile('demo_sam', {
      headline: 'Learning in public',
      role: 'admin',
      status: 'suspended',
    } as never)
    expect(updated.headline).toBe('Learning in public')
    expect(updated.role).toBe(before?.role)
    expect(updated.status).toBe(before?.status)
  })
})

describe('local backend: booking lifecycle', () => {
  it('rejects a session shorter than the minimum duration', async () => {
    const startAt = minutesFromNow(180)
    await expect(
      backend.createBooking({
        skillId: teaching.id,
        startAt,
        endAt: new Date(Date.parse(startAt) + 5 * 60_000).toISOString(),
        timezone: 'UTC',
        learnerNote: '',
      }),
    ).rejects.toMatchObject({ code: 'booking/invalid-duration' })
  })

  it('rejects a session booked with too little notice', async () => {
    await expect(requestBooking(30)).rejects.toMatchObject({ code: 'booking/invalid-window' })
  })

  it('creates a requested booking without moving any tokens', async () => {
    const before = await backend.getWallet('demo_sam')
    const booking = await requestBooking()

    expect(booking.status).toBe('requested')
    expect(booking.tokenAmount).toBe(expectedTokens())
    expect(booking.settlement.state).toBe('unsettled')
    expect(booking.roomId).toBeNull()

    const after = await backend.getWallet('demo_sam')
    expect(after.balance).toBe(before.balance)
    expect(after.held).toBe(0)
    expect(await backend.listTransactions('demo_sam', { bookingId: booking.id })).toHaveLength(0)
  })

  it('lets only the teacher confirm, and opens a room when they do', async () => {
    const booking = await requestBooking()
    await expect(backend.confirmBooking(booking.id)).rejects.toMatchObject({ code: 'booking/forbidden' })

    await signInAs('demo_lena')
    const confirmed = await backend.confirmBooking(booking.id)
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.roomId).toBe(`room_${booking.id}`)
    expect(await backend.getRoomForBooking(booking.id)).not.toBeNull()
  })

  it('rejects a second booking that overlaps the same teacher', async () => {
    const first = await requestBooking(180)
    await signInAs('demo_jonas')
    const startAt = new Date(Date.parse(first.startAt) + 15 * 60_000).toISOString()
    await expect(
      backend.createBooking({
        skillId: teaching.id,
        startAt,
        endAt: new Date(Date.parse(startAt) + 60 * 60_000).toISOString(),
        timezone: 'UTC',
        learnerNote: '',
      }),
    ).rejects.toMatchObject({ code: 'booking/conflict' })
  })

  it('lets only the teacher decline, and moves no tokens when they do', async () => {
    const booking = await requestBooking()
    await expect(backend.declineBooking(booking.id, 'Not available that day.')).rejects.toMatchObject({
      code: 'booking/forbidden',
    })

    await signInAs('demo_lena')
    const declined = await backend.declineBooking(booking.id, 'Not available that day.')
    expect(declined.status).toBe('declined')
    expect(declined.settlement.state).toBe('unsettled')
  })
})

describe('local backend: rooms, attendance and settlement', () => {
  async function confirmedBooking(): Promise<Booking> {
    const booking = await requestBooking(180)
    await signInAs('demo_lena')
    return backend.confirmBooking(booking.id)
  }

  async function joinRoom(booking: Booking, uids: DemoUid[]): Promise<void> {
    for (const uid of uids) {
      await signInAs(uid)
      await backend.registerPresence(booking.roomId!, uid, { camera: true, microphone: true, screen: false })
    }
    await signInAs(uids[0])
    await backend.startSession(booking.roomId!, uids[0])
  }

  it('keeps the room invisible and closed to outsiders', async () => {
    const booking = await confirmedBooking()
    await signInAs('demo_jonas')
    expect(await backend.getRoom(`room_${booking.id}`)).toBeNull()
    await expect(backend.ensureRoom(booking.id)).rejects.toMatchObject({ code: 'booking/forbidden' })
    expect(await backend.listPresence(booking.roomId!)).toHaveLength(0)
  })

  it('opens the room for both participants and records attendance', async () => {
    const booking = await confirmedBooking()
    const roomId = booking.roomId!
    await signInAs('demo_lena')
    const room = await backend.ensureRoom(booking.id)
    expect(room.id).toBe(roomId)
    expect([...room.participants].sort()).toEqual(['demo_lena', 'demo_sam'])

    await joinRoom(booking, ['demo_lena', 'demo_sam'])

    const presence = await backend.listPresence(roomId)
    expect(presence).toHaveLength(2)
    expect(presence.map((p) => p.uid).sort()).toEqual(['demo_lena', 'demo_sam'])
    const attendance = (await backend.getRoom(roomId))?.session.startedAt
    expect(attendance).toBeTruthy()
  })

  it('settles the agreed tokens after a verified session, and never twice', async () => {
    const booking = await confirmedBooking()
    const roomId = booking.roomId!
    const amount = expectedTokens()
    const teacherBefore = await backend.getWallet('demo_lena')
    const learnerBefore = await backend.getWallet('demo_sam')

    await joinRoom(booking, ['demo_lena', 'demo_sam'])

    vi.setSystemTime(new Date(Date.parse(booking.endAt) + 60_000))
    await signInAs('demo_sam')
    const result = await backend.endSession(roomId, 'demo_sam')

    expect(result.booking.status).toBe('completed')
    expect(result.booking.settlement.state).toBe('settled')
    expect(result.settlement?.id).toBe(`settlement_${booking.id}`)
    expect(result.settlement?.verifiedMinutes).toBeGreaterThanOrEqual(booking.durationMinutes - 5)

    const teacherAfter = await backend.getWallet('demo_lena')
    const learnerAfter = await backend.getWallet('demo_sam')
    expect(teacherAfter.balance - teacherBefore.balance).toBeCloseTo(amount, 5)
    expect(learnerBefore.balance - learnerAfter.balance).toBeCloseTo(amount, 5)

    const ledger = await backend.listTransactions('demo_sam', { bookingId: booking.id })
    expect(ledger).toHaveLength(1)
    expect(ledger[0].id).toBe(`tx_${booking.id}_debit`)
    expect(ledger[0].amount).toBeCloseTo(amount, 5)
    expect(ledger[0].balanceAfter).toBeCloseTo(learnerAfter.balance, 5)

    // Replaying settlement is a no-op: same balances, same single ledger row.
    const replay = await backend.requestSettlement(booking.id)
    expect(replay.notices.join(' ')).toContain('already settled')
    expect((await backend.getWallet('demo_sam')).balance).toBeCloseTo(learnerAfter.balance, 5)
    expect(await backend.listTransactions('demo_sam', { bookingId: booking.id })).toHaveLength(1)
  })

  it('maintains the denormalised counters the dashboards and cards read', async () => {
    // Booked → the listing counts a request; nobody has a completed session yet.
    const booking = await requestBooking(180)
    expect((await skillOwnedBy('demo_lena')).bookingCount).toBe(teaching.bookingCount + 1)

    const teacherBefore = (await backend.getUser('demo_lena'))!
    const learnerBefore = (await backend.getUser('demo_sam'))!
    const listing = await skillOwnedBy('demo_lena')

    await signInAs('demo_lena')
    const confirmed = await backend.confirmBooking(booking.id)
    await joinRoom(confirmed, ['demo_lena', 'demo_sam'])
    vi.setSystemTime(new Date(Date.parse(booking.endAt) + 60_000))
    await signInAs('demo_sam')
    const result = await backend.endSession(confirmed.roomId!, 'demo_sam')
    const amount = result.settlement!.tokenAmount
    const hours = booking.durationMinutes / 60

    const teacherAfter = (await backend.getUser('demo_lena'))!
    const learnerAfter = (await backend.getUser('demo_sam'))!
    expect(teacherAfter.stats.sessionsCompleted).toBe(teacherBefore.stats.sessionsCompleted + 1)
    expect(teacherAfter.stats.sessionsTaught).toBe(teacherBefore.stats.sessionsTaught + 1)
    expect(teacherAfter.stats.teachingHours).toBeCloseTo(teacherBefore.stats.teachingHours + hours, 4)
    expect(teacherAfter.stats.tokensEarned).toBeCloseTo(teacherBefore.stats.tokensEarned + amount, 4)
    expect(learnerAfter.stats.sessionsCompleted).toBe(learnerBefore.stats.sessionsCompleted + 1)
    expect(learnerAfter.stats.learningHours).toBeCloseTo(learnerBefore.stats.learningHours + hours, 4)
    expect(learnerAfter.stats.tokensSpent).toBeCloseTo(learnerBefore.stats.tokensSpent + amount, 5)

    // A settled session counts on the listing; a name is not one of its fields.
    expect((await skillOwnedBy('demo_lena')).completedCount).toBe(listing.completedCount + 1)
    expect(teacherAfter.stats.sessionsTaught).toBeGreaterThan(teacherBefore.stats.sessionsTaught)
  })

  it('does not count a session that was blocked for missing attendance', async () => {
    const booking = await confirmedBooking()
    const teacherBefore = (await backend.getUser('demo_lena'))!
    const listing = await skillOwnedBy('demo_lena')

    await joinRoom(booking, ['demo_lena'])
    vi.setSystemTime(new Date(Date.parse(booking.endAt) + 60_000))
    await backend.endSession(booking.roomId!, 'demo_lena')

    const teacherAfter = (await backend.getUser('demo_lena'))!
    expect(teacherAfter.stats.sessionsTaught).toBe(teacherBefore.stats.sessionsTaught)
    expect(teacherAfter.stats.teachingHours).toBeCloseTo(teacherBefore.stats.teachingHours, 5)
    expect((await skillOwnedBy('demo_lena')).completedCount).toBe(listing.completedCount)
  })

  it('counts a review once, under the field names the UI reads', async () => {
    const booking = await confirmedBooking()
    const listingBefore = await skillOwnedBy('demo_lena')
    const subjectBefore = (await backend.getUser('demo_lena'))!

    await joinRoom(booking, ['demo_lena', 'demo_sam'])
    vi.setSystemTime(new Date(Date.parse(booking.endAt) + 60_000))
    await backend.endSession(booking.roomId!, 'demo_sam')

    await signInAs('demo_sam')
    await backend.createReview({ bookingId: booking.id, authorUid: 'demo_sam', rating: 4, comment: 'Clear and patient.', tags: [] })

    const subjectAfter = (await backend.getUser('demo_lena'))!
    const listingAfter = await skillOwnedBy('demo_lena')
    expect(subjectAfter.stats.reviewCount).toBe(subjectBefore.stats.reviewCount + 1)
    expect(subjectAfter.stats.ratingSum).toBeCloseTo(subjectBefore.stats.ratingSum + 4, 5)
    expect(listingAfter.reviewCount).toBe(listingBefore.reviewCount + 1)
    expect(listingAfter.ratingSum).toBeCloseTo(listingBefore.ratingSum + 4, 5)
  })

  it('refuses to settle a session nobody attended together', async () => {
    const booking = await confirmedBooking()
    const roomId = booking.roomId!
    const learnerBefore = await backend.getWallet('demo_sam')

    await joinRoom(booking, ['demo_lena'])

    vi.setSystemTime(new Date(Date.parse(booking.endAt) + 60_000))
    const result = await backend.endSession(roomId, 'demo_lena')

    expect(result.settlement).toBeNull()
    expect(result.notices.join(' ')).toMatch(/verified attendance|attendance/i)
    expect(result.booking.settlement.state).toBe('blocked')
    expect((await backend.getWallet('demo_sam')).balance).toBeCloseTo(learnerBefore.balance, 5)
  })

  it('records a cancellation with its policy code and leaves balances untouched', async () => {
    const booking = await confirmedBooking()
    const before = await backend.getWallet('demo_sam')
    const cancelled = await backend.cancelBooking(booking.id, 'Something came up.')

    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.cancellation?.policyCode).toBeTruthy()
    // Nothing was escrowed under the default policy, so no phantom refund appears.
    expect((await backend.getWallet('demo_sam')).balance).toBeCloseTo(before.balance, 5)
    expect(await backend.listTransactions('demo_sam', { bookingId: booking.id })).toHaveLength(0)
  })

  it('only allows reviews after a completed session', async () => {
    const booking = await requestBooking(180)
    await expect(
      backend.createReview({ bookingId: booking.id, authorUid: 'demo_sam', rating: 5, comment: 'Great!', tags: [] }),
    ).rejects.toMatchObject({ code: 'review/not-completed' })
  })
})

describe('local backend: signalling is scoped to the room', () => {
  async function room(): Promise<Booking> {
    const booking = await requestBooking(180)
    await signInAs('demo_lena')
    return backend.confirmBooking(booking.id)
  }

  it('delivers an offer to the counterparty and never echoes it back', async () => {
    const booking = await room()
    const roomId = booking.roomId!

    await signInAs('demo_lena')
    const receivedByTeacher: string[] = []
    const receivedByLearner: string[] = []
    const stopTeacher = backend.watchSignals(roomId, 'demo_lena', (message) => receivedByTeacher.push(message.kind))

    await signInAs('demo_sam')
    const stopLearner = backend.watchSignals(roomId, 'demo_sam', (message) => receivedByLearner.push(message.kind))
    await backend.sendSignal(roomId, {
      kind: 'offer',
      from: 'demo_sam',
      to: 'demo_lena',
      sdp: 'v=0-test',
      sequence: 1,
    })

    // Watchers poll on a timer, so let the polling loop run before asserting.
    await vi.advanceTimersByTimeAsync(1_000)

    stopTeacher()
    stopLearner()

    expect(receivedByTeacher).toContain('offer')
    expect(receivedByLearner).not.toContain('offer')
  })

  it('refuses signalling from a member who is not on the booking', async () => {
    const booking = await room()
    await signInAs('demo_jonas')
    await expect(
      backend.sendSignal(booking.roomId!, {
        kind: 'offer',
        from: 'demo_jonas',
        to: 'demo_lena',
        sdp: 'v=0-test',
        sequence: 1,
      }),
    ).rejects.toMatchObject({ code: 'room/forbidden' })
    await expect(
      backend.sendCandidate(booking.roomId!, { from: 'demo_jonas', to: 'demo_lena', candidate: { candidate: 'x' } }),
    ).rejects.toMatchObject({ code: 'room/forbidden' })
  })

  it('refuses signalling written under someone else’s identity', async () => {
    const booking = await room()
    await signInAs('demo_sam')
    await expect(
      backend.sendSignal(booking.roomId!, {
        kind: 'offer',
        from: 'demo_lena',
        to: 'demo_sam',
        sdp: 'v=0-test',
        sequence: 1,
      }),
    ).rejects.toMatchObject({ code: 'permission/denied' })
  })
})

describe('local backend: governance', () => {
  it('files a report, denies members the resolution, and lets an admin resolve it', async () => {
    const report = await backend.createReport({
      reporterUid: 'demo_sam',
      targetType: 'skill',
      targetId: teaching.id,
      targetPath: `skills/${teaching.id}`,
      targetLabel: teaching.title,
      reason: 'misrepresentation',
      details: 'The description promises something the listing does not cover.',
    })
    expect(report.status).toBe('open')

    await expect(
      backend.resolveReport(report.id, { status: 'resolved', resolution: 'Hidden pending edit.' }),
    ).rejects.toMatchObject({ code: 'permission/denied' })

    await signInAs('demo_admin')
    const resolved = await backend.resolveReport(report.id, { status: 'resolved', resolution: 'Hidden pending edit.' })
    expect(resolved.status).toBe('resolved')
    expect(resolved.handledByUid).toBe('demo_admin')
  })

  it('lets an admin adjust a wallet and keeps the reason in the ledger', async () => {
    await signInAs('demo_admin')
    const before = await backend.getWallet('demo_jonas')
    const after = await backend.adjustWallet('demo_jonas', 1, 'Facilitator credit for the March meetup')
    expect(after.balance - before.balance).toBeCloseTo(1, 5)

    const ledger = await backend.listTransactions('demo_jonas', { limit: 5 })
    expect(ledger[0].reason).toContain('Facilitator credit')
    expect(ledger[0].direction).toBe('credit')
  })

  it('publishes metrics for the admin overview', async () => {
    await signInAs('demo_admin')
    const metrics = await backend.getMetrics()
    expect(metrics.members).toBeGreaterThan(5)
    expect(metrics.activeListings).toBeGreaterThan(5)
    expect(metrics.completedSessions).toBeGreaterThan(0)
    expect(metrics.tokensSettled).toBeGreaterThan(0)
  })

  it('exposes communities, posts and comments to signed-in members', async () => {
    const communities = await backend.listCommunities()
    expect(communities.length).toBeGreaterThan(0)
    const posts = await backend.listPosts({ communityId: communities[0].id })
    expect(posts.length).toBeGreaterThan(0)

    const created = await backend.createPost({
      communityId: communities[0].id,
      authorUid: 'demo_sam',
      kind: 'question',
      title: 'Testing the reference backend',
      body: 'Does a post land in the right community?',
    })
    expect(created.authorUid).toBe('demo_sam')
    expect(created.commentCount).toBe(0)

    const comment = await backend.createComment({
      postId: created.id,
      communityId: communities[0].id,
      authorUid: 'demo_sam',
      body: 'Answering my own question for the test.',
    })
    expect(comment.postId).toBe(created.id)
    expect(await backend.listComments(created.id)).toHaveLength(1)
  })
})
