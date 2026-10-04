/**
 * Firestore ⇄ domain conversion.
 *
 * The application speaks ISO-8601 strings everywhere (so the local backend, the
 * Cloud Functions and the UI all share one representation). Firestore stores
 * native `Timestamp` values, which is what indexes and range queries need.
 *
 * Rather than scattering conversions across every call site, reads pass through
 * `fromFirestore` and writes through `toFirestore`. The write side only converts
 * strings that look like a full RFC-3339 date-time, so ordinary text fields
 * (titles, bios) can never be corrupted into timestamps.
 */
import {
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/

function isTimestampLike(value: unknown): value is Timestamp {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === 'function' &&
    typeof (value as { seconds?: unknown }).seconds === 'number'
  )
}

export function fromFirestoreValue<T = unknown>(value: unknown): T {
  if (isTimestampLike(value)) return value.toDate().toISOString() as unknown as T
  if (Array.isArray(value)) return value.map((item) => fromFirestoreValue(item)) as unknown as T
  if (value && typeof value === 'object') {
    // GeoPoint / reference-like values are passed through untouched.
    if ('latitude' in (value as object) || 'path' in (value as object)) return value as unknown as T
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = fromFirestoreValue(item)
    }
    return out as unknown as T
  }
  return value as unknown as T
}

export function toFirestoreValue(value: unknown): unknown {
  if (typeof value === 'string' && ISO_DATETIME.test(value)) return Timestamp.fromDate(new Date(value))
  if (value instanceof Date) return Timestamp.fromDate(value)
  if (Array.isArray(value)) return value.map((item) => toFirestoreValue(item))
  if (value && typeof value === 'object') {
    if (value instanceof Timestamp) return value
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue
      out[key] = toFirestoreValue(item)
    }
    return out
  }
  return value
}

export function fromSnapshot<T>(snapshot: DocumentSnapshot<DocumentData> | QueryDocumentSnapshot<DocumentData>): T | null {
  if (!snapshot.exists()) return null
  const data = fromFirestoreValue<Record<string, unknown>>(snapshot.data() ?? {})
  return { ...data, id: snapshot.id } as T
}

export function fromQuery<T>(snapshots: QueryDocumentSnapshot<DocumentData>[]): T[] {
  return snapshots.map((snapshot) => fromSnapshot<T>(snapshot)!).filter(Boolean) as T[]
}
