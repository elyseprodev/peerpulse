/**
 * Admin SDK bootstrap.
 *
 * This module exists because of a load-order trap that a type-check cannot see:
 *
 *   `lib/refs.ts` binds `export const db = getFirestore()` at module scope, and
 *   ES/CJS imports are evaluated *before* the body of the importing module. So
 *   calling `initializeApp()` at the top of `index.ts` is too late — every
 *   static import of `./bookings`, `./lib/settlement`, … has already run and
 *   thrown `The default Firebase app does not exist` during a cold start.
 *   Importing `firebase-functions/v2/https` does not create the app either
 *   (verified: the module loads with zero registered apps).
 *
 * Making the bootstrap the *first* thing `refs.ts` does removes the ordering
 * requirement entirely: any module may import `db` safely, in any order.
 *
 * `getApps()` keeps it idempotent, so the emulator, a warm instance and an
 * explicit `initializeApp()` elsewhere all coexist.
 */
import { getApps, initializeApp } from 'firebase-admin/app'

let bootstrapped = false

/** Initialise the default Admin app once, if nobody else has. */
export function initializeAdminApp(): void {
  if (bootstrapped || getApps().length > 0) {
    bootstrapped = true
    return
  }
  initializeApp()
  bootstrapped = true
}
