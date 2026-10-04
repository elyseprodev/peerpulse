/**
 * Firebase bootstrap (browser SDK).
 *
 * Only *public* configuration lives here. Service-account keys, the TURN shared
 * secret and any other credential stay in Cloud Functions configuration or
 * Secret Manager — never in the client bundle.
 */
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { browserLocalPersistence, getAuth, setPersistence, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getFunctions, type Functions } from 'firebase/functions'
import { env } from '../../env'

let app: FirebaseApp | null = null
let auth: Auth | null = null
let firestore: Firestore | null = null
let functions: Functions | null = null
let appCheckInitialised = false

export function getFirebaseApp(): FirebaseApp {
  if (app) return app
  if (!env.firebaseConfigured) {
    throw new Error(
      'Firebase is not configured. Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID and VITE_FIREBASE_APP_ID (see .env.example).',
    )
  }
  app = getApps()[0] ?? initializeApp(env.firebase)
  return app
}

export function getFirebaseAuth(): Auth {
  if (!auth) auth = getAuth(getFirebaseApp())
  return auth
}

export function getDb(): Firestore {
  if (!firestore) firestore = getFirestore(getFirebaseApp())
  return firestore
}

export function getCallableFunctions(): Functions {
  if (!functions) functions = getFunctions(getFirebaseApp(), env.functionsRegion)
  return functions
}

/**
 * Initialise App Check when a reCAPTCHA site key is configured. Without it the
 * callables and Firestore reject requests in projects that enforce App Check —
 * which is the recommended production setting.
 */
export async function initAppCheck(): Promise<void> {
  if (appCheckInitialised || !env.appCheck.siteKey) return
  appCheckInitialised = true
  try {
    const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check')
    if (env.appCheck.debug) {
      // Allows local development against an enforced project.
      ;(self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true
    }
    initializeAppCheck(getFirebaseApp(), {
      provider: new ReCaptchaV3Provider(env.appCheck.siteKey),
      isTokenAutoRefreshEnabled: true,
    })
  } catch (error) {
    console.warn('[PeerPulse] App Check initialisation failed:', error)
  }
}

export async function initPersistence(): Promise<void> {
  try {
    await setPersistence(getFirebaseAuth(), browserLocalPersistence)
  } catch {
    /* Safari private mode etc. — session persistence still works */
  }
}

export const COLLECTIONS = {
  users: 'users',
  skills: 'skills',
  bookings: 'bookings',
  rooms: 'rooms',
  signaling: 'signaling',
  candidates: 'candidates',
  presence: 'presence',
  attendance: 'attendance',
  wallets: 'wallets',
  transactions: 'tokenTransactions',
  settlements: 'settlements',
  reviews: 'reviews',
  notifications: 'notifications',
  communities: 'communities',
  members: 'members',
  posts: 'posts',
  comments: 'comments',
  reports: 'reports',
  disputes: 'disputes',
  config: 'config',
  platform: 'platform',
} as const
