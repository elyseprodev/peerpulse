import { beforeEach, describe, expect, it } from 'vitest'
import { LocalBackend } from '@/lib/backend/local'
import { getDb, type LocalDatabase } from '@/lib/backend/local/db'
import type { Booking, Review, SkillListing } from '@shared/domain'

/**
 * The demo world has to obey the product's own rules.
 *
 * `seedLocalDatabase` is hand-authored data — thirteen listings, twelve bookings,
 * eight members, a ledger per member — and hand-authored numbers drift from the
 * code that would have produced them. The seed already verifies the one thing
 * that would be indefensible (a wallet balance that does not match its ledger),
 * but everything else was unverified: whether a listing's stars equal its
 * reviews, whether a member's stats equal their settled sessions, whether a
 * settlement record's ledger rows exist, whether a room belongs to the booking
 * that names it.
 *
 * Those are exactly the numbers the UI displays and the marketplace ranks by, and
 * exactly the class of defect that the Cloud Functions had (see the counter fix
 * in git history). This suite re-derives every one of them from the data and
 * fails if the seed disagrees.
 *
 * It runs the real backend, so it also proves the seed loads without throwing.
 */

let backend: LocalBackend
let db: LocalDatabase
let userIds: Set<string>

const round = (value: number) => Math.round(value * 10_000) / 10_000
const all = <T>(record: Record<string, T>): T[] => Object.values(record)

beforeEach(async () => {
  localStorage.clear()
  backend = new LocalBackend()
  await backend.init()
  db = getDb()
  userIds = new Set(Object.keys(db.users))
})

describe('seed integrity: structure', () => {
  it('seeds a world worth looking at', () => {
    expect(all(db.users).length).toBeGreaterThanOrEqual(8)
    expect(all(db.skills).length).toBeGreaterThanOrEqual(10)
    expect(all(db.bookings).length).toBeGreaterThanOrEqual(10)
    expect(all(db.transactions).length).toBeGreaterThan(0)
    expect(all(db.reviews).length).toBeGreaterThan(0)
    expect(all(db.communities).length).toBeGreaterThanOrEqual(3)
  })

  it('has no dangling references', () => {
    const skillIds = new Set(Object.keys(db.skills))
    const bookingIds = new Set(Object.keys(db.bookings))

    for (const listing of all(db.skills)) {
      expect(userIds.has(listing.ownerUid), `listing ${listing.id} has an unknown owner`).toBe(true)
    }

    for (const booking of all(db.bookings)) {
      expect(userIds.has(booking.teacherUid), `booking ${booking.id}: unknown teacher`).toBe(true)
      expect(userIds.has(booking.learnerUid), `booking ${booking.id}: unknown learner`).toBe(true)
      expect(skillIds.has(booking.skillId), `booking ${booking.id}: unknown listing`).toBe(true)
      expect(new Set(booking.participants)).toEqual(new Set([booking.teacherUid, booking.learnerUid]))
      expect(booking.endAt > booking.startAt, `booking ${booking.id}: end before start`).toBe(true)
      const minutes = (Date.parse(booking.endAt) - Date.parse(booking.startAt)) / 60_000
      expect(minutes, `booking ${booking.id}: duration field disagrees with its window`).toBe(booking.durationMinutes)
    }

    for (const review of all(db.reviews)) {
      expect(bookingIds.has(review.bookingId), `review ${review.id}: unknown booking`).toBe(true)
      expect(userIds.has(review.authorUid), `review ${review.id}: unknown author`).toBe(true)
      expect(userIds.has(review.subjectUid), `review ${review.id}: unknown subject`).toBe(true)
    }

    for (const notification of all(db.notifications)) {
      expect(userIds.has(notification.uid), `notification ${notification.id}: unknown recipient`).toBe(true)
    }

    for (const room of all(db.rooms)) {
      expect(bookingIds.has(room.bookingId), `room ${room.id}: unknown booking`).toBe(true)
    }

    // Every booking that has been run needs the room it was run in.
    for (const booking of all(db.bookings)) {
      if (['in_progress', 'completed'].includes(booking.status)) {
        expect(booking.roomId, `booking ${booking.id} is ${booking.status} but names no room`).toBeTruthy()
      }
    }
  })

  it('keeps community membership counts honest', () => {
    // Members live in `communityMembers[communityId]`, so the count the cards
    // display has to match that array.
    for (const community of all(db.communities)) {
      const members = db.communityMembers[community.id] ?? []
      expect(members.length, `community ${community.id}: memberCount disagrees with its member rows`).toBe(community.memberCount)
      for (const member of members) {
        expect(userIds.has(member.uid), `community ${community.id}: unknown member ${member.uid}`).toBe(true)
      }
    }
  })
})

describe('seed integrity: the ledger', () => {
  it('derives every wallet balance from its own ledger', () => {
    for (const wallet of all(db.wallets)) {
      const rows = all(db.transactions).filter((row) => row.uid === wallet.uid && row.status === 'posted')
      const credits = rows.filter((row) => row.direction === 'credit').reduce((sum, row) => sum + row.amount, 0)
      const debits = rows.filter((row) => row.direction === 'debit').reduce((sum, row) => sum + row.amount, 0)
      expect(round(wallet.balance), `wallet ${wallet.uid} does not match its ledger`).toBe(round(credits - debits))
      expect(wallet.balance, `wallet ${wallet.uid} is overdrawn`).toBeGreaterThanOrEqual(0)
      // Nothing is escrowed under the default policy, so nothing may be held.
      expect(wallet.held, `wallet ${wallet.uid} holds tokens that no policy reserves`).toBe(0)
    }
  })

  it('moves no token without a row, and every row without a counterpart', () => {
    for (const row of all(db.transactions)) {
      expect(row.idempotencyKey, `ledger row ${row.id} has no idempotency key`).toBeTruthy()
      expect(row.policyCode, `ledger row ${row.id} names no policy`).toBeTruthy()
      expect(row.createdBy, `ledger row ${row.id} names no actor`).toBeTruthy()
      expect(row.reason.length, `ledger row ${row.id} has no reason`).toBeGreaterThan(0)
      if (row.bookingId) {
        const booking = db.bookings[row.bookingId]
        expect(booking, `ledger row ${row.id} references an unknown booking`).toBeDefined()
        expect(booking.participants.includes(row.uid), `ledger row ${row.id} is not a participant of its booking`).toBe(true)
        expect(
          row.uid === booking.learnerUid ? 'debit' : 'credit',
          `ledger row ${row.id} moves the wrong way for ${row.uid}`,
        ).toBe(row.direction)
      }
    }
  })

  it('conserves tokens across every settlement', () => {
    const settlementRows = all(db.transactions).filter((row) => row.bookingId && row.type !== 'signup_grant')
    const credits = settlementRows.filter((row) => row.direction === 'credit').reduce((sum, row) => sum + row.amount, 0)
    const debits = settlementRows.filter((row) => row.direction === 'debit').reduce((sum, row) => sum + row.amount, 0)
    expect(round(credits), 'settlements create or destroy tokens').toBe(round(debits))

    // Every settled booking has exactly one debit and one credit, and they agree.
    for (const booking of all(db.bookings).filter((b) => b.status === 'completed')) {
      const rows = all(db.transactions).filter((row) => row.bookingId === booking.id)
      expect(rows.filter((row) => row.direction === 'debit').length, `booking ${booking.id}: debits`).toBe(1)
      expect(rows.filter((row) => row.direction === 'credit').length, `booking ${booking.id}: credits`).toBe(1)
      expect(round(rows[0].amount)).toBe(round(rows[1].amount))
      expect(rows.map((row) => row.id).sort()).toEqual([`tx_${booking.id}_credit`, `tx_${booking.id}_debit`].sort())
    }
  })

  it('ties every settlement record to its booking and its ledger rows', () => {
    for (const booking of all(db.bookings).filter((b) => b.settlement.state === 'settled' || b.settlement.state === 'partial')) {
      const record = db.settlements[booking.settlement.settlementId ?? '']
      expect(record, `booking ${booking.id} is settled but has no settlement record`).toBeDefined()
      expect(record.bookingId).toBe(booking.id)
      expect(record.id).toBe(`settlement_${booking.id}`)
      expect(record.idempotencyKey).toBe(record.id)
      expect(record.debitTxId && db.transactions[record.debitTxId], `booking ${booking.id}: debit row missing`).toBeTruthy()
      expect(record.creditTxId && db.transactions[record.creditTxId], `booking ${booking.id}: credit row missing`).toBeTruthy()
      expect(round(record.tokenAmount)).toBe(round(db.transactions[record.debitTxId!].amount))
      expect(round(record.tokenAmount)).toBe(round(db.transactions[record.creditTxId!].amount))
      expect(booking.completion.verifiedMinutes).toBe(record.verifiedMinutes)
      // A settled booking has a positive amount; a zero-token settlement would be
      // a session that happened for free, which the policy never decides.
      expect(record.tokenAmount).toBeGreaterThan(0)
    }

    // And no settlement record exists for a booking that never settled.
    for (const record of all(db.settlements)) {
      const booking = db.bookings[record.bookingId]
      expect(booking, `settlement ${record.id} references an unknown booking`).toBeDefined()
      expect(['settled', 'partial'], `settlement ${record.id} exists for a ${booking.status} booking`).toContain(
        booking.settlement.state,
      )
    }
  })
})

describe('seed integrity: the numbers the UI displays', () => {
  it('derives every listing score and counter from its reviews and bookings', () => {
    for (const listing of all(db.skills)) {
      const reviews = all(db.reviews).filter((review: Review) => review.skillId === listing.id && review.subjectUid === listing.ownerUid)
      const bookings = all(db.bookings).filter((booking: Booking) => booking.skillId === listing.id)
      const settled = bookings.filter((booking) => ['settled', 'partial'].includes(booking.settlement.state))

      expect(listing.reviewCount, `listing ${listing.id}: reviewCount`).toBe(reviews.length)
      expect(round(listing.ratingSum), `listing ${listing.id}: ratingSum`).toBe(round(reviews.reduce((sum, r) => sum + r.rating, 0)))
      expect(listing.completedCount, `listing ${listing.id}: completedCount`).toBe(settled.length)
      expect(listing.bookingCount, `listing ${listing.id}: bookingCount`).toBe(bookings.length)
    }
  })

  it('derives every member’s stats from their settled sessions and their ledger', () => {
    for (const profile of all(db.users)) {
      const taught = all(db.bookings).filter(
        (booking: Booking) => booking.teacherUid === profile.uid && ['settled', 'partial'].includes(booking.settlement.state),
      )
      const learned = all(db.bookings).filter(
        (booking: Booking) => booking.learnerUid === profile.uid && ['settled', 'partial'].includes(booking.settlement.state),
      )
      const rows = all(db.transactions).filter((row) => row.uid === profile.uid && row.status === 'posted')
      const reviews = all(db.reviews).filter((review: Review) => review.subjectUid === profile.uid)

      expect(profile.stats.sessionsTaught, `${profile.uid}: sessionsTaught`).toBe(taught.length)
      expect(profile.stats.sessionsCompleted, `${profile.uid}: sessionsCompleted`).toBe(taught.length + learned.length)
      // Hours accrue at full precision and are rounded once, so a slow drift of
      // per-session rounding cannot show up here.
      expect(profile.stats.teachingHours, `${profile.uid}: teachingHours`).toBeCloseTo(
        taught.reduce((sum, booking) => sum + booking.durationMinutes / 60, 0),
        4,
      )
      expect(profile.stats.learningHours, `${profile.uid}: learningHours`).toBeCloseTo(
        learned.reduce((sum, booking) => sum + booking.durationMinutes / 60, 0),
        4,
      )
      expect(round(profile.stats.tokensEarned), `${profile.uid}: tokensEarned`).toBe(
        round(rows.filter((row) => row.direction === 'credit' && row.type !== 'signup_grant').reduce((sum, row) => sum + row.amount, 0)),
      )
      expect(round(profile.stats.tokensSpent), `${profile.uid}: tokensSpent`).toBe(
        round(rows.filter((row) => row.direction === 'debit').reduce((sum, row) => sum + row.amount, 0)),
      )
      expect(profile.stats.reviewCount, `${profile.uid}: reviewCount`).toBe(reviews.length)
      expect(round(profile.stats.ratingSum), `${profile.uid}: ratingSum`).toBe(round(reviews.reduce((sum, r) => sum + r.rating, 0)))
    }
  })

  it('keeps the member directory and the listings consistent with the profiles behind them', () => {
    // Discovery pages filter on these three fields; a demo member excluded from
    // the directory should be excluded on purpose, not by omission.
    const discoverable = all(db.users).filter(
      (u) => u.privacy.appearInDiscovery && u.privacy.profileVisibility === 'public' && u.status === 'active',
    )
    expect(discoverable.length).toBe(all(db.users).length)

    for (const listing of all(db.skills) as SkillListing[]) {
      expect(listing.durationMinutes, `listing ${listing.id}: duration`).toBeGreaterThanOrEqual(15)
      expect(listing.durationMinutes).toBeLessThanOrEqual(180)
      expect(listing.tags.length, `listing ${listing.id} has no tags`).toBeGreaterThan(0)
      expect(listing.outcomes.length, `listing ${listing.id} promises no outcomes`).toBeGreaterThan(0)
      const owner = db.users[listing.ownerUid]
      expect(owner.teachSkillIds, `listing ${listing.id} is missing from its owner's teachSkillIds`).toContain(listing.id)
    }
  })

  it('leaves reviews consistent with the sessions they judge', () => {
    for (const review of all(db.reviews)) {
      const booking = db.bookings[review.bookingId]
      expect(booking.status, `review ${review.id} judges a ${booking.status} session`).toBe('completed')
      expect(review.authorUid).not.toBe(review.subjectUid)
      expect(booking.participants).toContain(review.authorUid)
      expect(booking.participants).toContain(review.subjectUid)
      expect(review.rating).toBeGreaterThanOrEqual(1)
      expect(review.rating).toBeLessThanOrEqual(5)
      // The author role has to name the side the author is actually on.
      expect(review.authorRole).toBe(review.authorUid === booking.teacherUid ? 'teacher' : 'learner')
      expect(review.moderation.state).toBe('clean')
      // The review cannot predate the session it judges.
      expect(Date.parse(review.createdAt), `review ${review.id} predates its session`).toBeGreaterThanOrEqual(Date.parse(booking.endAt))
    }
  })

  it('only settles sessions both members attended, in line with the policy quorum', () => {
    for (const booking of all(db.bookings).filter((b) => ['settled', 'partial'].includes(b.settlement.state))) {
      expect(booking.completion.verifiedMinutes).toBeGreaterThan(0)
      expect(booking.completion.verifiedMinutes).toBeLessThanOrEqual(booking.durationMinutes)
      // Attendance lives under the room the session ran in.
      const attendance = db.attendance[booking.roomId ?? ''] ?? []
      const uids = new Set(attendance.map((segment) => segment.uid))
      expect(uids.has(booking.teacherUid), `booking ${booking.id} settled without the teacher present`).toBe(true)
      expect(uids.has(booking.learnerUid), `booking ${booking.id} settled without the learner present`).toBe(true)
    }
  })
})
