/**
 * Server-side formatting for notification copy.
 *
 * Deliberately self-contained (no locale data beyond `en-GB` UTC) because
 * functions run in a different environment from the browser and the numbers in a
 * notification must not drift with the reader's timezone. Members see their own
 * local time in the app; the notification says which zone it used.
 */
const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
}

export function formatDateTimeRange(startAt: string, endAt: string): string {
  const start = new Date(startAt)
  const end = new Date(endAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Invalid time'
  const sameDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10)
  const startLabel = new Intl.DateTimeFormat('en-GB', DATE_TIME).format(start)
  const endLabel = sameDay
    ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(end)
    : new Intl.DateTimeFormat('en-GB', DATE_TIME).format(end)
  return `${startLabel}–${endLabel} UTC`
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
