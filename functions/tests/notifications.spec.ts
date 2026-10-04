/**
 * Notification contract tests.
 *
 * `functions.spec.ts` proves what happens to tokens; this file proves **who is
 * told what** when it happens. That matters here because the two backends each
 * used to compose their own messages, and they disagreed in ways no compiler
 * could catch and no single-backend test could see:
 *
 *   • cancelling with escrow held told the member who cancelled, and never told
 *     the person whose session had just been called off;
 *   • the *same* event was `community_reply` in production, `moderation_action`
 *     in local mode, so the notification list grouped them differently;
 *   • `booking_reminder` was declared in the domain union and never sent by the
 *     Cloud Functions at all;
 *   • a review could arrive with the recipient derived from the booking rather
 *     than from the review.
 *
 * The composers live in `shared/notify.ts` and both backends call them, so the
 * table below is asserted for the shared drafts **and** for the production
 * wrappers (`src/lib/notify.ts`), which must not diverge. The last two blocks are
 * static: they fail if a notification type literal appears anywhere outside the
 * shared composer or the domain union.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Booking, DisputeCase, NotificationType } from '../src/shared/domain'
import {
  bookingCancelledDraft,
  bookingConfirmedDraft,
  bookingReminderDraft,
  bookingRequestedDraft,
  commentReplyDraft,
  disputeRaisedDraft,
  disputeResolvedDraft,
  pendingCompletionDraft,
  refundIssuedDraft,
  reportResolvedDraft,
  reviewReceivedDraft,
  roleChangedDraft,
  accountStatusChangedDraft,
  tokenGrantDraft,
} from '../src/shared/notify'

// The production wrappers read `db` from `lib/refs` at module load, which would
// initialize the Admin SDK. The composers themselves never touch it, so the
// module is stubbed: this test is about the wording and the recipient, and the
// harness in `functions.spec.ts` covers the writes.
vi.mock('../src/lib/refs', () => ({
  COLLECTIONS: { notifications: 'notifications' },
  db: {},
  nowIso: () => new Date().toISOString(),
}))
const { COMPOSERS } = await import('../src/lib/notify')

const TEACHER = 'u_teacher'
const LEARNER = 'u_learner'
const STEWARD = 'u_steward'

export function bookingFixture(overrides: Partial<Booking> = {}): Booking {
  const startAt = '2099-03-12T18:00:00.000Z'
  const endAt = '2099-03-12T19:00:00.000Z'
  return {
    id: 'bk_1',
    skillId: 'sk_guitar',
    skillTitle: 'Guitar for beginners',
    categoryId: 'music',
    teacherUid: TEACHER,
    learnerUid: LEARNER,
    participants: [LEARNER, TEACHER].sort(),
    participantsSnapshot: [],
    createdByUid: LEARNER,
    startAt,
    endAt,
    durationMinutes: 60,
    timezone: 'Africa/Johannesburg',
    status: 'confirmed',
    roomId: 'room_bk_1',
    tokenAmount: 1,
    settlement: {
      state: 'pending',
      settlementId: null,
      settledAt: null,
      debitTxId: null,
      creditTxId: null,
      refundTxId: null,
      heldTxId: null,
      note: null,
    },
    cancellation: null,
    reschedules: [],
    completion: { teacherConfirmedAt: null, learnerConfirmedAt: null, autoCompletedAt: null, verifiedMinutes: null, closedBy: null },
    learnerNote: '',
    teacherNote: '',
    revision: 1,
    createdAt: '2099-03-01T09:00:00.000Z',
    updatedAt: '2099-03-01T09:00:00.000Z',
    ...overrides,
  }
}

/** A booking whose cancellation wrote a refund row — escrow was on. */
const refundedFixture = (overrides: Partial<Booking> = {}): Booking =>
  bookingFixture({
    settlement: {
      state: 'refunded',
      settlementId: null,
      settledAt: null,
      debitTxId: null,
      creditTxId: null,
      refundTxId: 'tx_bk_1_refund',
      heldTxId: 'tx_bk_1_hold',
      note: null,
    },
    ...overrides,
  })

const disputeFixture = (overrides: Partial<DisputeCase> = {}): DisputeCase => ({
  id: 'dsp_1',
  bookingId: 'bk_1',
  openedByUid: LEARNER,
  againstUid: TEACHER,
  claim: 'The teacher never joined the room.',
  evidence: '',
  status: 'open',
  outcome: null,
  handledByUid: null,
  createdAt: '2099-03-12T19:05:00.000Z',
  updatedAt: '2099-03-12T19:05:00.000Z',
  ...overrides,
})

describe('a cancellation reaches the member who did not cancel', () => {
  it('notifies the teacher when the learner cancels, naming the learner', () => {
    const booking = bookingFixture({
      cancellation: { byUid: LEARNER, reason: 'work', at: '2099-03-12T10:00:00.000Z', refundTokens: 0, policyCode: 'free_cancellation' },
    })
    const draft = bookingCancelledDraft(booking, LEARNER, 'Sam Mokoena', 0, 'free_cancellation')

    expect(draft.uid).toBe(TEACHER)
    expect(draft.type).toBe('booking_cancelled')
    expect(draft.title).toContain('Sam Mokoena')
    expect(draft.body).toContain('policy: free cancellation')
    expect(draft.body).not.toContain('[object Object]')
    // The teacher is not the member who paid, so this must not claim that
    // tokens landed in *their* wallet.
    expect(draft.body).not.toContain('your balance')
  })

  it('a learner cancelling after escrow spares the teacher a false refund', () => {
    const booking = refundedFixture({
      cancellation: { byUid: LEARNER, reason: 'work', at: '2099-03-12T10:00:00.000Z', refundTokens: 1, policyCode: 'standard_cancellation' },
    })
    const draft = bookingCancelledDraft(booking, LEARNER, 'Sam Mokoena', 1, 'standard_cancellation')

    expect(draft.uid).toBe(TEACHER)
    expect(draft.type).toBe('booking_cancelled')
    expect(draft.body).toContain("learner's 1 time token were returned")
    expect(draft.link).toBe('/bookings')
  })

  it('notifies the learner when the teacher cancels', () => {
    const booking = refundedFixture({
      cancellation: { byUid: TEACHER, reason: 'illness', at: '2099-03-12T10:00:00.000Z', refundTokens: 1, policyCode: 'teacher_cancellation' },
    })
    const draft = bookingCancelledDraft(booking, TEACHER, 'Nomsa Dube', 1, 'teacher_cancellation')

    expect(draft.uid).toBe(LEARNER)
    expect(draft.type).toBe('session_refunded')
    expect(draft.body).toContain('1 Time Token were returned to your balance')
    expect(draft.link).toBe('/wallet')
  })

  it('the production wrapper resolves the same recipient as the shared draft', () => {
    const booking = bookingFixture()
    const shared = bookingCancelledDraft(booking, LEARNER, 'Sam Mokoena', 0, 'free_cancellation')
    const produced = COMPOSERS.bookingCancelled(booking, LEARNER, 'Sam Mokoena', 0, 'free_cancellation')

    expect(produced.uid).toBe(shared.uid)
    expect(produced.type).toBe(shared.type)
    expect(produced.title).toBe(shared.title)
    expect(produced.body).toBe(shared.body)
  })
})

describe('one event, one type, in both backends', () => {
  it('a steward decision about a report is a moderation action', () => {
    const shared = reportResolvedDraft({ reporterUid: LEARNER, upheld: true, resolution: 'Post hidden.' })
    const produced = COMPOSERS.reportResolved({ reporterUid: LEARNER, upheld: true, resolution: 'Post hidden.' })

    expect(shared.type).toBe('moderation_action')
    expect(produced.type).toBe('moderation_action')
    expect(produced.title).toContain('upheld')
  })

  it('a role change is a system message, not a community reply', () => {
    const promoted = roleChangedDraft(LEARNER, 'admin', STEWARD)
    const removed = roleChangedDraft(LEARNER, 'member', STEWARD)

    expect(promoted.type).toBe('system')
    expect(removed.type).toBe('system')
    expect(promoted.title).toContain('steward')
    expect(removed.title).toContain('removed')
  })

  it('a suspension and a reinstatement are both system messages', () => {
    expect(accountStatusChangedDraft(LEARNER, 'suspended', 'Spam.').type).toBe('system')
    expect(accountStatusChangedDraft(LEARNER, 'suspended', 'Spam.').priority).toBe('high')
    expect(accountStatusChangedDraft(LEARNER, 'active', '').type).toBe('system')
    expect(accountStatusChangedDraft(LEARNER, 'active', '').title).toContain('active again')
  })

  it('a balance adjustment is a token grant with the steward reason', () => {
    const draft = tokenGrantDraft(LEARNER, -2, 'Duplicate settlement reversed.')

    expect(draft.type).toBe('token_grant')
    expect(draft.uid).toBe(LEARNER)
    expect(draft.title).toContain('removed by a steward')
    expect(draft.body).toContain('Duplicate settlement reversed.')
  })

  it('a welcome grant is a token grant too, and reads as a welcome', () => {
    const draft = tokenGrantDraft(LEARNER, 3, 'Welcome grant', { signup: true })

    expect(draft.type).toBe('token_grant')
    expect(draft.title).toContain('3 Time Tokens added to your wallet')
    expect(draft.title).not.toContain('steward')
  })

  it('opening a dispute is `session_disputed`, resolving one keeps that type', () => {
    expect(disputeRaisedDraft(disputeFixture(), 'Sam Mokoena').type).toBe('session_disputed')
    expect(disputeResolvedDraft(disputeFixture({ status: 'resolved_split' }), true, '').type).toBe('session_disputed')
  })

  it('cancelling a session that was never charged is not called a refund', () => {
    // The default policy reserves nothing on confirm, so `refundTokens` can be
    // the full amount while the learner's balance never changed. Only a written
    // refund row may be described as money coming back.
    const booking = bookingFixture({
      cancellation: { byUid: TEACHER, reason: 'illness', at: '2099-03-12T10:00:00.000Z', refundTokens: 1, policyCode: 'teacher_cancellation' },
    })
    const draft = bookingCancelledDraft(booking, TEACHER, 'Nomsa Dube', 1, 'teacher_cancellation')

    expect(draft.type).toBe('booking_cancelled')
    expect(draft.body).toContain('Nothing was charged')
    expect(draft.body).not.toContain('returned to your balance')
  })

  it('a refund is findable as a refund, addressed to the learner', () => {
    const draft = refundIssuedDraft(refundedFixture(), 1, 'Attendance was not verified.')

    expect(draft.type).toBe('session_refunded')
    expect(draft.uid).toBe(LEARNER)
    expect(draft.link).toBe('/wallet')
  })
})

describe('the reminder the Cloud Functions never sent', () => {
  it('goes to the member who asked for it, naming the other one', () => {
    const booking = bookingFixture()
    const toLearner = bookingReminderDraft(booking, LEARNER, 'Nomsa Dube', 30)
    const toTeacher = bookingReminderDraft(booking, TEACHER, 'Sam Mokoena', 30)

    expect(toLearner.uid).toBe(LEARNER)
    expect(toTeacher.uid).toBe(TEACHER)
    expect(toLearner.type).toBe('booking_reminder')
    expect(toLearner.title).toContain('in 30 minutes')
    expect(toLearner.body).toContain('Nomsa Dube')
    expect(toLearner.body).toContain('opens 15 minutes before')
  })

  it('speaks in the singular for one minute and in the present for a late start', () => {
    const booking = bookingFixture()
    expect(bookingReminderDraft(booking, LEARNER, 'Nomsa Dube', 1).title).toContain('in 1 minute')
    expect(bookingReminderDraft(booking, LEARNER, 'Nomsa Dube', 0).title).toContain('starts now')
  })
})

describe('the rest of the lifecycle addresses the right member', () => {
  it('a request is addressed to the teacher, a confirmation to the learner', () => {
    expect(bookingRequestedDraft(bookingFixture(), 'Nomsa Dube', 'Sam Mokoena').uid).toBe(TEACHER)
    expect(bookingConfirmedDraft(bookingFixture(), 'Nomsa Dube').uid).toBe(LEARNER)
  })

  it('a review is addressed to the member reviewed, not to the booking owner', () => {
    const draft = reviewReceivedDraft({
      subjectUid: TEACHER,
      authorName: 'Sam Mokoena',
      rating: 5,
      comment: 'Patient and clear.',
      skillTitle: 'Guitar for beginners',
    })

    expect(draft.uid).toBe(TEACHER)
    expect(draft.type).toBe('review_received')
    expect(draft.link).toBe(`/members/${TEACHER}`)
  })

  it('a comment reply names the post it answers and deep-links to it', () => {
    const draft = commentReplyDraft({
      recipientUid: TEACHER,
      authorName: 'Sam Mokoena',
      communityId: 'cm_1',
      postId: 'po_9',
      postTitle: 'Best way to practise barre chords?',
      commentBody: 'Ten minutes a day.',
    })

    expect(draft.uid).toBe(TEACHER)
    expect(draft.type).toBe('community_reply')
    expect(draft.title).toContain('Best way to practise barre chords?')
    expect(draft.link).toBe('/communities/cm_1?post=po_9')
  })

  it('the pending-completion nudge goes to whoever still has to confirm', () => {
    const neither = bookingFixture()
    const teacherDone = bookingFixture({
      completion: { teacherConfirmedAt: '2099-03-12T19:02:00.000Z', learnerConfirmedAt: null, autoCompletedAt: null, verifiedMinutes: 24, closedBy: 'participants' },
    })

    expect(pendingCompletionDraft(neither).uid).toBe(TEACHER)
    expect(pendingCompletionDraft(teacherDone).uid).toBe(LEARNER)
  })

  it('renders the session window once, in a stated timezone', () => {
    const draft = bookingConfirmedDraft(bookingFixture(), 'Nomsa Dube')

    expect(draft.body).toContain('18:00–19:00 UTC')
    expect(draft.body).not.toContain('2099-03-12T18:00')
  })
})

/* ─────────────────────────── static guards ─────────────────────────── */

const repoRoot = path.resolve(__dirname, '..', '..')
const read = (relative: string): string => readFileSync(path.join(repoRoot, relative), 'utf8')

function walk(relativeDir: string, extension = '.ts'): string[] {
  const absolute = path.join(repoRoot, relativeDir)
  const entries = readdirSync(absolute, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const relative = `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) return walk(relative, extension)
    return entry.name.endsWith(extension) ? [relative] : []
  })
}

const domainTypes = (() => {
  const source = read('shared/domain.ts')
  const union = /export type NotificationType =([\s\S]*?)\n\n/.exec(source)
  if (!union) throw new Error('NotificationType union not found in shared/domain.ts')
  return new Set([...union[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]))
})()

describe('notification types cannot drift out of the domain union', () => {
  it('every type the composers emit is declared in NotificationType', () => {
    // Every quoted literal on a line that assigns `type:`, which covers both the
    // plain form and the ternary used where one composer serves two events
    // (`type: refunded ? 'session_refunded' : 'booking_cancelled'`).
    const emitted = new Set(
      read('shared/notify.ts')
        .split('\n')
        .filter((line) => line.includes('type:'))
        .flatMap((line) => [...line.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])),
    )

    expect([...emitted].filter((type) => !domainTypes.has(type))).toEqual([])
    // The union is allowed to be wider than what is currently sent — it carries
    // historical types that existing documents still use.
    expect([...domainTypes].filter((type) => !emitted.has(type))).toEqual([])
  })

  it('`booking_reminder` is sent by the functions, not only declared', () => {
    expect(read('functions/src/triggers.ts')).toContain('COMPOSERS.bookingReminder')
  })

  it('no production call site writes a notification object by hand', () => {
    const offenders = walk('functions/src').filter((file) => {
      if (file.endsWith('lib/notify.ts')) return false
      const source = read(file)
      // A hand-written payload has a `type: '<literal>'` beside a `uid:` inside
      // the same argument list — exactly the shape that used to encode the
      // recipient. Everything must go through COMPOSERS instead.
      return /notify(?:Now)?\([^)]*?uid:[^)]*?type: '([a-z_]+)'/s.test(source) || /notify(?:Now)?\([^)]*?type: '([a-z_]+)'[^)]*?uid:/s.test(source)
    })

    expect(offenders).toEqual([])
  })

  it('the local backend composes through the shared drafts too', () => {
    const offenders = walk('src/lib/backend/local').filter((file) => {
      // `notify.ts` is the writer; `seed.ts` builds demo documents, which is
      // sample data rather than a reaction to an event.
      if (file.endsWith('notify.ts') || file.endsWith('seed.ts')) return false
      return /type: '[a-z_]+',\s*\n\s*title:/.test(read(file))
    })

    expect(offenders).toEqual([])
  })

  it('both backends import the same composers', () => {
    expect(read('src/lib/backend/local/notify.ts')).toContain("from '@shared/notify'")
    expect(read('functions/src/lib/notify.ts')).toContain("from '../shared/notify'")
    // And the copy the functions actually run is the synced one.
    expect(read('functions/src/shared/notify.ts')).toBe(read('shared/notify.ts'))
  })
})

describe('the type union itself', () => {
  it('contains every type the product sends', () => {
    const sent: NotificationType[] = [
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
    ]

    expect(sent.filter((type) => !domainTypes.has(type))).toEqual([])
  })
})
