/**
 * Local backend — booking, video-room and settlement operations.
 *
 * These functions are the in-browser equivalent of the PeerPulse Cloud
 * Functions. They deliberately mirror the server design:
 *   • conflicts are re-checked at write time (never trusting a client's view),
 *   • token movements go through the shared settlement planners,
 *   • ledger ids are deterministic, so a repeated call cannot double-post.
 */
import {
  DEFAULT_PLATFORM_CONFIG,
  SETTLEMENT_BLOCKED_REASONS,
  availableBalance,
  bookingLifecycle,
  buildRefundWrites,
  buildSettlementRecord,
  buildSettlementWrites,
  canAfford,
  computeTokenAmount,
  findConflict,
  planSettlement,
  resolveCancellation,
  validateBookingWindow,
  validateSessionDuration,
} from '@shared'
import {
  type AttendanceSegment,
  type Booking,
  type MediaState,
  type PlatformConfig,
  type Review,
  type Room,
  type RoomPresence,
  type SettlementRecord,
  type UserProfile,
} from '@shared/domain'
import { persist, sortBy, uid, type LocalDatabase } from './db'
import { pushNotification } from './notify'
import type { CreateBookingInput, CreateReviewInput, SettlementOutcomeResult } from '../types'
import { BackendRequestError } from '../types'

function fail(code: string, message: string, fields?: Record<string, string>): never {
  throw new BackendRequestError({ code, message, fields })
}

function requireUser(db: LocalDatabase, uidValue: string): UserProfile {
  const user = db.users[uidValue]
  if (!user) fail('user/not-found', 'That member could not be found.')
  return user
}

function requireBooking(db: LocalDatabase, id: string): Booking {
  const booking = db.bookings[id]
  if (!booking) fail('booking/not-found', 'That booking could not be found.')
  return booking
}

export function requireParticipant(booking: Booking, actorUid: string): void {
  if (!booking.participants.includes(actorUid)) {
    fail('booking/forbidden', 'Only the teacher or the learner on this booking can do that.')
  }
}

/* ─────────────────────────────── bookings ─────────────────────────────── */

export function listBookingsForUser(db: LocalDatabase, uidValue: string): Booking[] {
  return sortBy(
    Object.values(db.bookings).filter((b) => b.participants.includes(uidValue)),
    (b) => Date.parse(b.startAt),
    'desc',
  )
}

export function listBookingsInWindow(
  db: LocalDatabase,
  query: { uids: string[]; from: string; to: string },
): Booking[] {
  const from = Date.parse(query.from)
  const to = Date.parse(query.to)
  return Object.values(db.bookings).filter((booking) => {
    if (!booking.participants.some((p) => query.uids.includes(p))) return false
    const start = Date.parse(booking.startAt)
    const end = Date.parse(booking.endAt)
    return start < to && from < end
  })
}

export function createBooking(db: LocalDatabase, input: CreateBookingInput, actorUid: string): Booking {
  const skill = db.skills[input.skillId]
  if (!skill) fail('skill/not-found', 'That skill listing is no longer available.')
  if (skill.status !== 'published') fail('skill/unavailable', 'That listing is not accepting bookings right now.')
  if (skill.ownerUid === actorUid) fail('booking/self', 'You cannot book your own listing.')

  const learner = requireUser(db, actorUid)
  if (learner.status !== 'active') fail('auth/suspended', 'Your account is suspended — contact a steward.')

  const startAt = new Date(input.startAt)
  const endAt = new Date(input.endAt)
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    fail('booking/invalid-time', 'Choose a valid start and end time.', { startAt: 'Invalid date or time.' })
  }

  const config = db.config
  const durationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60_000)
  const durationError = validateSessionDuration(durationMinutes, config)
  if (durationError) fail('booking/invalid-duration', durationError, { duration: durationError })
  const windowError = validateBookingWindow(startAt, endAt, config)
  if (windowError) fail('booking/invalid-window', windowError, { startAt: windowError })

  // Server-side conflict detection across BOTH participants.
  const conflicts = listBookingsInWindow(db, {
    uids: [skill.ownerUid, actorUid],
    from: new Date(startAt.getTime() - 86_400_000).toISOString(),
    to: new Date(endAt.getTime() + 86_400_000).toISOString(),
  })
  const candidate = {
    id: 'new',
    start: startAt.toISOString(),
    end: endAt.toISOString(),
    status: 'requested' as const,
    teacherUid: skill.ownerUid,
    learnerUid: actorUid,
  }
  const conflict = findConflict(conflicts, candidate)
  if (conflict) {
    fail(
      'booking/conflict',
      `That slot overlaps another session${conflict.id ? ` (${conflict.id})` : ''}. Pick a different time.`,
      { startAt: 'This time overlaps an existing booking.' },
    )
  }

  const tokenAmount = computeTokenAmount(durationMinutes, config)
  if (config.booking.reserveTokensOnConfirm) {
    const wallet = db.wallets[actorUid]
    if (!wallet || !canAfford(wallet, tokenAmount)) {
      fail(
        'wallet/insufficient',
        `You need ${tokenAmount} Time Token(s) available to book this session.`,
      )
    }
  }

  const teacher = requireUser(db, skill.ownerUid)
  const now = new Date().toISOString()
  const bookingId = uid('bk')
  const autoConfirm = config.booking.autoConfirm

  const booking: Booking = {
    id: bookingId,
    skillId: skill.id,
    skillTitle: skill.title,
    categoryId: skill.categoryId,
    teacherUid: skill.ownerUid,
    learnerUid: actorUid,
    participants: [skill.ownerUid, actorUid].sort(),
    participantsSnapshot: [
      { uid: skill.ownerUid, displayName: teacher.displayName, photoURL: teacher.photoURL, avatarSeed: teacher.avatarSeed },
      { uid: actorUid, displayName: learner.displayName, photoURL: learner.photoURL, avatarSeed: learner.avatarSeed },
    ],
    createdByUid: actorUid,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    durationMinutes,
    timezone: input.timezone || learner.timezone,
    status: autoConfirm ? 'confirmed' : 'requested',
    roomId: autoConfirm ? `room_${bookingId}` : null,
    tokenAmount,
    settlement: {
      state: 'unsettled',
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
    completion: {
      teacherConfirmedAt: null,
      learnerConfirmedAt: null,
      autoCompletedAt: null,
      verifiedMinutes: null,
      closedBy: null,
    },
    learnerNote: input.learnerNote ?? '',
    teacherNote: '',
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }

  db.bookings[bookingId] = booking
  skill.bookingCount += 1

  if (autoConfirm) {
    createRoomForBooking(db, booking, teacher)
    pushNotification(db, {
      uid: skill.ownerUid,
      type: 'booking_confirmed',
      title: `${learner.displayName} booked ${skill.title}`,
      body: `Confirmed automatically for ${new Date(booking.startAt).toLocaleString()}.`,
      link: '/bookings',
    })
  } else {
    pushNotification(db, {
      uid: skill.ownerUid,
      type: 'booking_requested',
      title: `New session request from ${learner.displayName}`,
      body: `${skill.title} · ${new Date(booking.startAt).toLocaleString()}. Respond when you can.`,
      link: '/bookings',
      priority: 'high',
    })
  }

  persist('db', 'bookings|' + actorUid, 'bookings|' + skill.ownerUid, 'skills')
  return booking
}

function createRoomForBooking(db: LocalDatabase, booking: Booking, teacher: UserProfile): Room {
  const roomId = `room_${booking.id}`
  const room: Room = {
    id: roomId,
    bookingId: booking.id,
    skillTitle: booking.skillTitle,
    teacherUid: booking.teacherUid,
    learnerUid: booking.learnerUid,
    participants: booking.participants,
    status: 'scheduled',
    createdAt: new Date().toISOString(),
    openedAt: null,
    closedAt: null,
    attendanceLocked: false,
    session: { startedAt: null, endedAt: null, durationMinutes: null, initiatorUid: null },
  }
  db.rooms[roomId] = room
  db.presence[roomId] = []
  db.attendance[roomId] = []
  db.signals[roomId] = []
  db.candidates[roomId] = []
  booking.roomId = roomId
  void teacher
  return room
}

export function confirmBooking(db: LocalDatabase, id: string, actorUid: string): Booking {
  const booking = requireBooking(db, id)
  if (booking.teacherUid !== actorUid) fail('booking/forbidden', 'Only the teacher can confirm this request.')
  if (booking.status !== 'requested') fail('booking/invalid-state', 'This request is no longer awaiting confirmation.')

  const config = db.config
  if (config.booking.reserveTokensOnConfirm) {
    const wallet = db.wallets[booking.learnerUid]
    if (!wallet || !canAfford(wallet, booking.tokenAmount)) {
      fail('wallet/insufficient', 'The learner no longer has enough Time Tokens available for this session.')
    }
    // Escrow: reserve the learner's tokens without moving them.
    const holdId = `tx_${booking.id}_hold`
    if (!db.transactions[holdId]) {
      wallet.held += booking.tokenAmount
      db.transactions[holdId] = {
        id: holdId,
        type: 'escrow_hold',
        amount: booking.tokenAmount,
        direction: 'debit',
        status: 'pending',
        uid: booking.learnerUid,
        counterpartyUid: booking.teacherUid,
        bookingId: booking.id,
        roomId: null,
        idempotencyKey: holdId,
        balanceAfter: wallet.balance,
        reason: `Reserved for ${booking.skillTitle}`,
        policyCode: 'escrow_hold',
        createdBy: 'server:confirm_booking',
        createdAt: new Date().toISOString(),
      }
      booking.settlement.heldTxId = holdId
      booking.settlement.state = 'escrowed'
    }
  }

  booking.status = 'confirmed'
  booking.revision += 1
  booking.updatedAt = new Date().toISOString()
  const teacher = requireUser(db, booking.teacherUid)
  createRoomForBooking(db, booking, teacher)

  const learner = requireUser(db, booking.learnerUid)
  pushNotification(db, {
    uid: learner.uid,
    type: 'booking_confirmed',
    title: `${teacher.displayName} confirmed your session`,
    body: `${booking.skillTitle} · ${new Date(booking.startAt).toLocaleString()}. The room opens 15 minutes before.`,
    link: '/bookings',
  })

  persist('db', `bookings|${learner.uid}`, `bookings|${teacher.uid}`, `wallet|${learner.uid}`)
  return booking
}

export function declineBooking(db: LocalDatabase, id: string, reason: string, actorUid: string): Booking {
  const booking = requireBooking(db, id)
  if (booking.teacherUid !== actorUid) fail('booking/forbidden', 'Only the teacher can decline this request.')
  if (booking.status !== 'requested') fail('booking/invalid-state', 'This request has already been answered.')

  booking.status = 'declined'
  booking.revision += 1
  booking.updatedAt = new Date().toISOString()
  const teacher = requireUser(db, booking.teacherUid)
  pushNotification(db, {
    uid: booking.learnerUid,
    type: 'booking_declined',
    title: `${teacher.displayName} could not take that slot`,
    body: reason ? `Reason: ${reason}` : `${booking.skillTitle} was declined. Try another time or another teacher.`,
    link: '/skills',
  })
  persist('db', `bookings|${booking.learnerUid}`, `bookings|${actorUid}`)
  return booking
}

export function cancelBooking(db: LocalDatabase, id: string, reason: string, actorUid: string): Booking {
  const booking = requireBooking(db, id)
  requireParticipant(booking, actorUid)
  if (['completed', 'cancelled', 'declined', 'no_show'].includes(booking.status)) {
    fail('booking/invalid-state', 'This booking can no longer be cancelled.')
  }

  const config = db.config
  const outcome = resolveCancellation(booking, actorUid, config)
  const teacher = db.wallets[booking.teacherUid]
  const learner = db.wallets[booking.learnerUid]
  const now = new Date().toISOString()

  if (outcome.refundTokens > 0 && booking.settlement.heldTxId) {
    const refund = buildRefundWrites({
      booking,
      refundAmount: outcome.refundTokens,
      teacher,
      learner,
      reason: `Refund after cancellation: ${booking.skillTitle}`,
      createdBy: `user:${actorUid}`,
      policyCode: outcome.policyCode,
    })
    for (const entry of refund.entries) {
      db.transactions[entry.id] = {
        id: entry.id,
        type: entry.type,
        amount: entry.amount,
        direction: entry.direction,
        status: 'posted',
        uid: entry.uid,
        counterpartyUid: entry.counterpartyUid,
        bookingId: entry.bookingId,
        roomId: booking.roomId,
        idempotencyKey: entry.idempotencyKey,
        balanceAfter: entry.balanceAfter,
        reason: entry.reason,
        policyCode: entry.policyCode,
        createdBy: entry.createdBy,
        createdAt: now,
      }
    }
    db.wallets[booking.learnerUid] = refund.nextLearner
    booking.settlement.refundTxId = refund.entries[0]?.id ?? null
  }

  booking.status = 'cancelled'
  booking.cancellation = {
    byUid: actorUid,
    reason: reason || 'No reason given',
    at: now,
    refundTokens: outcome.refundTokens,
    policyCode: outcome.policyCode,
  }
  booking.settlement.state = 'refunded'
  booking.settlement.note = outcome.explanation
  booking.revision += 1
  booking.updatedAt = now

  if (booking.roomId && db.rooms[booking.roomId]) {
    db.rooms[booking.roomId].status = 'closed'
    db.rooms[booking.roomId].closedAt = now
  }

  const counterpartyUid = actorUid === booking.teacherUid ? booking.learnerUid : booking.teacherUid
  const actor = requireUser(db, actorUid)
  pushNotification(db, {
    uid: counterpartyUid,
    type: 'booking_cancelled',
    title: `${actor.displayName} cancelled ${booking.skillTitle}`,
    body: `${outcome.explanation}${reason ? ` Reason given: ${reason}` : ''}`,
    link: '/bookings',
    priority: 'high',
  })

  persist('db', `bookings|${booking.learnerUid}`, `bookings|${booking.teacherUid}`, `wallet|${booking.learnerUid}`)
  return booking
}

export function rescheduleBooking(
  db: LocalDatabase,
  id: string,
  startAtIso: string,
  endAtIso: string,
  reason: string,
  actorUid: string,
): Booking {
  const booking = requireBooking(db, id)
  requireParticipant(booking, actorUid)
  if (!['requested', 'confirmed'].includes(booking.status)) {
    fail('booking/invalid-state', 'Only requested or confirmed sessions can be rescheduled.')
  }

  const startAt = new Date(startAtIso)
  const endAt = new Date(endAtIso)
  const config = db.config
  const durationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60_000)
  const durationError = validateSessionDuration(durationMinutes, config)
  if (durationError) fail('booking/invalid-duration', durationError)
  const windowError = validateBookingWindow(startAt, endAt, config)
  if (windowError) fail('booking/invalid-window', windowError)

  const conflicts = listBookingsInWindow(db, {
    uids: booking.participants,
    from: new Date(startAt.getTime() - 86_400_000).toISOString(),
    to: new Date(endAt.getTime() + 86_400_000).toISOString(),
  }).filter((b) => b.id !== booking.id)
  const conflict = findConflict(conflicts, {
    start: startAt.toISOString(),
    end: endAt.toISOString(),
    status: 'confirmed',
    teacherUid: booking.teacherUid,
    learnerUid: booking.learnerUid,
  })
  if (conflict) {
    fail('booking/conflict', 'That slot overlaps another session.', {
      startAt: 'This time overlaps an existing booking.',
    })
  }

  const from = { start: booking.startAt, end: booking.endAt }
  booking.reschedules.push({
    byUid: actorUid,
    at: new Date().toISOString(),
    from,
    to: { start: startAt.toISOString(), end: endAt.toISOString() },
    reason: reason || 'Rescheduled',
  })
  booking.startAt = startAt.toISOString()
  booking.endAt = endAt.toISOString()
  booking.durationMinutes = durationMinutes
  booking.tokenAmount = computeTokenAmount(durationMinutes, config)
  booking.status = 'requested'
  booking.revision += 1
  booking.updatedAt = new Date().toISOString()

  const counterpartyUid = actorUid === booking.teacherUid ? booking.learnerUid : booking.teacherUid
  const actor = requireUser(db, actorUid)
  pushNotification(db, {
    uid: counterpartyUid,
    type: 'booking_rescheduled',
    title: `${actor.displayName} proposed a new time`,
    body: `${booking.skillTitle} · ${new Date(booking.startAt).toLocaleString()}. Confirm when it works for you.`,
    link: '/bookings',
    priority: 'high',
  })

  persist('db', `bookings|${booking.learnerUid}`, `bookings|${booking.teacherUid}`)
  return booking
}

/* ─────────────────────────────── rooms ─────────────────────────────── */

export function requireRoom(db: LocalDatabase, roomId: string): Room {
  const room = db.rooms[roomId]
  if (!room) fail('room/not-found', 'That video room does not exist.')
  return room
}

export function ensureRoom(db: LocalDatabase, bookingId: string, actorUid: string): Room {
  const booking = requireBooking(db, bookingId)
  requireParticipant(booking, actorUid)
  if (!['confirmed', 'in_progress'].includes(booking.status)) {
    fail('room/unavailable', 'The room opens once the session is confirmed.')
  }
  if (booking.roomId && db.rooms[booking.roomId]) return db.rooms[booking.roomId]
  const teacher = requireUser(db, booking.teacherUid)
  const room = createRoomForBooking(db, booking, teacher)
  persist('db', 'rooms')
  return room
}

export function requireRoomAccess(db: LocalDatabase, roomId: string, actorUid: string): Room {
  const room = requireRoom(db, roomId)
  if (!room.participants.includes(actorUid)) {
    fail('room/forbidden', 'Only the two members on this session may enter the room.')
  }
  return room
}

export function registerPresence(
  db: LocalDatabase,
  roomId: string,
  actorUid: string,
  media: MediaState,
): RoomPresence {
  const room = requireRoomAccess(db, roomId, actorUid)
  if (room.attendanceLocked) fail('room/locked', 'This session has already been closed.')
  const user = requireUser(db, actorUid)
  const now = new Date().toISOString()
  const list = db.presence[roomId] ?? []
  const existing = list.find((p) => p.uid === actorUid)

  const presence: RoomPresence = existing
    ? { ...existing, lastSeen: now, leftAt: null, media }
    : {
        uid: actorUid,
        displayName: user.displayName,
        avatarSeed: user.avatarSeed,
        role: actorUid === room.teacherUid ? 'teacher' : 'learner',
        joinedAt: now,
        lastSeen: now,
        leftAt: null,
        media,
      }

  db.presence[roomId] = [...list.filter((p) => p.uid !== actorUid), presence]

  const attendance = db.attendance[roomId] ?? []
  const open = attendance.find((segment) => segment.uid === actorUid && segment.leftAt === null)
  if (!open) {
    attendance.push({ uid: actorUid, joinedAt: now, leftAt: null })
    db.attendance[roomId] = attendance
  }

  if (room.status === 'scheduled') {
    room.status = 'open'
    room.openedAt = room.openedAt ?? now
  }

  persist(`presence|${roomId}`, 'rooms', 'db')
  return presence
}

export function updatePresence(
  db: LocalDatabase,
  roomId: string,
  actorUid: string,
  patch: Partial<RoomPresence>,
): void {
  const list = db.presence[roomId] ?? []
  const index = list.findIndex((p) => p.uid === actorUid)
  if (index < 0) return
  list[index] = { ...list[index], ...patch, lastSeen: new Date().toISOString() }
  db.presence[roomId] = list
  persist(`presence|${roomId}`)
}

export function leavePresence(db: LocalDatabase, roomId: string, actorUid: string): void {
  const now = new Date().toISOString()
  const list = db.presence[roomId] ?? []
  const index = list.findIndex((p) => p.uid === actorUid)
  if (index >= 0) {
    list[index] = { ...list[index], leftAt: now, lastSeen: now, media: { camera: false, microphone: false, screen: false } }
    db.presence[roomId] = list
  }
  const room = db.rooms[roomId]
  if (room && !room.attendanceLocked) {
    const attendance = db.attendance[roomId] ?? []
    const open = attendance.filter((segment) => segment.uid === actorUid && segment.leftAt === null)
    open.forEach((segment) => {
      segment.leftAt = now
    })
  }
  persist(`presence|${roomId}`, 'db')
}

export function listPresence(db: LocalDatabase, roomId: string): RoomPresence[] {
  return (db.presence[roomId] ?? []).map((p) => ({ ...p }))
}

export function startSession(db: LocalDatabase, roomId: string, actorUid: string): Room {
  const room = requireRoomAccess(db, roomId, actorUid)
  const now = new Date().toISOString()
  room.status = 'open'
  room.session.startedAt = room.session.startedAt ?? now
  room.session.initiatorUid = room.session.initiatorUid ?? actorUid
  room.openedAt = room.openedAt ?? now
  const booking = db.bookings[room.bookingId]
  if (booking && booking.status === 'confirmed') {
    booking.status = 'in_progress'
    booking.revision += 1
    booking.updatedAt = now
  }
  persist('db', `rooms|${roomId}`, `bookings|${room.teacherUid}`, `bookings|${room.learnerUid}`)
  return room
}

/* ─────────────────────── settlement (server-authority) ─────────────────────── */

function settlementReason(plan: { reason: string }): string {
  return plan.reason
}

/**
 * Idempotent settlement entry point. Mirrors `settleSession` in the Cloud
 * Functions: compute a plan, then write both ledger sides plus the settlement
 * record. Re-running it returns the existing settlement untouched.
 */
export function settleBooking(
  db: LocalDatabase,
  bookingId: string,
  createdBy: string,
  options: { force?: boolean; now?: Date } = {},
): SettlementOutcomeResult {
  const booking = requireBooking(db, bookingId)
  const config: PlatformConfig = db.config ?? DEFAULT_PLATFORM_CONFIG
  const notices: string[] = []

  if (booking.settlement.state === 'settled') {
    const existing = db.settlements[`settlement_${bookingId}`] ?? null
    return { booking, settlement: existing, notices: ['This session was already settled — no tokens moved again.'] }
  }

  const teacherWallet = db.wallets[booking.teacherUid]
  const learnerWallet = db.wallets[booking.learnerUid]
  if (!teacherWallet || !learnerWallet) fail('wallet/not-found', 'Wallet records are missing for this session.')

  const attendance: AttendanceSegment[] = db.attendance[booking.roomId ?? ''] ?? []
  const now = options.now ?? new Date()

  const plan = planSettlement({
    booking,
    config,
    attendance,
    teacherWallet,
    learnerWallet,
    confirmations: {
      teacher: Boolean(booking.completion.teacherConfirmedAt),
      learner: Boolean(booking.completion.learnerConfirmedAt),
    },
    sessionFinished: options.force || now.getTime() >= Date.parse(booking.endAt),
    now,
    requesterUid: createdBy,
  })

  if (plan.outcome === 'blocked') {
    notices.push(plan.reason)
    if (plan.blockedReason === SETTLEMENT_BLOCKED_REASONS.insufficientAttendance) {
      booking.settlement.note = plan.reason
      booking.settlement.state = 'blocked'
      persist('db', `bookings|${booking.teacherUid}`, `bookings|${booking.learnerUid}`)
    }
    return { booking, settlement: null, notices }
  }

  const reason = settlementReason(plan)
  const write = buildSettlementWrites({ booking, plan, teacher: teacherWallet, learner: learnerWallet, createdBy, reason })
  const record = buildSettlementRecord(booking, plan)

  for (const entry of write.entries) {
    db.transactions[entry.id] = {
      id: entry.id,
      type: entry.type,
      amount: entry.amount,
      direction: entry.direction,
      status: 'posted',
      uid: entry.uid,
      counterpartyUid: entry.counterpartyUid,
      bookingId: entry.bookingId,
      roomId: booking.roomId,
      idempotencyKey: entry.idempotencyKey,
      balanceAfter: entry.balanceAfter,
      reason: entry.reason,
      policyCode: entry.policyCode,
      createdBy: entry.createdBy,
      createdAt: record.createdAt,
    }
  }

  db.wallets[booking.teacherUid] = write.nextTeacher
  db.wallets[booking.learnerUid] = write.nextLearner
  db.settlements[record.id] = record

  booking.status = 'completed'
  booking.settlement = {
    state: plan.outcome === 'partial' ? 'partial' : 'settled',
    settlementId: record.id,
    settledAt: record.createdAt,
    debitTxId: write.entries[0]?.id ?? null,
    creditTxId: write.entries[1]?.id ?? null,
    refundTxId: null,
    heldTxId: booking.settlement.heldTxId,
    note: reason,
  }
  booking.completion.autoCompletedAt = booking.completion.autoCompletedAt ?? record.createdAt
  booking.completion.verifiedMinutes = plan.verifiedMinutes
  booking.completion.closedBy = booking.completion.closedBy ?? 'auto_settle'
  booking.revision += 1
  booking.updatedAt = record.createdAt

  const teacher = requireUser(db, booking.teacherUid)
  const learner = requireUser(db, booking.learnerUid)
  teacher.stats.sessionsCompleted += 1
  teacher.stats.sessionsTaught += 1
  teacher.stats.teachingHours = Math.round((teacher.stats.teachingHours + booking.durationMinutes / 60) * 10) / 10
  teacher.stats.tokensEarned = Math.round((teacher.stats.tokensEarned + plan.creditAmount) * 10_000) / 10_000
  learner.stats.sessionsCompleted += 1
  learner.stats.learningHours = Math.round((learner.stats.learningHours + booking.durationMinutes / 60) * 10) / 10
  learner.stats.tokensSpent = Math.round((learner.stats.tokensSpent + plan.debitAmount) * 10_000) / 10_000

  pushNotification(db, {
    uid: booking.teacherUid,
    type: 'session_settled',
    title: `+${plan.creditAmount} Time Token${plan.creditAmount === 1 ? '' : 's'} earned`,
    body: `${booking.skillTitle} · ${plan.verifiedMinutes} min verified. Your balance is now ${write.nextTeacher.balance}.`,
    link: '/wallet',
  })
  pushNotification(db, {
    uid: booking.learnerUid,
    type: 'session_settled',
    title: `−${plan.debitAmount} Time Token${plan.debitAmount === 1 ? '' : 's'} spent`,
    body: `${booking.skillTitle} · ${plan.verifiedMinutes} min verified. Your balance is now ${write.nextLearner.balance}.`,
    link: '/wallet',
  })

  if (booking.roomId && db.rooms[booking.roomId]) {
    const room = db.rooms[booking.roomId]
    room.status = 'closed'
    room.closedAt = record.createdAt
    room.attendanceLocked = true
  }

  notices.push(reason)
  persist(
    'db',
    `bookings|${booking.teacherUid}`,
    `bookings|${booking.learnerUid}`,
    `wallet|${booking.teacherUid}`,
    `wallet|${booking.learnerUid}`,
    'settlements',
  )
  return { booking, settlement: record, notices }
}

export function confirmCompletion(
  db: LocalDatabase,
  bookingId: string,
  actorUid: string,
): SettlementOutcomeResult {
  const booking = requireBooking(db, bookingId)
  requireParticipant(booking, actorUid)
  if (!['confirmed', 'in_progress', 'disputed'].includes(booking.status)) {
    fail('booking/invalid-state', 'Only a live or confirmed session can be marked complete.')
  }

  const now = new Date().toISOString()
  if (actorUid === booking.teacherUid) booking.completion.teacherConfirmedAt = now
  else booking.completion.learnerConfirmedAt = now

  const bothConfirmed = Boolean(booking.completion.teacherConfirmedAt && booking.completion.learnerConfirmedAt)
  const sessionFinished = Date.now() >= Date.parse(booking.endAt)
  booking.revision += 1
  booking.updatedAt = now
  persist('db', `bookings|${booking.teacherUid}`, `bookings|${booking.learnerUid}`)

  if (bothConfirmed || sessionFinished) {
    return settleBooking(db, bookingId, `user:${actorUid}`)
  }

  const counterpartyUid = actorUid === booking.teacherUid ? booking.learnerUid : booking.teacherUid
  const actor = requireUser(db, actorUid)
  pushNotification(db, {
    uid: counterpartyUid,
    type: 'session_settled',
    title: `${actor.displayName} marked the session complete`,
    body: `${booking.skillTitle} will settle as soon as you confirm, or automatically when the window closes.`,
    link: '/bookings',
  })
  return {
    booking,
    settlement: null,
    notices: ['Thanks — we will settle the tokens as soon as both sides confirm or the session window closes.'],
  }
}

export function endSession(db: LocalDatabase, roomId: string, actorUid: string): SettlementOutcomeResult {
  const room = requireRoomAccess(db, roomId, actorUid)
  const now = new Date().toISOString()
  room.status = 'closed'
  room.closedAt = now
  room.attendanceLocked = true
  room.session.endedAt = now
  room.session.durationMinutes = room.session.startedAt
    ? Math.round((Date.parse(now) - Date.parse(room.session.startedAt)) / 60_000)
    : null

  // Close any open attendance segments so settlement can measure the overlap.
  const attendance = db.attendance[roomId] ?? []
  attendance.forEach((segment) => {
    if (segment.leftAt === null) segment.leftAt = now
  })
  persist('db', `rooms|${roomId}`, `presence|${roomId}`)

  const result = settleBooking(db, room.bookingId, `user:${actorUid}`)
  return {
    ...result,
    notices: [`Session ended. ${result.notices.join(' ')}`.trim()],
  }
}

export function raiseDispute(db: LocalDatabase, bookingId: string, claim: string, actorUid: string) {
  const booking = requireBooking(db, bookingId)
  requireParticipant(booking, actorUid)
  const existing = Object.values(db.disputes).find((d) => d.bookingId === bookingId && d.openedByUid === actorUid)
  if (existing) return existing

  const id = uid('dsp')
  const now = new Date().toISOString()
  const dispute = {
    id,
    bookingId,
    openedByUid: actorUid,
    againstUid: actorUid === booking.teacherUid ? booking.learnerUid : booking.teacherUid,
    claim,
    evidence: '',
    status: 'open' as const,
    outcome: null,
    handledByUid: null,
    createdAt: now,
    updatedAt: now,
  }
  db.disputes[id] = dispute
  booking.status = 'disputed'
  booking.revision += 1
  booking.updatedAt = now

  pushNotification(db, {
    uid: dispute.againstUid,
    type: 'session_disputed',
    title: 'A session was disputed',
    body: `${booking.skillTitle}. A steward will review both sides and respond within 3 days.`,
    link: '/bookings',
    priority: 'high',
  })
  persist('db', 'disputes', `bookings|${booking.teacherUid}`, `bookings|${booking.learnerUid}`)
  return dispute
}

/* ─────────────────────────────── reviews ─────────────────────────────── */

export function createReview(db: LocalDatabase, input: CreateReviewInput): Review {
  const booking = requireBooking(db, input.bookingId)
  requireParticipant(booking, input.authorUid)
  if (booking.status !== 'completed') {
    fail('review/not-completed', 'Reviews can only be left after a session has been completed.')
  }
  const existing = Object.values(db.reviews).find(
    (r) => r.bookingId === booking.id && r.authorUid === input.authorUid,
  )
  if (existing) fail('review/duplicate', 'You have already reviewed this session.')
  if (input.rating < 1 || input.rating > 5) fail('review/invalid-rating', 'Choose a rating between 1 and 5.')

  const subjectUid = input.authorUid === booking.teacherUid ? booking.learnerUid : booking.teacherUid
  const id = uid('rev')
  const review: Review = {
    id,
    bookingId: booking.id,
    skillId: booking.skillId,
    authorUid: input.authorUid,
    subjectUid,
    authorRole: input.authorUid === booking.teacherUid ? 'teacher' : 'learner',
    rating: input.rating,
    comment: input.comment.slice(0, 2000),
    tags: input.tags ?? [],
    moderation: { state: 'clean', reason: null },
    responseText: null,
    responseAt: null,
    createdAt: new Date().toISOString(),
  }
  db.reviews[id] = review

  const subject = db.users[subjectUid]
  if (subject) {
    subject.stats.ratingSum += review.rating
    subject.stats.reviewCount += 1
  }
  const skill = db.skills[booking.skillId]
  if (skill) {
    skill.ratingSum += review.rating
    skill.reviewCount += 1
  }

  const author = requireUser(db, input.authorUid)
  pushNotification(db, {
    uid: subjectUid,
    type: 'review_received',
    title: `${author.displayName} left you a ${review.rating}-star review`,
    body: review.comment.slice(0, 140),
    link: `/members/${subjectUid}`,
  })

  persist('db', 'reviews', `users|${subjectUid}`, 'skills', `notifications|${subjectUid}`)
  return review
}

export function respondToReview(db: LocalDatabase, reviewId: string, text: string, actorUid: string): Review {
  const review = db.reviews[reviewId]
  if (!review) fail('review/not-found', 'That review could not be found.')
  if (review.subjectUid !== actorUid) fail('review/forbidden', 'Only the member who received this review can reply.')
  review.responseText = text.slice(0, 1000)
  review.responseAt = new Date().toISOString()
  persist('db', 'reviews')
  return review
}

export function listSettlements(db: LocalDatabase): SettlementRecord[] {
  return sortBy(Object.values(db.settlements), (s) => Date.parse(s.createdAt), 'desc')
}

export { bookingLifecycle, availableBalance }
