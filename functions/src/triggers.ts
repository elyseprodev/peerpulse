/**
 * Auth triggers.
 *
 * When Firebase Authentication creates an account, this provisioning runs *once,
 * server-side*: the profile document, the wallet carrying the configured signup
 * grant, the matching ledger row and the welcome notification. That is what makes
 * "a client never creates a Time Token" true — the browser cannot write a wallet
 * at all (see firestore.rules), so the grant has to come from here.
 *
 * Uses the v1 auth trigger because it works with plain Firebase Authentication —
 * the v2 `beforeUserCreated` blocking function would additionally require
 * upgrading the project to Identity Platform. Both APIs coexist fine in one
 * codebase.
 */
import * as functionsV1 from 'firebase-functions/v1'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import { signupGrantAmount, type Booking, type PlatformConfig, type TokenTransaction, type UserProfile, type Wallet } from '../src/shared'
import { fromSnapshot, toFirestore } from './lib/convert'
import { COLLECTIONS, db, nowIso } from './lib/refs'
import { COMPOSERS, notifyNow } from './lib/notify'

function defaultProfile(input: {
  uid: string
  email: string
  displayName: string
  photoURL: string | null
  timezone: string
}): UserProfile {
  const now = nowIso()
  return {
    uid: input.uid,
    email: input.email,
    displayName: input.displayName,
    photoURL: input.photoURL,
    avatarSeed: input.uid,
    headline: '',
    bio: '',
    location: '',
    timezone: input.timezone,
    role: 'member',
    status: 'active',
    interests: [],
    languages: ['en'],
    teachSkillIds: [],
    learnSkillIds: [],
    teachCategories: [],
    learnCategories: [],
    preferredFormats: ['video'],
    availability: [],
    privacy: {
      profileVisibility: 'public',
      showEmail: false,
      showAvailability: true,
      allowDirectRequests: true,
      appearInDiscovery: true,
    },
    stats: {
      sessionsCompleted: 0,
      sessionsTaught: 0,
      teachingHours: 0,
      learningHours: 0,
      ratingSum: 0,
      reviewCount: 0,
      tokensEarned: 0,
      tokensSpent: 0,
    },
    onboarding: { completed: false, step: 0, completedAt: null, savedAt: null, skipped: false },
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
  }
}

export const onUserCreated = functionsV1.auth.user().onCreate(async (user) => {
  const uid = user.uid
  const email = user.email ?? ''
  const displayName = user.displayName?.trim() || email.split('@')[0] || 'New member'

  const configSnapshot = await db.doc(`${COLLECTIONS.config}/platform`).get()
  const config = fromSnapshot<PlatformConfig>(configSnapshot)
  const grant = config ? signupGrantAmount(config) : 3
  const policyVersion = config?.version ?? 'unseeded'

  // Idempotent: an emulator re-run or a retried trigger cannot double-provision.
  const existing = await db.collection(COLLECTIONS.users).doc(uid).get()
  if (existing.exists) {
    functionsV1.logger.warn(`[PeerPulse] profile for ${uid} already exists — skipping provisioning`)
    return
  }

  const profile = defaultProfile({
    uid,
    email,
    displayName,
    photoURL: user.photoURL ?? null,
    timezone: 'UTC',
  })

  // A default member claim keeps `isAdmin()` false until a steward promotes them.
  await getAuth().setCustomUserClaims(uid, { admin: false })

  const now = Timestamp.now()
  const wallet: Wallet = {
    uid,
    balance: grant,
    held: 0,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
    lifetimeGranted: grant,
    policyVersion,
    updatedAt: now.toDate().toISOString(),
    updatedBy: 'system:signup',
  }

  await db.runTransaction(async (tx) => {
    tx.set(db.collection(COLLECTIONS.users).doc(uid), { ...(toFirestore(profile) as object), createdAt: now, updatedAt: now })
    tx.set(db.collection(COLLECTIONS.wallets).doc(uid), { ...(toFirestore(wallet) as object), updatedAt: now })

    if (grant > 0) {
      const grantId = `tx_signup_${uid}`
      const row: TokenTransaction = {
        id: grantId,
        type: 'signup_grant',
        amount: grant,
        direction: 'credit',
        status: 'posted',
        uid,
        counterpartyUid: null,
        bookingId: null,
        roomId: null,
        idempotencyKey: grantId,
        balanceAfter: grant,
        reason: 'Welcome grant — new members may receive introductory Time Tokens.',
        policyCode: 'signup_grant',
        createdBy: 'system:signup',
        createdAt: now.toDate().toISOString(),
      }
      tx.set(db.collection(COLLECTIONS.transactions).doc(grantId), { ...(toFirestore(row) as object), createdAt: now })
    }
  })

  await notifyNow(COMPOSERS.tokenGrant(uid, grant, 'Welcome grant — new members may receive introductory Time Tokens.', { signup: true }))

  functionsV1.logger.info(`[PeerPulse] provisioned member ${uid} with ${grant} Time Token(s)`)
})

/* ───────────────────────── community reply ───────────────────────── */

/**
 * Someone commented on a post.
 *
 * Comments and posts are written straight from the browser (the security rules
 * police them, see firestore.rules), so this is where the author learns about it.
 * The notification is skipped when the comment is the author's own.
 */
export async function notifyPostAuthorOfComment(input: {
  communityId: string
  postId: string
  authorUid: string
  body: string
}): Promise<boolean> {
  const postSnapshot = await db
    .collection(COLLECTIONS.communities)
    .doc(input.communityId)
    .collection('posts')
    .doc(input.postId)
    .get()
  const post = postSnapshot.data()
  if (!post) return false

  const recipientUid = String(post.authorUid ?? '')
  if (!recipientUid || recipientUid === input.authorUid) return false

  const authorSnapshot = await db.collection(COLLECTIONS.users).doc(input.authorUid).get()
  const authorName = String((authorSnapshot.data() as { displayName?: string } | undefined)?.displayName ?? 'A member')

  await notifyNow(
    COMPOSERS.commentReply({
      recipientUid,
      authorName,
      communityId: input.communityId,
      postId: input.postId,
      postTitle: String(post.title ?? 'your post'),
      commentBody: input.body,
    }),
  )
  return true
}

export const onCommentCreated = onDocumentCreated(
  { document: 'communities/{communityId}/posts/{postId}/comments/{commentId}', region: 'us-central1' },
  async (event) => {
    const comment = event.data?.data()
    if (!comment) return
    await notifyPostAuthorOfComment({
      communityId: event.params.communityId,
      postId: event.params.postId,
      authorUid: String(comment.authorUid ?? ''),
      body: String(comment.body ?? ''),
    })
  },
)

/* ─────────────────────────── session reminders ─────────────────────────── */

/**
 * Reminders for confirmed sessions, sent once each by the sweep that already
 * exists for auto-settlement — a scheduled function rather than a per-booking
 * timer, because Cloud Functions cannot hold state between invocations and a
 * bookmark per booking would drift against reschedules.
 *
 * The ledger for "already told" is the notification itself (`reminder_<id>` as
 * the document id), so a redeployed or retried sweep cannot send twice.
 */
export async function sendSessionReminders(now: Date = new Date()): Promise<number> {
  const windowEnd = new Date(now.getTime() + 60 * 60 * 1000)
  // `startAt` is stored as a Firestore Timestamp (`lib/convert.ts` turns ISO
  // strings into one on write), so the bounds must be Timestamps too. Comparing
  // against ISO strings compiles, deploys, and then silently matches nothing at
  // all — the failure mode this comment exists to prevent.
  const snapshot = await db
    .collection(COLLECTIONS.bookings)
    .where('status', '==', 'confirmed')
    .where('startAt', '>=', Timestamp.fromDate(now))
    .where('startAt', '<=', Timestamp.fromDate(windowEnd))
    .get()

  let sent = 0
  for (const document of snapshot.docs) {
    const booking = fromSnapshot<Booking>(document)
    if (!booking) continue
    const startsInMinutes = Math.max(0, Math.round((new Date(booking.startAt).getTime() - now.getTime()) / 60000))
    const [teacherSnapshot, learnerSnapshot] = await Promise.all([
      db.collection(COLLECTIONS.users).doc(booking.teacherUid).get(),
      db.collection(COLLECTIONS.users).doc(booking.learnerUid).get(),
    ])
    const teacherName = String((teacherSnapshot.data() as { displayName?: string } | undefined)?.displayName ?? 'your teacher')
    const learnerName = String((learnerSnapshot.data() as { displayName?: string } | undefined)?.displayName ?? 'a member')

    const recipients = [
      { uid: booking.learnerUid, name: teacherName },
      { uid: booking.teacherUid, name: learnerName },
    ]
    for (const recipient of recipients) {
      const reference = db.collection(COLLECTIONS.notifications).doc(`reminder_${document.id}_${recipient.uid}`)
      if ((await reference.get()).exists) continue
      await notifyNow(COMPOSERS.bookingReminder(booking, recipient.uid, recipient.name, startsInMinutes), reference.id)
      sent += 1
    }
  }
  return sent
}

/** Every ten minutes, so a session in the next hour is reminded in good time. */
export const sessionReminders = onSchedule(
  { schedule: 'every 10 minutes', region: 'us-central1' },
  async () => {
    const sent = await sendSessionReminders()
    functionsV1.logger.info(`[PeerPulse] session reminders sent: ${sent}`)
  },
)
