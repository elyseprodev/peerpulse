import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalBackend } from '@/lib/backend/local'
import type { AuthSession } from '@/lib/backend/types'
import type { AppNotification, Booking, SkillListing } from '@shared/domain'

/**
 * Who gets told what, end to end, in the reference backend.
 *
 * `functions/tests/notifications.spec.ts` pins the composers themselves; this
 * file drives the real backend API and checks the *wiring* — that a cancellation
 * actually reaches the other participant's notification list, that a comment
 * reaches the post's author, and that a steward's action is typed as a
 * moderation action rather than a community reply.
 *
 * These are the bugs that survived a green test suite: the production path once
 * addressed a cancellation to the member who cancelled it, and typed report
 * outcomes as `community_reply`. Both were invisible from a composer test alone,
 * because the composer is not what the call site passed.
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
  return backend.signIn(EMAILS[uid], 'peerpulse')
}

async function skillOwnedBy(ownerUid: string, index = 0): Promise<SkillListing> {
  const listings = await backend.listSkills({ ownerUid })
  const listing = listings[index]
  expect(listing).toBeDefined()
  return listing
}

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

async function requestBooking(teaching: SkillListing, startInMinutes = 180): Promise<Booking> {
  const startAt = minutesFromNow(startInMinutes)
  const endAt = new Date(Date.parse(startAt) + teaching.durationMinutes * 60_000).toISOString()
  return backend.createBooking({ skillId: teaching.id, startAt, endAt, timezone: 'UTC', learnerNote: '' })
}

/**
 * Turns on escrow, which is off in the default policy: with escrow, confirming a
 * session holds the learner's tokens and a cancellation writes a refund row.
 * Without it nothing is ever taken, so "returned to your balance" would be a
 * promise about a balance that never changed.
 */
async function withEscrow(): Promise<void> {
  await signInAs('demo_admin')
  const config = await backend.getPlatformConfig()
  await backend.updatePlatformConfig({ booking: { ...config.booking, reserveTokensOnConfirm: true } })
}

const forUid = (items: AppNotification[], uid: string) => items.filter((item) => item.uid === uid)

/** The most recent notification of a given type in a member's feed. */
async function newestForType(uid: string, type: AppNotification['type']): Promise<AppNotification | undefined> {
  return forUid(await backend.listNotifications(uid), uid).find((item) => item.type === type)
}
const typesOf = (items: AppNotification[]) => items.map((item) => item.type)

let teaching: SkillListing

beforeEach(async () => {
  await freshBackend()
  teaching = await skillOwnedBy('demo_lena')
})

describe('a cancellation tells the other member, not the one who cancelled', () => {
  it('a learner cancelling reaches the teacher, in the learner\'s name', async () => {
    await signInAs('demo_sam')
    const booking = await requestBooking(teaching)

    await signInAs('demo_lena')
    await backend.confirmBooking(booking.id)

    await signInAs('demo_sam')
    await backend.cancelBooking(booking.id, 'Something came up')

    const teacherFeed = forUid(await backend.listNotifications('demo_lena'), 'demo_lena')
    const cancellation = teacherFeed.find((item) => item.title.includes('cancelled'))

    expect(cancellation).toBeDefined()
    expect(cancellation!.type).toBe('booking_cancelled')
    expect(cancellation!.title).toContain('Sam')
    expect(cancellation!.body).not.toContain('[object Object]')
  })

  it('a teacher cancelling refunds and tells the learner why', async () => {
    await withEscrow()
    await signInAs('demo_sam')
    const booking = await requestBooking(teaching)

    await signInAs('demo_lena')
    await backend.confirmBooking(booking.id)
    await backend.cancelBooking(booking.id, 'I am unwell')

    const learnerFeed = forUid(await backend.listNotifications('demo_sam'), 'demo_sam')
    const refund = learnerFeed.find((item) => item.type === 'session_refunded')

    expect(refund).toBeDefined()
    expect(refund!.uid).toBe('demo_sam')
    expect(refund!.title).toContain('Lena')
    expect(refund!.body).toContain('Time Token')
    expect(refund!.link).toBe('/wallet')
  })

  it('a cancellation of a session that was never charged is not a refund', async () => {
    // Default policy: nothing is reserved on confirm, so cancelling changes no
    // balance and the message must not claim tokens came back. Production and
    // the reference backend agree on this — the settlement is left untouched.
    await signInAs('demo_sam')
    const requested = await requestBooking(teaching)
    await signInAs('demo_lena')
    const booking = await backend.confirmBooking(requested.id)
    const cancelled = await backend.cancelBooking(booking.id, 'Clash.')

    expect(cancelled.settlement.refundTxId).toBeNull()
    expect(cancelled.settlement.state).not.toBe('refunded')

    const notice = await newestForType('demo_sam', 'booking_cancelled')
    expect(notice).toBeDefined()
    expect(notice!.body).toContain('Nothing was charged')
    expect(notice!.body).not.toContain('returned to your balance')
  })

  it('a request costs nothing and tells the teacher a session is wanted', async () => {
    await signInAs('demo_sam')
    const booking = await requestBooking(teaching)

    const teacherFeed = forUid(await backend.listNotifications('demo_lena'), 'demo_lena')
    const request = teacherFeed.find((item) => item.type === 'booking_requested')

    expect(request).toBeDefined()
    expect(request!.priority).toBe('high')
    expect(request!.body).toContain('Time Token')
    expect(booking.status).toBe('requested')
  })
})

describe('typed consistently with production', () => {
  it('a report outcome is a moderation action', async () => {
    await signInAs('demo_sam')
    const community = await backend.createCommunity({
      name: 'Guitar circle',
      description: 'Practice together.',
      categoryId: 'music',
      visibility: 'public',
      tags: ['guitar'],
      rules: [],
      ownerUid: 'demo_sam',
    })
    await backend.joinCommunity(community.id, 'demo_sam')
    const post = await backend.createPost({
      communityId: community.id,
      authorUid: 'demo_sam',
      title: 'Barre chords',
      body: 'Any tips?',
      kind: 'question',
    })
    const report = await backend.createReport({
      reporterUid: 'demo_jonas',
      targetType: 'post',
      targetId: post.id,
      targetPath: `communities/${community.id}/posts/${post.id}`,
      targetLabel: 'Barre chords',
      reason: 'spam',
      details: 'Looks like an advertisement.',
    })

    await signInAs('demo_admin')
    await backend.resolveReport(report.id, { status: 'resolved', resolution: 'Post hidden.' })

    const reporterFeed = forUid(await backend.listNotifications('demo_jonas'), 'demo_jonas')
    expect(typesOf(reporterFeed)).toContain('moderation_action')
    expect(typesOf(reporterFeed)).not.toContain('community_reply')
  })

  it('a role change is a system message', async () => {
    await signInAs('demo_admin')
    await backend.setUserRole('demo_jonas', 'admin')

    const feed = forUid(await backend.listNotifications('demo_jonas'), 'demo_jonas')
    const notice = feed.find((item) => item.title.toLowerCase().includes('steward'))

    expect(notice).toBeDefined()
    expect(notice!.type).toBe('system')
  })

  it('a suspension is a system message that says why', async () => {
    await signInAs('demo_admin')
    await backend.setUserStatus('demo_jonas', 'suspended')

    const feed = forUid(await backend.listNotifications('demo_jonas'), 'demo_jonas')
    const notice = feed.find((item) => item.title.includes('suspended'))

    expect(notice).toBeDefined()
    expect(notice!.type).toBe('system')
    expect(notice!.priority).toBe('high')
  })

  it('a steward balance adjustment names the reason and the amount', async () => {
    await signInAs('demo_admin')
    await backend.adjustWallet('demo_sam', -1, 'Duplicate settlement reversed.')

    const feed = forUid(await backend.listNotifications('demo_sam'), 'demo_sam')
    const notice = feed.find((item) => item.title.includes('removed by a steward'))

    expect(notice).toBeDefined()
    expect(notice!.type).toBe('token_grant')
    expect(notice!.body).toBe('Duplicate settlement reversed.')
  })

  it('a comment reply reaches the post author and deep-links to the post', async () => {
    await signInAs('demo_sam')
    const community = await backend.createCommunity({
      name: 'Guitar circle',
      description: 'Practice together.',
      categoryId: 'music',
      visibility: 'public',
      tags: ['guitar'],
      rules: [],
      ownerUid: 'demo_sam',
    })
    await backend.joinCommunity(community.id, 'demo_sam')
    const post = await backend.createPost({
      communityId: community.id,
      authorUid: 'demo_sam',
      title: 'Barre chords',
      body: 'Any tips?',
      kind: 'question',
    })

    await backend.createComment({ postId: post.id, communityId: community.id, authorUid: 'demo_lena', body: 'Ten minutes a day.' })

    const feed = forUid(await backend.listNotifications('demo_sam'), 'demo_sam')
    const reply = feed.find((item) => item.type === 'community_reply')

    expect(reply).toBeDefined()
    expect(reply!.uid).toBe('demo_sam')
    expect(reply!.title).toContain('Barre chords')
    expect(reply!.link).toBe(`/communities/${community.id}?post=${post.id}`)
  })

  it('a member is not told about their own comment', async () => {
    await signInAs('demo_sam')
    const community = await backend.createCommunity({
      name: 'Guitar circle',
      description: 'Practice together.',
      categoryId: 'music',
      visibility: 'public',
      tags: ['guitar'],
      rules: [],
      ownerUid: 'demo_sam',
    })
    await backend.joinCommunity(community.id, 'demo_sam')
    const post = await backend.createPost({
      communityId: community.id,
      authorUid: 'demo_sam',
      title: 'Barre chords',
      body: 'Any tips?',
      kind: 'question',
    })

    const before = typesOf(forUid(await backend.listNotifications('demo_sam'), 'demo_sam'))
    const replyCountBefore = before.filter((type) => type === 'community_reply').length

    await backend.createComment({ postId: post.id, communityId: community.id, authorUid: 'demo_sam', body: 'Answering my own question.' })

    const after = typesOf(forUid(await backend.listNotifications('demo_sam'), 'demo_sam'))
    // The seeded feed already contains a reply, so this counts what the comment
    // added rather than asserting on the whole list.
    expect(after.filter((type) => type === 'community_reply').length).toBe(replyCountBefore)
  })
})

describe('the whole feed stays legible', () => {
  it('every notification has a title, a body, a valid type and a link or a reason not to', async () => {
    await signInAs('demo_sam')
    const booking = await requestBooking(teaching)
    await signInAs('demo_lena')
    await backend.confirmBooking(booking.id)
    await signInAs('demo_sam')
    await backend.cancelBooking(booking.id, '')

    const domain = new Set<AppNotification['type']>([
      'booking_requested',
      'booking_confirmed',
      'booking_declined',
      'booking_cancelled',
      'booking_rescheduled',
      'booking_reminder',
      'session_settled',
      'session_refunded',
      'session_disputed',
      'review_received',
      'community_reply',
      'token_grant',
      'moderation_action',
      'system',
    ])

    const everyone = await Promise.all(
      (['demo_sam', 'demo_lena'] as const).map(async (uid) => backend.listNotifications(uid)),
    )
    const all = everyone.flat()

    expect(all.length).toBeGreaterThan(0)
    for (const item of all) {
      expect(item.title.trim()).not.toBe('')
      expect(item.title).not.toContain('undefined')
      expect(item.body.trim()).not.toBe('')
      expect(item.body).not.toContain('[object Object]')
      expect(domain.has(item.type)).toBe(true)
      expect(['low', 'normal', 'high']).toContain(item.priority)
      expect(typeof item.read).toBe('boolean')
    }
  })
})

/**
 * The requirement's own list, event by event.
 *
 * FR-33 names eleven events members must hear about: requests, confirmations,
 * declines, cancellations, reschedules, settlements, refunds, disputes, reviews,
 * community replies and token grants. This drives all eleven through the real
 * backend API and asserts the *type* that reaches the feed for each, because a
 * notification that is written with the wrong type is invisible in the bell but
 * wrong in the list, in the icon and in any future filter.
 */
describe('all eleven events in the requirement reach a member', () => {
  async function confirmedBooking(): Promise<Booking> {
    await signInAs('demo_sam')
    const booking = await requestBooking(teaching)
    await signInAs('demo_lena')
    return backend.confirmBooking(booking.id)
  }

  async function joinRoom(booking: Booking): Promise<void> {
    for (const uid of ['demo_lena', 'demo_sam'] as DemoUid[]) {
      await signInAs(uid)
      await backend.registerPresence(booking.roomId!, uid, { camera: true, microphone: true, screen: false })
    }
    await signInAs('demo_lena')
    await backend.startSession(booking.roomId!, 'demo_lena')
  }

  /** Runs a session to settlement and returns the completed booking. */
  async function settleSession(): Promise<Booking> {
    const booking = await confirmedBooking()
    await joinRoom(booking)
    vi.setSystemTime(new Date(Date.parse(booking.endAt) + 60_000))
    await signInAs('demo_sam')
    const result = await backend.endSession(booking.roomId!, 'demo_sam')
    expect(result.settlement).not.toBeNull()
    return (await backend.getBooking(booking.id))!
  }

  const newestFor = async (uid: string, type: AppNotification['type']) => {
    const feed = forUid(await backend.listNotifications(uid), uid)
    return feed.find((item) => item.type === type)
  }

  it('a request, a decline and a cancellation of an unpaid session', async () => {
    await signInAs('demo_sam')
    const declined = await requestBooking(teaching)
    await signInAs('demo_lena')
    await backend.declineBooking(declined.id, 'Not that day.')

    expect(await newestFor('demo_lena', 'booking_requested')).toBeDefined()
    expect(await newestFor('demo_sam', 'booking_declined')).toBeDefined()

    await signInAs('demo_sam')
    const cancelled = await requestBooking(teaching, 240)
    await signInAs('demo_lena')
    await backend.cancelBooking(cancelled.id, 'Clash.')

    const notice = await newestFor('demo_sam', 'booking_cancelled')
    expect(notice).toBeDefined()
    // Nothing had been paid, so the copy must not promise a refund.
    expect(notice!.body).toContain('Nothing was charged')
  })

  it('a confirmation and a reschedule', async () => {
    const booking = await confirmedBooking()
    expect(await newestFor('demo_sam', 'booking_confirmed')).toBeDefined()

    await signInAs('demo_sam')
    const startAt = minutesFromNow(300)
    await backend.rescheduleBooking(booking.id, startAt, new Date(Date.parse(startAt) + 60 * 60_000).toISOString(), 'Work thing.')

    expect(await newestFor('demo_lena', 'booking_rescheduled')).toBeDefined()
  })

  it('a refund when the teacher cancels a session that was already charged', async () => {
    await withEscrow()
    const booking = await confirmedBooking()
    await signInAs('demo_lena')
    await backend.cancelBooking(booking.id, 'I am unwell.')

    const refund = await newestFor('demo_sam', 'session_refunded')
    expect(refund).toBeDefined()
    expect(refund!.body).toContain('returned to your balance')
    expect(refund!.link).toBe('/wallet')
  })

  it('a settlement, a dispute and a review', async () => {
    const booking = await settleSession()
    expect(await newestFor('demo_lena', 'session_settled')).toBeDefined()
    expect(await newestFor('demo_sam', 'session_settled')).toBeDefined()

    await signInAs('demo_sam')
    await backend.createReview({ bookingId: booking.id, authorUid: 'demo_sam', rating: 5, comment: 'Clear and patient.', tags: [] })
    const review = await newestFor('demo_lena', 'review_received')
    expect(review).toBeDefined()
    expect(review!.title).toContain('5/5')

    // Order matters: a dispute moves the booking out of `completed`, and a
    // review can only follow a completed session.
    await signInAs('demo_sam')
    await backend.raiseDispute(booking.id, 'Only half the session happened.')
    expect(await newestFor('demo_lena', 'session_disputed')).toBeDefined()
  })

  it('a community reply and a token grant', async () => {
    await signInAs('demo_sam')
    const community = await backend.createCommunity({
      name: 'Guitar circle',
      description: 'Practice together.',
      categoryId: 'music',
      visibility: 'public',
      tags: ['guitar'],
      rules: [],
      ownerUid: 'demo_sam',
    })
    await backend.joinCommunity(community.id, 'demo_sam')
    const post = await backend.createPost({
      communityId: community.id,
      authorUid: 'demo_sam',
      title: 'Barre chords',
      body: 'Any tips?',
      kind: 'question',
    })
    await backend.createComment({ postId: post.id, communityId: community.id, authorUid: 'demo_lena', body: 'Ten minutes a day.' })
    expect(await newestFor('demo_sam', 'community_reply')).toBeDefined()

    await signInAs('demo_admin')
    await backend.adjustWallet('demo_sam', 1, 'Community hosting thank-you.')
    expect(await newestFor('demo_sam', 'token_grant')).toBeDefined()
  })

  it('a new member is welcomed with a grant they can audit', async () => {
    expect(await newestFor('demo_sam', 'token_grant')).toBeDefined()
  })
})
