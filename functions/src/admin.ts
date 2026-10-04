/**
 * Administrative callables: roles, status, wallet adjustments, policy and the
 * platform metrics behind the admin dashboard.
 *
 * All of them require the `admin` custom claim. `setUserRole` is the only place
 * that claim is granted, and it refuses to demote the last administrator, so a
 * project cannot lock itself out of its own governance.
 */
import { Timestamp, type DocumentData } from 'firebase-admin/firestore'
import { onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { getAuth } from 'firebase-admin/auth'
import {
  DEFAULT_PLATFORM_CONFIG,
  describePolicyChange,
  roundTokens,
  type PlatformConfig,
  type TokenTransaction,
  type UserProfile,
  type UserRole,
  type UserStatus,
  type Wallet,
} from './shared'
import { fromQuery, fromSnapshot, toFirestore } from './lib/convert'
import { COLLECTIONS, db, nowIso, requireAdmin } from './lib/refs'
import { COMPOSERS, notify, notifyNow } from './lib/notify'
import { fail, rethrow } from './lib/errors'

/* ────────────────────────────── setUserRole ────────────────────────────── */

export const setUserRole = onCall(async (request: CallableRequest<{ uid?: string; role?: UserRole }>) => {
  try {
    const adminUid = requireAdmin(request)
    const { uid, role } = request.data ?? {}
    if (!uid || !role || !['member', 'admin'].includes(role)) fail('permission/denied', 'Choose a valid role.')

    const target = fromSnapshot<UserProfile>(await db.collection(COLLECTIONS.users).doc(uid).get())
    if (!target) fail('user/not-found', 'That member could not be found.')

    if (role === 'member' && target.role === 'admin') {
      const admins = await db.collection(COLLECTIONS.users).where('role', '==', 'admin').limit(2).get()
      if (admins.size <= 1) fail('permission/denied', 'This is the last administrator — promote somebody else first.')
    }

    // The custom claim and the profile must never disagree: everything in the
    // rules and functions reads the claim, the app displays the profile field.
    await getAuth().setCustomUserClaims(uid, { admin: role === 'admin' })
    await db.collection(COLLECTIONS.users).doc(uid).set({ role, updatedAt: Timestamp.now() }, { merge: true })

    await notifyNow(COMPOSERS.roleChanged(uid, role, adminUid))
    return { ...target, role }
  } catch (error) {
    rethrow(error, 'setUserRole')
  }
})

/* ───────────────────────────── setUserStatus ───────────────────────────── */

export const setUserStatus = onCall(async (request: CallableRequest<{ uid?: string; status?: UserStatus; reason?: string }>) => {
  try {
    const adminUid = requireAdmin(request)
    const { uid, status, reason } = request.data ?? {}
    if (!uid || !status || !['active', 'suspended', 'deactivated'].includes(status)) {
      fail('permission/denied', 'Choose a valid account status.')
    }
    if (uid === adminUid) fail('permission/denied', 'You cannot change your own account status.')

    const target = fromSnapshot<UserProfile>(await db.collection(COLLECTIONS.users).doc(uid).get())
    if (!target) fail('user/not-found', 'That member could not be found.')

    await db
      .collection(COLLECTIONS.users)
      .doc(uid)
      .set({ status, statusReason: (reason ?? '').slice(0, 400) || null, statusChangedByUid: adminUid, updatedAt: Timestamp.now() }, { merge: true })

    // Suspension immediately stops the account from authenticating into the app.
    if (status !== 'active') {
      await getAuth().revokeRefreshTokens(uid)
    } else {
      await getAuth().setCustomUserClaims(uid, { admin: target.role === 'admin' })
    }

    await notifyNow(COMPOSERS.accountStatusChanged(uid, status, reason ?? ''))

    return { ...target, status }
  } catch (error) {
    rethrow(error, 'setUserStatus')
  }
})

/* ────────────────────────────── adjustWallet ───────────────────────────── */

/**
 * The only way an administrator can change a balance. It writes a ledger row in
 * the same transaction, so a manual adjustment is as auditable as a settlement —
 * there is no "set balance to X" path anywhere in the system.
 */
export const adjustWallet = onCall(async (request: CallableRequest<{ uid?: string; amount?: number; reason?: string }>) => {
  try {
    const adminUid = requireAdmin(request)
    const { uid, amount, reason } = request.data ?? {}
    if (!uid) fail('user/not-found', 'That member could not be found.')

    const value = Number(amount)
    if (!Number.isFinite(value) || value === 0) fail('wallet/invalid-amount', 'Enter an amount to add or remove.')
    if (Math.abs(value) > 100) fail('wallet/invalid-amount', 'A single manual adjustment may not exceed 100 Time Tokens.')
    if (!reason || reason.trim().length < 5) fail('wallet/invalid-amount', 'A written reason is required for every adjustment.')

    const reference = db.collection(COLLECTIONS.wallets).doc(uid)
    const transactionId = `tx_admin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const at = Timestamp.now()

    const updated = await db.runTransaction(async (tx) => {
      const wallet = fromSnapshot<Wallet>(await tx.get(reference))
      if (!wallet) fail('wallet/not-found', 'That wallet could not be found.')

      const nextBalance = roundTokens(wallet.balance + value)
      if (nextBalance < 0) fail('wallet/insufficient', 'That adjustment would take the wallet below zero.')

      const row: TokenTransaction = {
        id: transactionId,
        type: 'admin_adjustment',
        amount: Math.abs(value),
        direction: value > 0 ? 'credit' : 'debit',
        status: 'posted',
        uid,
        counterpartyUid: null,
        bookingId: null,
        roomId: null,
        idempotencyKey: transactionId,
        balanceAfter: nextBalance,
        reason: reason.trim().slice(0, 400),
        policyCode: 'admin_adjustment',
        createdBy: `admin:${adminUid}`,
        createdAt: at.toDate().toISOString(),
      }

      tx.set(
        reference,
        {
          balance: nextBalance,
          lifetimeGranted: value > 0 ? roundTokens(wallet.lifetimeGranted + value) : wallet.lifetimeGranted,
          lifetimeSpent: value < 0 ? roundTokens(wallet.lifetimeSpent + Math.abs(value)) : wallet.lifetimeSpent,
          updatedAt: at,
          updatedBy: `admin:${adminUid}`,
        },
        { merge: true },
      )
      tx.set(db.collection(COLLECTIONS.transactions).doc(transactionId), { ...(toFirestore(row) as DocumentData), createdAt: at })

      notify(tx, COMPOSERS.tokenGrant(uid, value, reason))

      return { ...wallet, balance: nextBalance }
    })

    return updated satisfies Wallet
  } catch (error) {
    rethrow(error, 'adjustWallet')
  }
})

/* ─────────────────────────── updatePlatformConfig ──────────────────────── */

export const updatePlatformConfig = onCall(async (request: CallableRequest<{ patch?: Partial<PlatformConfig> }>) => {
  try {
    const adminUid = requireAdmin(request)
    const patch = request.data?.patch
    if (!patch || typeof patch !== 'object') fail('config/invalid', 'Send the policy fields you want to change.')

    const reference = db.doc(`${COLLECTIONS.config}/platform`)
    const current = fromSnapshot<PlatformConfig>(await reference.get()) ?? DEFAULT_PLATFORM_CONFIG

    // Merge section by section, so a partially-filled form cannot wipe a section.
    const next: PlatformConfig = {
      ...current,
      token: { ...current.token, ...(patch.token ?? {}) },
      booking: { ...current.booking, ...(patch.booking ?? {}) },
      settlement: { ...current.settlement, ...(patch.settlement ?? {}) },
      cancellation: { ...current.cancellation, ...(patch.cancellation ?? {}) },
      community: { ...current.community, ...(patch.community ?? {}) },
      version: patch.version?.trim() || current.version,
      updatedAt: nowIso(),
      updatedByUid: adminUid,
    }

    // Guard rails: a policy that would break the token economy cannot be saved.
    if (next.token.tokensPerHour <= 0) fail('config/invalid', 'Tokens per hour must be greater than zero.')
    if (next.token.minSessionMinutes <= 0 || next.token.maxSessionMinutes < next.token.minSessionMinutes) {
      fail('config/invalid', 'Check the minimum and maximum session lengths.')
    }
    if (next.token.roundingIncrementMinutes <= 0) fail('config/invalid', 'The rounding increment must be greater than zero.')
    if (next.cancellation.freeCancellationHours < 0 || next.cancellation.lateCancellationRefundRatio < 0 || next.cancellation.lateCancellationRefundRatio > 1) {
      fail('config/invalid', 'The cancellation refund ratio must be between 0 and 1.')
    }
    if (next.settlement.minVerifiedMinutes <= 0) fail('config/invalid', 'The attendance quorum must be greater than zero.')

    // The diff is stored on the policy so the audit trail shows what changed,
    // not just who changed it.
    const summary = describePolicyChange(current, next)
    await reference.set(
      {
        ...(toFirestore(next) as DocumentData),
        updatedAt: Timestamp.now(),
        updatedAtIso: next.updatedAt,
        changeSummary: summary,
      },
      { merge: true },
    )

    return { ...next, changeSummary: summary } as PlatformConfig & { changeSummary: string[] }
  } catch (error) {
    rethrow(error, 'updatePlatformConfig')
  }
})

/* ───────────────────────────────── getMetrics ──────────────────────────── */

export const getMetrics = onCall(async (request: CallableRequest<Record<string, never>>) => {
  try {
    requireAdmin(request)

    const [users, skills, bookings, communities, reports, wallets, settlements] = await Promise.all([
      db.collection(COLLECTIONS.users).count().get(),
      db.collection(COLLECTIONS.skills).where('status', '==', 'published').count().get(),
      db.collection(COLLECTIONS.bookings).count().get(),
      db.collection(COLLECTIONS.communities).count().get(),
      db.collection(COLLECTIONS.reports).where('status', '==', 'open').count().get(),
      db.collection(COLLECTIONS.wallets).get(),
      db.collection(COLLECTIONS.settlements).orderBy('createdAt', 'desc').limit(500).get(),
    ])

    const completed = await db.collection(COLLECTIONS.bookings).where('status', '==', 'completed').count().get()
    const disputed = await db.collection(COLLECTIONS.bookings).where('status', '==', 'disputed').count().get()

    const walletRows = fromQuery<Wallet>(wallets.docs)
    const tokensInCirculation = roundTokens(walletRows.reduce((sum, wallet) => sum + wallet.balance, 0))
    const settlementRows = fromQuery<{ tokenAmount: number; verifiedMinutes: number; status: string }>(settlements.docs)
    const tokensSettled = roundTokens(
      settlementRows.filter((row) => row.status === 'settled').reduce((sum, row) => sum + row.tokenAmount, 0),
    )
    const settledMinutes = settlementRows.reduce((sum, row) => sum + (row.verifiedMinutes ?? 0), 0)

    // Mean of the per-member aggregate rating, weighted by how many reviews each
    // member has — a member with one review should not swing the platform score.
    const rated = walletRows.length
      ? fromQuery<UserProfile>(await db.collection(COLLECTIONS.users).limit(500).get().then((snapshot) => snapshot.docs))
      : []
    const weighted = rated.reduce(
      (acc, profile) => {
        const stats = profile.stats as { ratingSum?: number; ratingCount?: number } | undefined
        const count = stats?.ratingCount ?? 0
        return { sum: acc.sum + (stats?.ratingSum ?? 0), count: acc.count + count }
      },
      { sum: 0, count: 0 },
    )

    return {
      members: users.data().count,
      activeListings: skills.data().count,
      communities: communities.data().count,
      bookings: bookings.data().count,
      completedSessions: completed.data().count,
      disputedSessions: disputed.data().count,
      tokensInCirculation,
      tokensSettled,
      hoursTraded: roundTokens(settledMinutes / 60),
      openReports: reports.data().count,
      averageRating: weighted.count ? roundTokens(weighted.sum / weighted.count) : 0,
      generatedAt: nowIso(),
    }
  } catch (error) {
    rethrow(error, 'getMetrics')
  }
})
