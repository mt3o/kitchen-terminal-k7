/**
 * The weather card's hourly forecast, as text: the strip on the standard card
 * and the two ASCII graphs (temperature, precipitation) the card draws when it
 * is maximized or presented by the Slideshow.
 *
 * Pure on purpose: no DOM, no Svelte, no clock of its own. The component
 * measures how many character cells it has and passes them in, together with
 * "now" and the zone to label hours in, so every rule here is testable under
 * `node --test` and the same input always draws the same rows.
 *
 * Three rules shape the output.
 *
 * - **7-bit ASCII only.** Themes swap `monoFontFamily`, and only plain ASCII is
 *   guaranteed to hold one cell width in every fallback face — the same rule
 *   wmo.ts's art follows. That is why values carry no `°` and no unit: units
 *   live in the header, which the component renders as ordinary text.
 * - **Honest lengths.** Temperature is a point `o` on the window's min..max,
 *   not a bar (a bar from the minimum makes the coldest hour look like
 *   nothing). Precipitation is a bar on a FIXED scale — 4 mm/h fills it — not
 *   one stretched to the window's maximum, which would turn a 0.1 mm hour on a
 *   dry day into a downpour. Past the end the bar is capped and ends in `>`.
 * - **Glyph, not colour, tells rain from snow.** `#` is rain (Open-Meteo's
 *   rain + showers), `*` is the rest of the water. Each segment carries a role
 *   the component maps to a token, but the glyph alone must carry the meaning.
 */

// Type-only, erased at build: the card is coded against the exact shape #87's
// /api/weather returns, so a change there fails the typecheck here.
import type { WeatherHour } from '../../server/upstream/open-meteo.ts'

export type { WeatherHour }

const HOUR_MS = 3_600_000

/** How far ahead the graphs reach. */
export const HORIZON_HOURS = 72

/** Cell count per graph before the component has measured anything (the phone's). */
export const DEFAULT_CELLS = 10

/** Weekdays folded to ASCII, indexed by `Date#getUTCDay()`. Fixed, never from ICU,
 *  so a separator reads the same on every machine. */
const WEEKDAYS = ['NIEDZ', 'PON', 'WT', 'SR', 'CZW', 'PT', 'SOB'] as const

// --- time ------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>()

/** One formatter per zone: building them is not free on an A8X, and a graph
 *  asks for 72 labels per refresh. */
function partsIn(timeZone: string, ms: number): { year: number; month: number; day: number; hour: number } {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('pl-PL', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, f)
  }
  const get = (type: string): number => Number(f.formatToParts(new Date(ms)).find((p) => p.type === type)?.value)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24 }
}

const two = (n: number): string => String(n).padStart(2, '0')

/** The hour of an instant on the zone's wall clock, `00`–`23`. */
export function hourLabel(ms: number, timeZone: string): string {
  return two(partsIn(timeZone, ms).hour)
}

/** `-- PON 06.10 --`: the day that starts at this instant, in the zone. */
export function dayLabel(ms: number, timeZone: string): string {
  const { year, month, day } = partsIn(timeZone, ms)
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  return `-- ${weekday} ${two(day)}.${two(month)} --`
}

function dayKey(ms: number, timeZone: string): string {
  const { year, month, day } = partsIn(timeZone, ms)
  return `${year}-${month}-${day}`
}

// --- the window ------------------------------------------------------------

/**
 * The hours from the one containing `nowMs` onward, at most `limit` of them.
 *
 * The server sends 120 hours from local midnight and keeps serving its last
 * good answer when Open-Meteo is down, so the card trims here, against a clock
 * the card advances on every refresh attempt — a stale answer drops its past
 * hours too. Tolerates the field being absent (an answer cached before the
 * series existed) and skips any hour whose time does not parse.
 */
export function upcomingHours(
  hourly: readonly WeatherHour[] | null | undefined,
  nowMs: number,
  limit: number = HORIZON_HOURS,
): WeatherHour[] {
  if (!Array.isArray(hourly)) return []
  const out: WeatherHour[] = []
  for (const h of hourly) {
    const t = Date.parse(h.time)
    if (!Number.isFinite(t) || t + HOUR_MS <= nowMs) continue
    out.push(h)
    if (out.length >= limit) break
  }
  return out
}

/** True when any hour of the slice actually shown has rain or snow. */
export function hasPrecipitation(hours: readonly WeatherHour[]): boolean {
  return hours.some((h) => (h.precipitation ?? 0) > 0)
}

// --- the strip -------------------------------------------------------------

export interface StripCell {
  /** `00`–`23`, in the zone. */
  hour: string
  /** Rounded figure without a unit, or `--`. */
  temp: string
  /** Rounded percent without the sign, or `--` when it was not provided. */
  pct: string
}

/**
 * The standard card's strip: the next `n` full hours. The hour containing
 * `nowMs` is left out, because the readout above the strip already is "now".
 */
export function stripCells(
  hours: readonly WeatherHour[] | null | undefined,
  n: number,
  timeZone: string,
  nowMs: number,
): StripCell[] {
  if (!Array.isArray(hours)) return []
  const out: StripCell[] = []
  for (const h of hours) {
    const t = Date.parse(h.time)
    if (!Number.isFinite(t) || t <= nowMs) continue
    out.push({ hour: hourLabel(t, timeZone), temp: figure(h.temperature), pct: figure(h.precipitationProbability) })
    if (out.length >= n) break
  }
  return out
}

function figure(n: number | null): string {
  return n === null || !Number.isFinite(n) ? '--' : String(Math.round(n))
}

// --- the graphs ------------------------------------------------------------

export type Role = 'hour' | 'marker' | 'value' | 'rain' | 'snow' | 'pct' | 'muted' | 'separator'

export interface Segment {
  text: string
  role: Role
}

export type Line = Segment[]

/** Full width of the precipitation bar, per hour, in the response's unit. */
export function precipScale(unit: string): { full: number; label: string } {
  return /^in/i.test(unit.trim()) ? { full: 0.16, label: 'in/h' } : { full: 4, label: 'mm/h' }
}

export interface GraphOptions {
  timeZone: string
  /** `units.precipitation` from the response (`mm` or `inch`); empty reads as mm. */
  unit: string
  tempCells: number
  precipCells: number
  /** The millimetre (or inch) figure after each bar. Dropped on a phone. */
  showMm: boolean
  /** The probability after each bar. Kept on a phone. */
  showPct: boolean
  /** Lines to paint, separators included; omitted = every hour given. */
  maxLines?: number
}

interface Shown {
  chosen: { hour: WeatherHour; t: number; separator: boolean }[]
  /** The temperature scale the points are placed on (null when no hour had one). */
  tempMin: number | null
  tempMax: number | null
}

/**
 * Which hours fit the line budget, and the temperature scale they span. Shared
 * by graphRows and graphHeader, so the header's min..max is always the scale
 * of the rows actually painted.
 *
 * `maxLines` is a budget of LINES: a separator spends one, so 24 hours that
 * cross midnight fit in 24 lines only as 23 hours. A separator is never the
 * last line painted.
 */
function shownHours(hours: readonly WeatherHour[], timeZone: string, maxLines: number | undefined): Shown {
  const budget = maxLines ?? Number.POSITIVE_INFINITY
  const chosen: Shown['chosen'] = []
  let used = 0
  let previousDay: string | undefined
  for (const hour of hours) {
    const t = Date.parse(hour.time)
    if (!Number.isFinite(t)) continue
    const day = dayKey(t, timeZone)
    const separator = previousDay !== undefined && day !== previousDay
    const cost = separator ? 2 : 1
    if (used + cost > budget) break
    chosen.push({ hour, t, separator })
    used += cost
    previousDay = day
  }
  const temps = chosen.map((c) => c.hour.temperature).filter((v): v is number => v !== null && Number.isFinite(v))
  return {
    chosen,
    tempMin: temps.length > 0 ? Math.min(...temps) : null,
    tempMax: temps.length > 0 ? Math.max(...temps) : null,
  }
}

/** The hours graphRows would paint under these options — what `hasPrecipitation` should look at. */
export function shownSlice(hours: readonly WeatherHour[], opts: GraphOptions): WeatherHour[] {
  return shownHours(hours, opts.timeZone, opts.maxLines).chosen.map((c) => c.hour)
}

/**
 * The two graphs as lines of text, time running down: one line per hour,
 * reading across hour -> temperature -> precipitation, plus a separator line
 * where the local day changes. The first hour line is marked `>` (the log
 * prefix of DESIGN.md §13). Callers pass hours from `upcomingHours`, so that
 * line is the current hour.
 *
 *     > 14      o   15  ##          1.2   70
 *     -- NIEDZ 25.10 --
 *       00  o        8  ##**        1.0   70
 */
export function graphRows(hours: readonly WeatherHour[], opts: GraphOptions): Line[] {
  const tempCells = Math.max(1, Math.floor(opts.tempCells))
  const precipCells = Math.max(1, Math.floor(opts.precipCells))
  const { chosen, tempMin, tempMax } = shownHours(hours, opts.timeZone, opts.maxLines)
  const scale = precipScale(opts.unit)
  const inch = scale.label === 'in/h'

  const lines: Line[] = []
  chosen.forEach(({ hour, t, separator }, i) => {
    if (separator) lines.push([{ text: dayLabel(t, opts.timeZone), role: 'separator' }])
    const line: Line = []
    push(line, i === 0 ? '> ' : '  ', i === 0 ? 'marker' : 'muted')
    push(line, hourLabel(t, opts.timeZone), 'hour')
    push(line, ' ', 'muted')
    tempTrack(line, hour.temperature, tempMin, tempMax, tempCells)
    push(line, ' ', 'muted')
    push(line, figure(hour.temperature).padStart(3), hour.temperature === null ? 'muted' : 'value')
    push(line, '  ', 'muted')
    precipBar(line, hour, scale.full, precipCells)
    if (opts.showMm) {
      push(line, ' ', 'muted')
      const p = hour.precipitation
      if (p === null || !Number.isFinite(p)) push(line, '--'.padStart(4), 'muted')
      else if (p <= 0) push(line, '    ', 'muted')
      else push(line, amount(p, inch).padStart(4), 'value')
    }
    if (opts.showPct) {
      push(line, ' ', 'muted')
      const p = hour.precipitationProbability
      if (p === null || !Number.isFinite(p)) push(line, '--'.padStart(4), 'muted')
      else push(line, String(Math.round(p)).padStart(4), Math.round(p) === 0 ? 'muted' : 'pct')
    }
    lines.push(line)
  })
  return lines
}

export interface HeaderOptions extends GraphOptions {
  /** Hours the window covers (24 presenting, 72 maximized), for "brak w ciagu N h". */
  windowHours: number
}

/**
 * The column header over graphRows, on the same geometry, so every label sits
 * over its column. Two lines: the column labels (the temperature label carries
 * the min..max of the hours actually painted), then either the glyph legend or,
 * when nothing falls in the painted hours, `OPADY // brak w ciagu N h`, so an
 * empty bar column reads as a fact rather than a broken chart.
 *
 *     GODZ TEMP 6..16     OPADY 0..4 mm/h    %
 *     # deszcz  * snieg
 */
export function graphHeader(hours: readonly WeatherHour[], opts: HeaderOptions): Line[] {
  const tempCells = Math.max(1, Math.floor(opts.tempCells))
  const precipCells = Math.max(1, Math.floor(opts.precipCells))
  const { chosen, tempMin, tempMax } = shownHours(hours, opts.timeZone, opts.maxLines)
  const scale = precipScale(opts.unit)
  const range = tempMin === null || tempMax === null ? '' : `${Math.round(tempMin)}..${Math.round(tempMax)}`
  const bar = `0..${scale.full} ${scale.label}`

  const labels: Line = []
  push(labels, 'GODZ ', 'hour')
  push(labels, fit([range && `TEMP ${range}`, range, 'TEMP'], tempCells + 4), 'hour')
  push(labels, '  ', 'muted')
  push(labels, fit([`OPADY ${bar}`, bar, 'OPADY'], precipCells + (opts.showMm ? 5 : 0)), 'hour')
  if (opts.showPct) push(labels, '    %', 'hour')

  const second: Line = []
  if (chosen.some((c) => (c.hour.precipitation ?? 0) > 0)) {
    push(second, '#', 'rain')
    push(second, ' deszcz  ', 'hour')
    push(second, '*', 'snow')
    push(second, ' snieg', 'hour')
  } else {
    push(second, `OPADY // brak w ciagu ${opts.windowHours} h`, 'muted')
  }
  return [trimEnd(labels), second]
}

/** The first candidate that fits `width`, padded to it; the shortest, cut, if none does. */
function fit(candidates: string[], width: number): string {
  const usable = candidates.filter((c) => c.length > 0)
  const chosen = usable.find((c) => c.length <= width) ?? (usable[usable.length - 1] ?? '').slice(0, width)
  return chosen.padEnd(width)
}

/** Trailing padding is noise in a <pre>; drop it from the last segment. */
function trimEnd(line: Line): Line {
  const last = line[line.length - 1]
  if (last) last.text = last.text.replace(/ +$/, '')
  return line.filter((s) => s.text.length > 0)
}

/** Append, merging into the previous segment when the role is the same. */
function push(line: Line, text: string, role: Role): void {
  const last = line[line.length - 1]
  if (last && last.role === role) last.text += text
  else line.push({ text, role })
}

function tempTrack(line: Line, temp: number | null, min: number | null, max: number | null, cells: number): void {
  if (temp === null || !Number.isFinite(temp) || min === null || max === null) {
    push(line, ' '.repeat(cells), 'muted')
    return
  }
  // A flat window (min = max) has no scale to place on: sit in the middle
  // rather than divide by zero.
  const at = max > min ? Math.round(((temp - min) / (max - min)) * (cells - 1)) : Math.floor((cells - 1) / 2)
  push(line, ' '.repeat(at), 'muted')
  push(line, 'o', 'marker')
  push(line, ' '.repeat(cells - 1 - at), 'muted')
}

function precipBar(line: Line, hour: WeatherHour, full: number, cells: number): void {
  const total = hour.precipitation
  if (total === null || !Number.isFinite(total) || total <= 0) {
    push(line, ' '.repeat(cells), 'muted')
    return
  }
  // The rain share is the liquid part; the snow share is what is left of the
  // water. A missing split draws everything as rain — snow is never inferred
  // from an absence. `snowfall` (depth, cm) is a different quantity and is
  // deliberately not read here.
  const rain = hour.rain === null || !Number.isFinite(hour.rain) ? total : Math.min(Math.max(hour.rain, 0), total)
  const snow = hour.rain === null || !Number.isFinite(hour.rain) ? 0 : Math.max(0, total - hour.rain)
  const capped = total > full
  // Any measurable amount gets at least one glyph: the figure beside it (or
  // its absence on a phone) says how much, but a wet hour must not look dry.
  const length = capped ? cells : Math.min(cells, Math.max(1, Math.round((total / full) * cells)))
  const body = capped ? length - 1 : length
  let rainCells = rain + snow > 0 ? Math.round((body * rain) / (rain + snow)) : body
  // Both kinds fell and there is room for both: show both, whatever rounding says.
  if (rain > 0 && snow > 0 && body >= 2) rainCells = Math.min(body - 1, Math.max(1, rainCells))
  const snowCells = body - rainCells
  push(line, '#'.repeat(rainCells), 'rain')
  push(line, '*'.repeat(snowCells), 'snow')
  if (capped) push(line, '>', rain >= snow ? 'rain' : 'snow')
  push(line, ' '.repeat(cells - length), 'muted')
}

function amount(value: number, inch: boolean): string {
  if (inch) return value.toFixed(2)
  return value < 10 ? value.toFixed(1) : String(Math.round(value))
}

/**
 * Split a measured width (in character columns) between the two graphs.
 * Everything but the two tracks is fixed: prefix 2, hour 2, three single
 * spaces, the temperature figure 3, the gap 2, and 5 each for the optional mm
 * and probability columns. Below 40 columns the mm figure is dropped first —
 * the bar already carries the amount — and the probability is kept.
 */
export function fitCells(
  columns: number,
  want: { showMm: boolean; showPct: boolean },
): { tempCells: number; precipCells: number; showMm: boolean; showPct: boolean } {
  const fixed = 2 + 2 + 1 + 1 + 3 + 2
  const showPct = want.showPct
  const showMm = want.showMm && columns >= 40
  const free = Math.floor(columns) - fixed - (showMm ? 5 : 0) - (showPct ? 5 : 0)
  const tempCells = Math.max(4, Math.floor(free / 2))
  const precipCells = Math.max(4, free - tempCells)
  return { tempCells, precipCells, showMm, showPct }
}

/** The text of a line, for measuring and for tests. */
export function lineText(line: Line): string {
  return line.map((s) => s.text).join('')
}
