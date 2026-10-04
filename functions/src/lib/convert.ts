/**
 * Firestore → domain conversion (server side).
 *
 * Mirror image of src/lib/backend/firebase/convert.ts: documents hold native
 * `Timestamp`s (indexes and range queries need them) while every domain function
 * in `../shared` speaks ISO-8601 strings. Reads pass through `fromSnapshot`
 * before any business logic runs, and writes through `toFirestore` so the client
 * always sees the same representation it gets from the reference backend.
 */
import { Timestamp, type DocumentData, type DocumentSnapshot, type QueryDocumentSnapshot } from 'firebase-admin/firestore'

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
    if ('latitude' in (value as object) || 'path' in (value as object)) return value as unknown as T
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = fromFirestoreValue(item)
    }
    return out as unknown as T
  }
  return value as unknown as T
}

export function fromSnapshot<T>(snapshot: DocumentSnapshot<DocumentData> | QueryDocumentSnapshot<DocumentData>): T | null {
  if (!snapshot.exists) return null
  const data = fromFirestoreValue<Record<string, unknown>>(snapshot.data() ?? {})
  return { ...data, id: snapshot.id } as T
}

export function fromQuery<T>(snapshots: QueryDocumentSnapshot<DocumentData>[]): T[] {
  return snapshots.map((snapshot) => fromSnapshot<T>(snapshot)!).filter(Boolean) as T[]
}

export const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/

/**
 * Writes go the other way: ISO strings become Timestamps, everything else is
 * copied verbatim. Only RFC-3339 shaped strings are converted, so prose fields
 * can never be turned into timestamps by accident.
 */
export function toFirestore(value: unknown): unknown {
  if (typeof value === 'string' && ISO_DATETIME.test(value)) return Timestamp.fromDate(new Date(value))
  if (value instanceof Date) return Timestamp.fromDate(value)
  if (Array.isArray(value)) return value.map((item) => toFirestore(item))
  if (value && typeof value === 'object') {
    if (value instanceof Timestamp) return value
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue
      out[key] = toFirestore(item)
    }
    return out
  }
  return value
}

/** Converts a whole domain object (with `id` already attached) for writing. */
export function toFirestoreDocument<T extends object>(value: T): DocumentData {
  const { id: _id, ...rest } = value as T & { id?: string }
  return toFirestore(rest) as DocumentData
}
