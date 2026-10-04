/**
 * Runtime environment resolution.
 *
 * `backendMode` decides whether the app talks to Firebase or to the bundled
 * in-browser reference backend (`local`). The local mode exists so the product
 * can be demonstrated and unit-tested without a cloud project; it uses the same
 * domain modules as the Cloud Functions, so business rules are identical.
 */
export type BackendMode = 'local' | 'firebase'

const rawMode = (import.meta.env.VITE_BACKEND_MODE ?? '').toLowerCase().trim()

const hasFirebaseConfig = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID && import.meta.env.VITE_FIREBASE_APP_ID,
)

export const env = {
  backendMode: (rawMode === 'firebase' ? 'firebase' : rawMode === 'local' ? 'local' : hasFirebaseConfig ? 'firebase' : 'local') as BackendMode,
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
  },
  appCheck: {
    siteKey: import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY ?? '',
    debug: (import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG ?? 'false') === 'true',
  },
  functionsRegion: import.meta.env.VITE_FUNCTIONS_REGION ?? 'europe-west1',
  fcmVapidKey: import.meta.env.VITE_FCM_VAPID_KEY ?? '',
  webrtc: {
    stunUrls: (import.meta.env.VITE_WEBRTC_STUN_URLS ?? 'stun:stun.l.google.com:19302')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    turnUrls: (import.meta.env.VITE_WEBRTC_TURN_URLS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    turnUsername: import.meta.env.VITE_WEBRTC_TURN_USERNAME ?? '',
    turnCredential: import.meta.env.VITE_WEBRTC_TURN_CREDENTIAL ?? '',
    /** `callable` = ask the `getTurnCredentials` Cloud Function for short-lived credentials. */
    turnCredentialsEndpoint: import.meta.env.VITE_TURN_CREDENTIALS_ENDPOINT ?? 'callable',
  },
  isProduction: import.meta.env.PROD,
  firebaseConfigured: hasFirebaseConfig,
} as const

export const APP_NAME = 'PeerPulse'
export const APP_TAGLINE = 'Trade Time. Share Skills. Grow Together.'
