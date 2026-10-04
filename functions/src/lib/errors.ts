import { HttpsError } from 'firebase-functions/v2/https'

/**
 * The browser adapter surfaces `BackendRequestError.code` directly in the UI, so
 * the same `namespace/reason` strings the reference backend throws are used
 * here. Keep these in step with src/lib/backend/local/*.
 */
export type ErrorCode =
  | 'permission/denied'
  | 'auth/not-signed-in'
  | 'auth/suspended'
  | 'user/not-found'
  | 'skill/not-found'
  | 'booking/not-found'
  | 'booking/forbidden'
  | 'booking/self'
  | 'booking/invalid-time'
  | 'booking/invalid-duration'
  | 'booking/invalid-window'
  | 'booking/conflict'
  | 'booking/invalid-state'
  | 'booking/duplicate'
  | 'wallet/not-found'
  | 'wallet/insufficient'
  | 'wallet/invalid-amount'
  | 'room/not-found'
  | 'room/unavailable'
  | 'room/forbidden'
  | 'room/locked'
  | 'review/not-completed'
  | 'review/duplicate'
  | 'review/invalid-rating'
  | 'review/forbidden'
  | 'report/not-found'
  | 'dispute/not-found'
  | 'community/not-found'
  | 'post/not-found'
  | 'config/invalid'
  | 'internal/error'

/** Map our codes onto gRPC statuses so clients see a sane transport error too. */
function statusFor(code: ErrorCode): HttpsError['code'] {
  if (code.startsWith('permission/')) return 'permission-denied' as HttpsError['code']
  if (code.startsWith('auth/')) return 'unauthenticated' as HttpsError['code']
  if (code.endsWith('not-found')) return 'not-found' as HttpsError['code']
  if (code === 'booking/conflict' || code === 'booking/duplicate' || code === 'review/duplicate') {
    return 'already-exists' as HttpsError['code']
  }
  if (code.startsWith('wallet/insufficient')) return 'failed-precondition' as HttpsError['code']
  return 'invalid-argument' as HttpsError['code']
}

export function fail(code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw new HttpsError(statusFor(code), message, { code, ...details })
}

/** Re-throw anything unexpected as an opaque internal error (never leak stack). */
export function rethrow(error: unknown, context: string): never {
  if (error instanceof HttpsError) throw error
  console.error(`[PeerPulse] ${context}`, error)
  throw new HttpsError('internal' as HttpsError['code'], 'Something went wrong on our side. Try again shortly.', {
    code: 'internal/error',
  })
}
