/**
 * Backend selection.
 *
 * `VITE_BACKEND_MODE=firebase` → Firebase Auth + Firestore + Cloud Functions.
 * `VITE_BACKEND_MODE=local`    → in-browser reference backend (demo/offline/tests).
 *
 * The Firebase adapter is imported lazily so the local bundle never ships the
 * Firebase SDK.
 */
import { env } from '../env'
import type { PeerPulseBackend } from './types'

let instance: PeerPulseBackend | null = null

export async function getBackend(): Promise<PeerPulseBackend> {
  if (instance) return instance
  if (env.backendMode === 'firebase') {
    const { FirebaseBackend } = await import('./firebase')
    instance = new FirebaseBackend()
  } else {
    const { LocalBackend } = await import('./local')
    instance = new LocalBackend()
  }
  await instance.init()
  return instance
}

/** Test seam: inject a stub/fake backend without touching the environment. */
export function setBackendForTesting(backend: PeerPulseBackend | null): void {
  instance = backend
}

export * from './types'
