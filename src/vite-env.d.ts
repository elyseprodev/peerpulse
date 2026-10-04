/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_MODE?: 'local' | 'firebase'
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_FIREBASE_APPCHECK_SITE_KEY?: string
  readonly VITE_FIREBASE_APPCHECK_DEBUG?: string
  readonly VITE_FUNCTIONS_REGION?: string
  readonly VITE_FCM_VAPID_KEY?: string
  readonly VITE_WEBRTC_STUN_URLS?: string
  readonly VITE_WEBRTC_TURN_URLS?: string
  readonly VITE_WEBRTC_TURN_USERNAME?: string
  readonly VITE_WEBRTC_TURN_CREDENTIAL?: string
  readonly VITE_TURN_CREDENTIALS_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
