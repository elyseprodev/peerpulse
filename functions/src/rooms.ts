/**
 * Video room callables.
 *
 * The room document is the authorisation anchor for the whole call: Firestore
 * rules let only `participants` read it, publish presence in it and write into
 * its signalling subcollections. So "who may join this call" is decided once,
 * here — and inherited by every subsequent signalling message.
 */
import { createHmac } from 'node:crypto'
import { Timestamp, type DocumentData } from 'firebase-admin/firestore'
import { onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { canJoinRoom, type Booking, type Room, type SettlementOutcomeResult, type UserProfile } from './shared'
import { fromSnapshot, toFirestore } from './lib/convert'
import { COLLECTIONS, db, getRoom, requireUid } from './lib/refs'
import { fail, rethrow } from './lib/errors'
import { settleBookingTransactionally } from './lib/settlement'

interface OpenRoomPayload {
  /** `{ bookingId }` ensures a room exists; `{ roomId }` starts the session. */
  bookingId?: string
  roomId?: string
}

/**
 * Locks a room: closes the session clock, seals every open attendance segment and
 * settles. Idempotent — closing twice settles once.
 */
export const endSession = onCall(async (request: CallableRequest<{ roomId?: string }>) => {
  try {
    const uid = requireUid(request)
    const roomId = request.data?.roomId
    if (!roomId) fail('room/not-found', 'That video room does not exist.')

    const room = await getRoom(roomId)
    if (!room.participants.includes(uid)) fail('room/forbidden', 'Only the two members on this session may close the room.')

    if (room.attendanceLocked) {
      const settled = await settleBookingTransactionally(room.bookingId, { createdBy: `user:${uid}`, force: true })
      return { ...settled, notices: ['This room was already closed.', ...settled.notices] } satisfies SettlementOutcomeResult
    }

    const at = Timestamp.now()
    const now = at.toDate().toISOString()
    const attendance = await db.collection(COLLECTIONS.rooms).doc(roomId).collection(COLLECTIONS.attendance).get()

    await db.runTransaction(async (tx) => {
      // Seal open segments *before* settlement reads them, so verified minutes
      // reflect what actually happened rather than "still open now".
      for (const document of attendance.docs) {
        const segment = document.data() as { leftAt?: unknown }
        if (segment.leftAt === null || segment.leftAt === undefined) {
          tx.set(document.ref, { leftAt: at, closedByClient: false }, { merge: true })
        }
      }

      tx.set(
        db.collection(COLLECTIONS.rooms).doc(roomId),
        {
          status: 'closed',
          closedAt: at,
          attendanceLocked: true,
          closedByUid: uid,
          session: {
            ...room.session,
            endedAt: now,
            durationMinutes: room.session.startedAt
              ? Math.max(0, Math.round((at.toMillis() - Date.parse(room.session.startedAt)) / 60_000))
              : null,
          },
        },
        { merge: true },
      )
    })

    const settled = await settleBookingTransactionally(room.bookingId, { createdBy: `user:${uid}`, force: true })
    const who = uid === room.teacherUid ? 'the teacher' : 'the learner'
    return { ...settled, notices: [`Session ended by ${who}.`, ...settled.notices] } satisfies SettlementOutcomeResult
  } catch (error) {
    rethrow(error, 'endSession')
  }
})

export const openRoom = onCall(async (request: CallableRequest<OpenRoomPayload>) => {
  try {
    const uid = requireUid(request)
    const payload = request.data ?? {}

    /* ── ensure a room exists for a booking (idempotent, does not start it) ── */
    if (payload.bookingId) {
      const booking = fromSnapshot<Booking>(await db.collection(COLLECTIONS.bookings).doc(payload.bookingId).get())
      if (!booking) fail('booking/not-found', 'That booking could not be found.')
      if (!booking.participants.includes(uid)) fail('room/forbidden', 'Only the two members on this session may enter the room.')
      if (!['confirmed', 'in_progress'].includes(booking.status)) {
        fail('room/unavailable', 'The room opens once the session is confirmed.')
      }

      const roomId = booking.roomId ?? `room_${booking.id}`
      const existing = fromSnapshot<Room>(await db.collection(COLLECTIONS.rooms).doc(roomId).get())
      if (existing) return existing

      const teacher = fromSnapshot<UserProfile>(await db.collection(COLLECTIONS.users).doc(booking.teacherUid).get())
      const at = Timestamp.now()
      const room: Room = {
        id: roomId,
        bookingId: booking.id,
        skillTitle: booking.skillTitle ?? teacher?.headline ?? 'Peer session',
        teacherUid: booking.teacherUid,
        learnerUid: booking.learnerUid,
        participants: booking.participants,
        status: 'scheduled',
        createdAt: at.toDate().toISOString(),
        openedAt: null,
        closedAt: null,
        attendanceLocked: false,
        session: { startedAt: null, endedAt: null, durationMinutes: null, initiatorUid: null },
      }
      await db.collection(COLLECTIONS.rooms).doc(roomId).set(toFirestore(room) as DocumentData)
      if (!booking.roomId) {
        await db.collection(COLLECTIONS.bookings).doc(booking.id).set({ roomId }, { merge: true })
      }
      return room
    }

    /* ── start the session clock for an existing room ─────────────────────── */
    if (!payload.roomId) fail('room/not-found', 'That video room does not exist.')

    const room = await getRoom(payload.roomId)
    if (!room.participants.includes(uid)) fail('room/forbidden', 'Only the two members on this session may enter the room.')
    if (room.attendanceLocked) fail('room/locked', 'This session has already been closed.')

    const booking = fromSnapshot<Booking>(await db.collection(COLLECTIONS.bookings).doc(room.bookingId).get())
    if (!booking) fail('booking/not-found', 'That booking could not be found.')

    // A room only opens inside its join window — 15 minutes before the start by
    // default, decided by the same shared helper the UI uses.
    if (!canJoinRoom(booking)) fail('room/unavailable', 'This room opens 15 minutes before the session starts.')

    if (room.status === 'scheduled') {
      const at = Timestamp.now()
      const startedAt = room.session.startedAt ?? at.toDate().toISOString()
      await db
        .collection(COLLECTIONS.rooms)
        .doc(room.id)
        .set(
          {
            status: 'open',
            openedAt: at,
            // Nested object rather than a dotted key: the same result on real
            // Firestore, and unambiguous to every implementation of the API.
            session: {
              ...room.session,
              startedAt: toFirestore(startedAt) as unknown as string,
              initiatorUid: room.session.initiatorUid ?? uid,
            },
          },
          { merge: true },
        )

      if (booking.status === 'confirmed') {
        await db
          .collection(COLLECTIONS.bookings)
          .doc(booking.id)
          .set({ status: 'in_progress', revision: booking.revision + 1, updatedAt: at }, { merge: true })
      }

      return {
        ...room,
        status: 'open',
        openedAt: at.toDate().toISOString(),
        session: { ...room.session, startedAt, initiatorUid: room.session.initiatorUid ?? uid },
      } satisfies Room
    }

    return room
  } catch (error) {
    rethrow(error, 'openRoom')
  }
})

/* ──────────────────────────── TURN credentials ─────────────────────────── */

interface TurnServerResponse {
  iceServers: RTCIceServer[]
  expiresAt: string
  ttlSeconds: number
  turnConfigured: boolean
}

/**
 * Mints short-lived TURN credentials using the time-limited credential mechanism
 * (RFC 5766 §4.2, coturn `use-auth-secret`):
 *
 *   username   = "<unix-expiry>:<uid>"
 *   credential = base64(HMAC-SHA1(static-auth-secret, username))
 *
 * The static secret lives only in this function's environment, which is exactly
 * why the browser asks for credentials per session instead of shipping a shared
 * password in the bundle.
 *
 * Configure with:
 *   firebase functions:secrets:set TURN_STATIC_AUTH_SECRET
 *   TURN_URLS=turn:turn.example.org:3478?transport=udp,turns:turn.example.org:5349
 *   STUN_URLS=stun:stun.l.google.com:19302        (optional)
 *   TURN_TTL_SECONDS=3600                          (optional)
 */
export const getTurnCredentials = onCall(async (request: CallableRequest<Record<string, never>>) => {
  try {
    const uid = requireUid(request)
    const urls = (process.env.TURN_URLS ?? '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)
    const secret = process.env.TURN_STATIC_AUTH_SECRET ?? ''
    const ttlSeconds = Number(process.env.TURN_TTL_SECONDS ?? 3_600)
    const stunUrls = (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)

    if (!urls.length || !secret) {
      // Honest degradation: STUN alone connects most peer pairs, and the client
      // falls back to whatever it has configured locally.
      return {
        iceServers: stunUrls.map((url) => ({ urls: url })),
        expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
        ttlSeconds,
        turnConfigured: false,
      } satisfies TurnServerResponse
    }

    const expires = Math.floor(Date.now() / 1_000) + ttlSeconds
    const username = `${expires}:${uid}`
    const credential = createHmac('sha1', secret).update(username).digest('base64')

    return {
      iceServers: [...stunUrls.map((url) => ({ urls: url })), { urls, username, credential }],
      expiresAt: new Date(expires * 1_000).toISOString(),
      ttlSeconds,
      turnConfigured: true,
    } satisfies TurnServerResponse
  } catch (error) {
    rethrow(error, 'getTurnCredentials')
  }
})
