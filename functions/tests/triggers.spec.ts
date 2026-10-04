/**
 * The two notification triggers, end to end: the scheduled reminder sweep and
 * the comment-reply trigger.
 *
 * A reminder is the only notification the platform sends that nobody triggers —
 * a scheduled function has to decide on its own that a session is imminent, and
 * nothing in the request path would notice if it decided wrong. The failure
 * modes are quiet in both directions:
 *
 *   • **Nobody is reminded.** The sweep queries `status == 'confirmed'` with a
 *     range on `startAt`, and `startAt` is stored as a Firestore `Timestamp`.
 *     Compare it against an ISO string and the query matches nothing, forever,
 *     without an error anywhere.
 *   • **People are told twice.** Cloud Functions can retry, and a redeploy
 *     re-runs the schedule; a reminder that is not idempotent turns into a
 *     second message ten minutes later.
 *
 * Both are asserted here against the real `firebase-admin` SDK and
 * `firebase-mocker`, so the shape of the query and the idempotency key are
 * exercised rather than described.
 *
 * The comment trigger has its own trap: it must not tell a member that they
 * replied to themselves, and it must find the post's author from the *post*, not
 * from the community.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import {
  ADMIN,
  LEARNER,
  TEACHER,
  bookSession,
  clearWorld,
  notificationsFor,
  runReminderSweep,
  seedWorld,
  notifyingComment,
  startHarness,
  stopHarness,
  world,
} from './harness'

const CONFIRMED = 'confirmed'

/** Confirms a booked session the way the teacher does, so it may be reminded. */
async function confirmedBookingStartingAt(startAt: Date): Promise<string> {
  const bookingId = await bookSession(48)
  const booking = await world.db!.doc(`bookings/${bookingId}`).get()
  const endAt = new Date(startAt.getTime() + Number(booking.data()?.durationMinutes ?? 60) * 60_000)
  // Written directly: the app's own booking rules (rightly) refuse a session
  // that starts in half an hour, but the sweep's contract is about what the
  // clock says when it runs, not about when the booking was made.
  await world.db!.doc(`bookings/${bookingId}`).set(
    { status: CONFIRMED, startAt: Timestamp.fromDate(startAt), endAt: Timestamp.fromDate(endAt) },
    { merge: true },
  )
  return bookingId
}

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000)

// Shared by both describes: one harness, one clean world per test.
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

describe('session reminders', () => {
  it('tells both participants about a session starting inside the hour', async () => {
    await confirmedBookingStartingAt(inMinutes(30))

    const sent = await runReminderSweep()
    expect(sent).toBe(2)

    const forLearner = (await notificationsFor(LEARNER)).filter((n) => n.type === 'booking_reminder')
    const forTeacher = (await notificationsFor(TEACHER)).filter((n) => n.type === 'booking_reminder')

    expect(forLearner).toHaveLength(1)
    expect(forTeacher).toHaveLength(1)
    // Each side is told the *other* person's name — the whole point of the
    // message is who you are about to meet.
    expect(String(forLearner[0].body)).toContain('Tina Teacher')
    expect(String(forTeacher[0].body)).toContain('Leo Learner')
    expect(String(forLearner[0].title)).toMatch(/starts in \d+ minutes/)
  })

  it('never sends the same reminder twice', async () => {
    await confirmedBookingStartingAt(inMinutes(30))

    expect(await runReminderSweep()).toBe(2)
    // A retry, a redeploy, and a later tick of the same schedule.
    expect(await runReminderSweep()).toBe(0)

    expect((await notificationsFor(LEARNER)).filter((n) => n.type === 'booking_reminder')).toHaveLength(1)
    expect((await notificationsFor(TEACHER)).filter((n) => n.type === 'booking_reminder')).toHaveLength(1)
  })

  it('leaves sessions later in the day alone', async () => {
    await confirmedBookingStartingAt(inMinutes(6 * 60))

    expect(await runReminderSweep()).toBe(0)
    expect(await notificationsFor(LEARNER)).toEqual([])
  })

  it('does not remind a session that has not been confirmed', async () => {
    const bookingId = await bookSession(48)
    await world.db!.doc(`bookings/${bookingId}`).set(
      { status: 'requested', startAt: Timestamp.fromDate(inMinutes(30)) },
      { merge: true },
    )

    expect(await runReminderSweep()).toBe(0)
  })

  it('does not remind a cancelled session', async () => {
    const bookingId = await confirmedBookingStartingAt(inMinutes(30))
    await world.db!.doc(`bookings/${bookingId}`).set({ status: 'cancelled' }, { merge: true })

    expect(await runReminderSweep()).toBe(0)
  })

  it('a reminder is a normal notification: unread, high priority, linked to the booking', async () => {
    await confirmedBookingStartingAt(inMinutes(45))
    await runReminderSweep()

    const [reminder] = await notificationsFor(LEARNER)
    expect(reminder.read).toBe(false)
    expect(reminder.priority).toBe('high')
    expect(reminder.link).toBe('/bookings')
  })

  it('says "now" instead of "in 0 minutes" when the session starts this minute', async () => {
    const startAt = inMinutes(0)
    await confirmedBookingStartingAt(startAt)

    expect(await runReminderSweep(startAt)).toBe(2)
    expect(String((await notificationsFor(LEARNER))[0].title)).toContain('starts now')
  })

  it('leaves the administrator out of it', async () => {
    await confirmedBookingStartingAt(inMinutes(30))
    await runReminderSweep()

    expect(await notificationsFor(ADMIN)).toEqual([])
  })
})

describe('comment replies', () => {
  const COMMUNITY = 'cm_triggers'
  const POST = 'po_triggers'

  async function seedCommunityPost(): Promise<void> {
    await world.db!.doc(`communities/${COMMUNITY}`).set({
      id: COMMUNITY,
      name: 'Trigger tests',
      slug: 'trigger-tests',
      description: '',
      categoryId: 'music',
      visibility: 'public',
      ownerUid: TEACHER,
      memberUids: [TEACHER, LEARNER],
      memberCount: 2,
      postCount: 1,
      tags: [],
      rules: [],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    await world.db!.doc(`communities/${COMMUNITY}/posts/${POST}`).set({
      id: POST,
      communityId: COMMUNITY,
      authorUid: TEACHER,
      authorName: 'Tina Teacher',
      kind: 'question',
      title: 'How do you hold a barre chord?',
      body: 'Mine buzzes on the third string.',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
  }

  it('tells the post author who replied', async () => {
    await seedCommunityPost()

    const sent = await notifyingComment({ communityId: COMMUNITY, postId: POST, authorUid: LEARNER, body: 'Try rolling your index finger.' })
    expect(sent).toBe(true)

    const inbox = await notificationsFor(TEACHER)
    expect(inbox).toHaveLength(1)
    expect(inbox[0].type).toBe('community_reply')
    expect(String(inbox[0].title)).toContain('Leo Learner')
    expect(String(inbox[0].title)).toContain('How do you hold a barre chord?')
    expect(String(inbox[0].link)).toBe(`/communities/${COMMUNITY}?post=${POST}`)
    expect(await notificationsFor(LEARNER)).toEqual([])
  })

  it('stays silent when the author replies to their own post', async () => {
    await seedCommunityPost()

    const sent = await notifyingComment({ communityId: COMMUNITY, postId: POST, authorUid: TEACHER, body: 'Answering my own question.' })
    expect(sent).toBe(false)
    expect(await notificationsFor(TEACHER)).toEqual([])
  })

  it('does nothing for a post that no longer exists', async () => {
    await seedCommunityPost()
    await world.db!.doc(`communities/${COMMUNITY}/posts/${POST}`).delete()

    expect(await notifyingComment({ communityId: COMMUNITY, postId: POST, authorUid: LEARNER, body: 'Hello?' })).toBe(false)
    expect(await notificationsFor(TEACHER)).toEqual([])
  })
})
