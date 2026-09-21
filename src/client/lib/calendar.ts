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
  /** Which configured `Calendar` this came from — set once fetched, so a merged main-tab bucket can still attribute each event for the colour tick. */
  calendarId?: string
}

export type CalendarSource = { mode: 'google'; calendarId: string } | { mode: 'ics'; url: string }

/** A configured calendar source for this card — one tab, one fetch. Mirrors the server's own `Calendar`/`CalendarSource` (`domain/types.ts`); declared separately per this project's no-client-imports-server-types precedent. */
export interface Calendar {
  id: string
  name: string
  source: CalendarSource
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

/**
 * Which events feed the day grid for the given tab selection. `'main'`
 * merges every calendar whose id is in `mainIds` (the layout's
 * `mainCalendars`); any other tab shows only that one calendar, whether or
 * not it is in `mainIds` (`[node:53a1b84b]`'s per-calendar-fetch decision;
 * the merge itself is this function). With a single configured calendar
 * there is no tab strip at all (`calendar-tabs` deck, `single-calendar`
 * state) — its own events show unconditionally, since `mainIds` only
 * matters once there is a choice between calendars to make.
 */
export function selectEventsForTab(
  calendars: Calendar[],
  mainIds: string[],
  eventsByCalendar: Record<string, CalendarEvent[]>,
  selectedTab: string,
): CalendarEvent[] {
  if (calendars.length <= 1) {
    const only = calendars[0]
    return only ? (eventsByCalendar[only.id] ?? []) : []
  }
  if (selectedTab === 'main') {
    return calendars.filter((c) => mainIds.includes(c.id)).flatMap((c) => eventsByCalendar[c.id] ?? [])
  }
  return eventsByCalendar[selectedTab] ?? []
}

const pad2Date = (n: number): string => String(n).padStart(2, '0')

/** `error:<calendarId>:<date>` — enough to recognise a synthetic placeholder without a new field. */
export function syntheticErrorEventId(calendarId: string, dateIso: string): string {
  return `error:${calendarId}:${dateIso}`
}

/**
 * One synthetic all-day "load error" placeholder per day of the week, for a
 * calendar with no cache to fall back to at all (`calendar-tabs` deck,
 * `degraded — no cache ever` state, `[node:855ab1c4]`). Scoped to that
 * calendar's own bucket only — reuses the existing event markup, no new
 * error component.
 */
export function syntheticErrorWeek(calendarId: string, weekStart: Date): CalendarEvent[] {
  return weekDays(weekStart).map((day) => {
    const iso = `${day.getFullYear()}-${pad2Date(day.getMonth() + 1)}-${pad2Date(day.getDate())}`
    return {
      id: syntheticErrorEventId(calendarId, iso),
      title: 'blad wczytywania',
      start: iso,
      end: iso,
      allDay: true,
      calendarId,
    }
  })
}

export function isSyntheticErrorEvent(event: CalendarEvent): boolean {
  return event.id.startsWith('error:')
}

/**
 * Hue bands reserved for meaning — amber (accent/ink), warn, fail/danger,
 * and signal (teal) — computed from the theme's own real hue values
 * (`design-system/themes/retro-scifi.yaml`, all three luminance modes;
 * accent/warn/danger cluster at roughly 5-40°, signal at roughly 155-165°),
 * not guessed, each with a safety margin. A calendar tick never lands in
 * either band (WARNNOTAMBER's own hue-separation reasoning, `[node:79662ce5]`,
 * `[node:ff852de4]`, applied to an unbounded set instead of a fixed palette).
 */
const RESERVED_HUE_BANDS: readonly (readonly [number, number])[] = [
  [0, 50],
  [145, 180],
]

function usableHueArcs(): { start: number; end: number }[] {
  const sorted = [...RESERVED_HUE_BANDS].sort((a, b) => a[0] - b[0])
  const arcs: { start: number; end: number }[] = []
  let cursor = 0
  for (const [start, end] of sorted) {
    if (start > cursor) arcs.push({ start: cursor, end: start })
    cursor = Math.max(cursor, end)
  }
  if (cursor < 360) arcs.push({ start: cursor, end: 360 })
  return arcs
}

/**
 * Position in `[0, 1)` mapped onto the hue wheel with the reserved bands
 * excised and the remaining arcs concatenated, so consecutive positions
 * never straddle a gap the way a naive `position * 360` would.
 */
function hueAt(position: number): number {
  const arcs = usableHueArcs()
  const total = arcs.reduce((sum, a) => sum + (a.end - a.start), 0)
  let target = (((position % 1) + 1) % 1) * total
  for (const arc of arcs) {
    const len = arc.end - arc.start
    if (target < len) return arc.start + target
    target -= len
  }
  return arcs[arcs.length - 1]?.end ?? 0
}

/**
 * One hue per calendar, evenly spaced across the usable hue wheel. Not
 * drawn from a fixed token set — the number of configured calendars is
 * arbitrary and unknown at theme-build time, so this interpolates smoothly
 * as calendars are added rather than running out of a small fixed palette
 * (per the wireframe session's own ruling on this). `total<=1` still
 * returns a real, stable first hue rather than a degenerate case, so a
 * second calendar added later never reshuffles the first one's colour.
 */
export function calendarTickHue(index: number, total: number): number {
  return hueAt(total <= 1 ? 0 : index / total)
}

export type ThemeLuminanceMode = 'light' | 'dark' | 'night'

/**
 * Saturation/lightness per luminance mode, chosen so the tick clears the
 * 3:1 CONTRASTFLOORS non-text floor against `--surface-sunken` (the
 * event box's own background) across the *entire* allowed hue range —
 * verified numerically against retro-scifi.yaml's real surfaceSunken
 * values (light #efece4, dark #18140d, night #030201) at every 5° of hue,
 * not guessed: worst case clears 3.7:1 (dark/night) to 4.4:1 (light) with
 * margin. One lightness per mode because the same lightness does not clear
 * the floor against both a light and a dark surface.
 */
const TICK_SATURATION = 0.55
const TICK_LIGHTNESS: Record<ThemeLuminanceMode, number> = { light: 0.28, dark: 0.62, night: 0.58 }

/** Standard HSL→RGB, formatted as `#rrggbb` — never the `hsl()` function syntax itself, which the token contract bans outright in this directory. */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const toHex = (v: number): string => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function calendarTickColor(index: number, total: number, mode: ThemeLuminanceMode = 'dark'): string {
  return hslToHex(calendarTickHue(index, total), TICK_SATURATION, TICK_LIGHTNESS[mode])
}
