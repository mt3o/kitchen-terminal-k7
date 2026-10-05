/**
 * Open-Meteo: the weather upstream. Keyless, free for non-commercial use, and
 * therefore the one integration with no credential to protect.
 *
 * The trap this module exists to contain: Open-Meteo labels its timestamps
 * `iso8601` but returns **naive local wall-clock strings with no offset** —
 * `"2026-09-08T20:30"`, not `...+02:00` and not `...Z`. `new Date()` on that
 * string interprets it in the *server's* zone, which is right by accident today
 * and wrong the moment the server and the location disagree, or twice a year at
 * a DST boundary. The real offset arrives separately as `utc_offset_seconds`,
 * so every timestamp is resolved through it here and leaves this module as a
 * genuine instant.
 *
 * That matters beyond tidiness: sunrise and sunset from this response are what a
 * schedule-driven night mode would key off, and an hours-wrong sunset is a
 * kitchen that goes dark at the wrong time twice a year.
 */
import { fetchWithTimeout } from './freshness.ts'

// Overridable because Open-Meteo is self-hostable — a household that wanted to
// stop depending on someone else's rate limit could run its own — and because it
// is the only way to prove the stale-fallback path against a dead upstream
// without unplugging the house.
const ENDPOINT = process.env.K7_OPEN_METEO_URL ?? 'https://api.open-meteo.com/v1/forecast'

export interface WeatherQuery {
  latitude: number
  longitude: number
  /** IANA name, not an offset — the offset changes and the name does not. */
  timezone: string
  units?: 'metric' | 'imperial'
  forecastDays?: number
}

export interface WeatherNow {
  time: string
  temperature: number
  apparentTemperature: number
  humidity: number
  windSpeed: number
  /** WMO code; the UI maps it to a glyph and a label. */
  weatherCode: number
  isDay: boolean
}

export interface WeatherDay {
  date: string
  weatherCode: number
  temperatureMax: number
  temperatureMin: number
  /** Real instants, resolved through utc_offset_seconds. */
  sunrise: string
  sunset: string
}

/**
 * One hour of the forecast. A value Open-Meteo did not provide stays `null` —
 * the far end of the horizon drops precipitation probability first — so the
 * card can show '--' rather than a confident zero.
 */
export interface WeatherHour {
  /** Real instant, resolved through the IANA zone (see resolveLocalInstant). */
  time: string
  temperature: number | null
  /** Total, rain and snow together, as water (units.precipitation). */
  precipitation: number | null
  /** Percent. */
  precipitationProbability: number | null
  weatherCode: number | null
  /** Liquid part: Open-Meteo's `rain` + `showers`, as water. The snow part of
   *  `precipitation` is the remainder; `snowfall` is the same snow as fallen
   *  depth (units.snowfall), which is not on the precipitation scale. */
  rain: number | null
  snowfall: number | null
}

export interface Weather {
  latitude: number
  longitude: number
  timezone: string
  utcOffsetSeconds: number
  units: { temperature: string; windSpeed: string; precipitation: string; snowfall: string }
  now: WeatherNow
  daily: WeatherDay[]
  /** Every hour Open-Meteo returned (from local midnight today, forecast_days
   *  long). The card trims to the current hour itself, because a stale cached
   *  answer must drop its past hours too. Absent from answers cached before
   *  the series existed. */
  hourly: WeatherHour[]
}

export function weatherUrl(q: WeatherQuery): string {
  const imperial = q.units === 'imperial'
  const params = new URLSearchParams({
    latitude: String(q.latitude),
    longitude: String(q.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset',
    hourly: 'temperature_2m,precipitation,precipitation_probability,weather_code,rain,showers,snowfall',
    timezone: q.timezone,
    forecast_days: String(q.forecastDays ?? 5),
    temperature_unit: imperial ? 'fahrenheit' : 'celsius',
    wind_speed_unit: imperial ? 'mph' : 'kmh',
    precipitation_unit: imperial ? 'inch' : 'mm',
  })
  return `${ENDPOINT}?${params.toString()}`
}

/** Cache key. Units are part of it: the same place in °F is a different answer. */
export function weatherCacheKey(q: WeatherQuery): string {
  return `open-meteo:${q.latitude.toFixed(4)},${q.longitude.toFixed(4)}:${q.units ?? 'metric'}:${q.forecastDays ?? 5}`
}

/**
 * Turn a naive local timestamp plus an offset into a real instant.
 * Exported because it is the part most likely to be wrong, and a wrong sunset is
 * silent — it looks like a plausible time.
 */
export function resolveInstant(naive: string, utcOffsetSeconds: number): string {
  // Open-Meteo omits seconds on some fields; Date needs a complete string.
  const withSeconds = /\d{2}:\d{2}$/.test(naive) ? `${naive}:00` : naive
  const sign = utcOffsetSeconds < 0 ? '-' : '+'
  const abs = Math.abs(utcOffsetSeconds)
  const hh = String(Math.floor(abs / 3600)).padStart(2, '0')
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0')
  return new Date(`${withSeconds}${sign}${hh}:${mm}`).toISOString()
}

const HOUR_MS = 3_600_000

/** The zone's offset from UTC, in ms, at one instant. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs))
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wall - instantMs
}

/**
 * A naive local wall-clock time, resolved in an IANA zone to a real instant
 * (ms). Unlike resolveInstant, the offset is the zone's offset AT THAT TIME,
 * so hours on both sides of a DST switch come out right. For the repeated
 * hour at the end of summer time this picks the first occurrence; the hourly
 * mapping below keeps the series increasing, which places the second.
 */
export function resolveLocalInstant(naive: string, timeZone: string): number {
  const withSeconds = /\d{2}:\d{2}$/.test(naive) ? `${naive}:00` : naive
  const asUtc = Date.parse(`${withSeconds}Z`)
  // The offsets in force half a day either side cover both sides of any switch.
  const before = asUtc - zoneOffsetMs(asUtc - 12 * HOUR_MS, timeZone)
  const after = asUtc - zoneOffsetMs(asUtc + 12 * HOUR_MS, timeZone)
  // A candidate is real if the zone, at that instant, shows this wall time.
  const real = [before, after].filter((c) => zoneOffsetMs(c, timeZone) === asUtc - c)
  // Two real candidates: the repeated hour, take the first. None: the hour
  // skipped by spring-forward, read with the offset in force before it.
  return real.length > 0 ? Math.min(...real) : before
}

interface RawResponse {
  error?: boolean
  reason?: string
  latitude: number
  longitude: number
  timezone: string
  utc_offset_seconds: number
  current_units: Record<string, string>
  current: Record<string, number | string>
  daily: Record<string, (number | string)[]>
  hourly_units?: Record<string, string>
  hourly?: Record<string, (number | string | null)[]>
}

function hourlySeries(raw: RawResponse): WeatherHour[] {
  const h = raw.hourly
  if (!h?.time) return []
  const num = (key: string, i: number): number | null => {
    const v = h[key]?.[i]
    return v === null || v === undefined || v === '' ? null : Number(v)
  }
  let previous = Number.NEGATIVE_INFINITY
  return h.time.map((t, i) => {
    // Strictly increasing: the wall clock repeats an hour when summer time
    // ends, and both occurrences resolve to the first instant.
    let at = resolveLocalInstant(String(t), raw.timezone)
    if (at <= previous) at = previous + HOUR_MS
    previous = at
    const rain = num('rain', i)
    const showers = num('showers', i)
    return {
      time: new Date(at).toISOString(),
      temperature: num('temperature_2m', i),
      precipitation: num('precipitation', i),
      precipitationProbability: num('precipitation_probability', i),
      weatherCode: num('weather_code', i),
      rain: rain === null && showers === null ? null : (rain ?? 0) + (showers ?? 0),
      snowfall: num('snowfall', i),
    }
  })
}

export async function fetchWeather(q: WeatherQuery, timeoutMs?: number): Promise<Weather> {
  const res = await fetchWithTimeout(weatherUrl(q), timeoutMs)
  const raw = (await res.json()) as RawResponse
  // Open-Meteo signals a bad request with HTTP 400 plus {error, reason}; the
  // reason names the offending parameter and is worth surfacing verbatim.
  if (raw.error) throw new Error(`open-meteo rejected the request: ${raw.reason ?? 'unknown reason'}`)

  const offset = raw.utc_offset_seconds
  const day = (key: string, i: number): number => Number(raw.daily[key]?.[i] ?? Number.NaN)
  const times = raw.daily.time ?? []

  return {
    latitude: raw.latitude,
    longitude: raw.longitude,
    timezone: raw.timezone,
    utcOffsetSeconds: offset,
    units: {
      temperature: raw.current_units?.temperature_2m ?? '',
      windSpeed: raw.current_units?.wind_speed_10m ?? '',
      precipitation: raw.hourly_units?.precipitation ?? '',
      snowfall: raw.hourly_units?.snowfall ?? '',
    },
    now: {
      time: resolveInstant(String(raw.current.time), offset),
      temperature: Number(raw.current.temperature_2m),
      apparentTemperature: Number(raw.current.apparent_temperature),
      humidity: Number(raw.current.relative_humidity_2m),
      windSpeed: Number(raw.current.wind_speed_10m),
      weatherCode: Number(raw.current.weather_code),
      // is_day is 0/1, not a boolean, and `Boolean("0")` is true.
      isDay: Number(raw.current.is_day) === 1,
    },
    daily: times.map((t, i) => ({
      date: String(t),
      weatherCode: day('weather_code', i),
      temperatureMax: day('temperature_2m_max', i),
      temperatureMin: day('temperature_2m_min', i),
      sunrise: resolveInstant(String(raw.daily.sunrise?.[i] ?? ''), offset),
      sunset: resolveInstant(String(raw.daily.sunset?.[i] ?? ''), offset),
    })),
    hourly: hourlySeries(raw),
  }
}
