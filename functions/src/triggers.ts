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
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import { signupGrantAmount, type PlatformConfig, type TokenTransaction, type UserProfile, type Wallet } from '../src/shared'
import { fromSnapshot, toFirestore } from './lib/convert'
import { COLLECTIONS, db, nowIso } from './lib/refs'
import { notifyNow } from './lib/notify'

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

  await notifyNow({
    uid,
    type: 'token_grant',
    title: `${grant} welcome Time Tokens added`,
    body: 'Trade an hour of what you know for an hour of what you want to learn. Publish a listing to get started.',
    link: '/wallet',
  })

  functionsV1.logger.info(`[PeerPulse] provisioned member ${uid} with ${grant} Time Token(s)`)
})
