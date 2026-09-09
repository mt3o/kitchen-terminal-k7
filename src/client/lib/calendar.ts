/**
 * Calendar week maths. Pure, no DOM, no fetch — so it can be exercised with
 * `node --test` the way `wmo.ts` is, and so the display's week grid never
 * depends on anything harder to reason about than a `Date`.
 *
 * DST note: Poland moves clocks twice a year (last Sunday of March and
 * October). A day is stepped with `Date#setDate`, which operates on the
 * local calendar fields and therefore lands on the correct wall-clock
 * midnight either side of the transition. Stepping with `+24 * 3600 * 1000`
 * would land an hour off on the transition day and drift every following
 * calculation for the rest of the week — silently, since nothing throws.
 */

export interface CalendarEvent {
  id: string
  title: string
  /** ISO 8601 — either a timestamp or a bare `YYYY-MM-DD` for an all-day event. */
  start: string
  end: string
  allDay?: boolean
}

/** `YYYY-MM-DD` with no time component — Google Calendar's all-day shape. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parses an event timestamp as a local `Date`. A bare date (`2026-09-08`) is
 * read as local midnight, not UTC midnight — `new Date('2026-09-08')` parses
 * as UTC, which drifts the calendar day backwards by a whole day in any
 * timezone behind UTC and would put an all-day event under the wrong header.
 */
function parseEventDate(iso: string): Date {
  if (DATE_ONLY.test(iso)) {
    const parts = iso.split('-').map(Number)
    const y = parts[0] ?? 1970
    const m = parts[1] ?? 1
    const d = parts[2] ?? 1
    return new Date(y, m - 1, d)
  }
  return new Date(iso)
}

/** Midnight, local time, of the Monday on or before `date`. Does not mutate its argument. */
export function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = start.getDay() // 0 = Sunday .. 6 = Saturday
  const mondayOffset = (day + 6) % 7 // days since Monday
  start.setDate(start.getDate() - mondayOffset)
  return start
}

/** Seven local midnights starting at `start`, stepped a calendar day at a time (DST-safe). */
export function weekDays(start: Date): Date[] {
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    d.setDate(d.getDate() + i)
    days.push(d)
  }
  return days
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * Buckets events into the seven days of the week starting at `start`, each
 * bucket sorted by start time. An event outside the week is dropped rather
 * than smeared into the nearest edge day, and an event whose `end` precedes
 * its `start` is dropped as malformed input rather than rendered inside-out —
 * a display that runs for months will eventually see both from an upstream
 * that never gets fixed.
 */
export function groupByDay(events: CalendarEvent[], start: Date): CalendarEvent[][] {
  const days = weekDays(start)
  const buckets: CalendarEvent[][] = days.map(() => [])

  for (const event of events) {
    const eventStart = parseEventDate(event.start)
    const eventEnd = parseEventDate(event.end)
    if (Number.isNaN(eventStart.getTime()) || Number.isNaN(eventEnd.getTime())) continue
    if (eventEnd.getTime() < eventStart.getTime()) continue

    const dayIndex = days.findIndex((d) => isSameDay(d, eventStart))
    if (dayIndex === -1) continue
    buckets[dayIndex]!.push(event)
  }

  for (const bucket of buckets) {
    bucket.sort((a, b) => parseEventDate(a.start).getTime() - parseEventDate(b.start).getTime())
  }

  return buckets
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `12:00-13:30`, or `caly dzien` for an all-day event. */
export function formatRange(event: CalendarEvent): string {
  if (event.allDay) return 'caly dzien'
  const start = parseEventDate(event.start)
  const end = parseEventDate(event.end)
  const time = (d: Date): string => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  return `${time(start)}-${time(end)}`
}
