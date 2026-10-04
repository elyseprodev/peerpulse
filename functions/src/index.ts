/**
 * PeerPulse Cloud Functions — entry point.
 *
 * Fifteen callables, one auth trigger and one scheduled sweep. Nothing else in
 * the project can move a Time Token: the client's write surface is defined in
 * firestore.rules and deliberately excludes wallets, the ledger and every
 * lifecycle field except `disputed`.
 *
 * Environment
 * -----------
 * Provided automatically on Cloud Functions:
 *   GOOGLE_APPLICATION_CREDENTIALS
 * Optional (without them, calls fall back to STUN):
 *   TURN_URLS="turn:turn.example.org:3478?transport=udp,turns:turn.example.org:5349"
 *   TURN_STATIC_AUTH_SECRET=<coturn static-auth-secret>   (set as a secret)
 *   STUN_URLS="stun:stun.l.google.com:19302"
 *   TURN_TTL_SECONDS=3600
 *
 * Deploy:
 *   npm --prefix functions run build
 *   firebase deploy --only functions,firestore:rules,firestore:indexes,storage
 */
import { initializeAdminApp } from './lib/app'
import { Timestamp } from 'firebase-admin/firestore'
import { setGlobalOptions, logger } from 'firebase-functions/v2'
import { onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { DEFAULT_PLATFORM_CONFIG, signupGrantAmount, type PlatformConfig, type Wallet } from './shared'
import { fromSnapshot, toFirestore } from './lib/convert'
import { notifyNow } from './lib/notify'
import { COLLECTIONS, db, nowIso, requireAdmin } from './lib/refs'
import { autoSettleFinishedSessions } from './lib/settlement'

// The app is initialised by `./lib/app` — imported first by `./lib/refs`, which binds
// the Firestore client at module scope. Calling it here as well would be too late.
initializeAdminApp()

// One region for everything, so the client's single `functionsRegion` setting is
// honest. Capped lower than the default: this is a community platform, not a
// spike-driven API.
setGlobalOptions({ region: 'europe-west1', maxInstances: 20 })

/* ─────────────────────── booking + settlement lifecycle ─────────────────── */

export { createBooking, respondToBooking, confirmCompletion, settleSession } from './bookings'

/* ─────────────────────────────── video rooms ────────────────────────────── */

export { openRoom, endSession, getTurnCredentials } from './rooms'

/* ─────────────────────────── reviews + moderation ───────────────────────── */

export { createReview, resolveReport, resolveDispute } from './social'

/* ──────────────────────────────── administration ────────────────────────── */

export { adjustWallet, updatePlatformConfig, setUserRole, setUserStatus, getMetrics } from './admin'

/* ─────────────────────────────── auth provisioning ──────────────────────── */

export { onUserCreated } from './triggers'

/* ─────────────────────────── scheduled housekeeping ─────────────────────── */

/**
 * Settles sessions that finished a while ago and were never closed by hand.
 * Runs hourly; the settlement engine is idempotent, so an overlap with a manual
 * close is harmless.
 */
export const hourlySettlementSweep = onSchedule({ schedule: 'every 60 minutes', timeoutSeconds: 300 }, async () => {
  const result = await autoSettleFinishedSessions()
  logger.info('[PeerPulse] settlement sweep', result)
})

/* ──────────────────────────── health & diagnostics ──────────────────────── */

/**
 * Cheap endpoint for the deployment checklist in docs/deployment.md: proves the
 * functions are deployed, the policy document is readable and the ledger is
 * reachable — without needing an administrator account.
 */
export const healthcheck = onCall(async () => {
  const [policySnapshot, walletSample] = await Promise.all([
    db.doc(`${COLLECTIONS.config}/platform`).get(),
    db.collection(COLLECTIONS.wallets).limit(1).get(),
  ])
  const policy = fromSnapshot<PlatformConfig>(policySnapshot)
  return {
    ok: Boolean(policy),
    region: process.env.FUNCTION_REGION ?? 'europe-west1',
    policyVersion: policy?.version ?? null,
    signupGrant: policy ? signupGrantAmount(policy) : 0,
    ledgerReachable: true,
    walletSampleSize: walletSample.size,
    checkedAt: nowIso(),
  }
})

/**
 * One-off setup, run by the first administrator:
 *  1. seeds `config/platform` from `DEFAULT_PLATFORM_CONFIG` if it is missing;
 *  2. gives a wallet (and the configured signup grant) to any member who has a
 *     profile but no wallet — for example accounts created before the trigger
 *     was deployed.
 *
 * Safe to re-run: it only ever adds what is missing.
 */
export const bootstrapPlatform = onCall(async (request: CallableRequest<Record<string, never>>) => {
  // The same guard as every other administrative callable. Reading the claim
  // from the live user record instead would be stricter for one function and
  // inconsistent for the platform: a steward whose claim was removed keeps a
  // usable ID token until it expires (see docs/security.md on revocation), and
  // that window is a property of the whole admin surface, not of this one call.
  const uid = requireAdmin(request)

  const reference = db.doc(`${COLLECTIONS.config}/platform`)
  const existing = fromSnapshot<PlatformConfig>(await reference.get())
  const policy: PlatformConfig = existing ?? DEFAULT_PLATFORM_CONFIG

  if (!existing) {
    await reference.set({
      ...(toFirestore(policy) as object),
      updatedAt: Timestamp.now(),
      updatedAtIso: nowIso(),
    })
  }

  const users = await db.collection(COLLECTIONS.users).limit(500).get()
  let created = 0
  for (const document of users.docs) {
    const walletReference = db.collection(COLLECTIONS.wallets).doc(document.id)
    if ((await walletReference.get()).exists) continue

    const grant = signupGrantAmount(policy)
    const wallet: Wallet = {
      uid: document.id,
      balance: grant,
      held: 0,
      lifetimeEarned: 0,
      lifetimeSpent: 0,
      lifetimeGranted: grant,
      policyVersion: policy.version,
      updatedAt: nowIso(),
      updatedBy: `admin:${uid}`,
    }
    await walletReference.set(toFirestore(wallet) as object)
    created += 1
    await notifyNow({
      uid: document.id,
      type: 'token_grant',
      title: `${grant} welcome Time Tokens added`,
      body: 'Trade an hour of what you know for an hour of what you want to learn.',
      link: '/wallet',
    })
  }

  return { policySeeded: !existing, walletsCreated: created, ranBy: uid }
})
