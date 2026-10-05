/**
 * The Open-Meteo adapter's hourly series (k7-weather-hourly).
 *
 * Open-Meteo returns naive local wall-clock strings plus ONE
 * `utc_offset_seconds` — the offset at request time. A five-day hourly series
 * crosses a DST change for several days a year, and resolving every hour
 * through that one offset labels each hour after the switch an hour wrong.
 * The hourly series is therefore resolved through the IANA zone, timestamp by
 * timestamp, and kept strictly increasing so the repeated wall-clock hour at
 * the end of summer time stays two hours rather than collapsing into one.
 *
 * Shapes below follow a live response taken 2026-10-05 (hourly_units:
 * precipitation mm, rain mm, showers mm, snowfall cm, precipitation_probability %).
 */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'

let server: Server
let body: unknown = {}
let lastUrl = ''
let mod: typeof import('../src/server/upstream/open-meteo.ts')

before(async () => {
  server = createServer((req, res) => {
    lastUrl = req.url ?? ''
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  // The adapter reads its endpoint once, at import.
  process.env.K7_OPEN_METEO_URL = `http://127.0.0.1:${port}/v1/forecast`
  mod = await import('../src/server/upstream/open-meteo.ts')
})

after(() => server.close())

const QUERY = { latitude: 52.2297, longitude: 21.0122, timezone: 'Europe/Warsaw' }

function response(hourly: Record<string, unknown[]>, offset = 7200): unknown {
  return {
    latitude: 52.23,
    longitude: 21.02,
    timezone: 'Europe/Warsaw',
    utc_offset_seconds: offset,
    current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h' },
    current: {
      time: '2026-10-05T14:15', temperature_2m: 14, apparent_temperature: 12,
      relative_humidity_2m: 70, wind_speed_10m: 9, weather_code: 3, is_day: 1,
    },
    daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], sunrise: [], sunset: [] },
    hourly_units: { precipitation: 'mm', rain: 'mm', showers: 'mm', snowfall: 'cm', precipitation_probability: '%' },
    hourly,
  }
}

function series(times: string[], extra: Partial<Record<string, unknown[]>> = {}): Record<string, unknown[]> {
  const n = times.length
  const fill = (v: unknown): unknown[] => Array.from({ length: n }, () => v)
  return {
    time: times,
    temperature_2m: fill(10),
    precipitation: fill(0),
    precipitation_probability: fill(0),
    weather_code: fill(3),
    rain: fill(0),
    showers: fill(0),
    snowfall: fill(0),
    ...extra,
  }
}

describe('weatherUrl asks for the hourly series', () => {
  it('requests every hourly variable the card draws, including the rain/snow split', () => {
    const url = new URL(mod.weatherUrl(QUERY))
    const hourly = (url.searchParams.get('hourly') ?? '').split(',')
    for (const v of ['temperature_2m', 'precipitation', 'precipitation_probability', 'weather_code', 'rain', 'showers', 'snowfall']) {
      assert.ok(hourly.includes(v), `hourly must request ${v}`)
    }
  })

  it('asks for precipitation in the unit system the card shows', () => {
    assert.equal(new URL(mod.weatherUrl(QUERY)).searchParams.get('precipitation_unit'), 'mm')
    assert.equal(new URL(mod.weatherUrl({ ...QUERY, units: 'imperial' })).searchParams.get('precipitation_unit'), 'inch')
  })
})

describe('fetchWeather returns the hourly series', () => {
  it('maps each hour to a real instant with its values, rain = rain + showers', async () => {
    body = response(series(['2026-10-05T14:00', '2026-10-05T15:00'], {
      temperature_2m: [14.2, 13.9],
      precipitation: [1.6, 0],
      precipitation_probability: [80, 10],
      weather_code: [61, 3],
      rain: [1.0, 0],
      showers: [0.5, 0],
      snowfall: [0.07, 0],
    }))
    const w = await mod.fetchWeather(QUERY)
    assert.match(lastUrl, /hourly=/)
    assert.deepEqual(w.hourly[0], {
      time: '2026-10-05T12:00:00.000Z',
      temperature: 14.2,
      precipitation: 1.6,
      precipitationProbability: 80,
      weatherCode: 61,
      rain: 1.5,
      snowfall: 0.07,
    })
    assert.equal(w.hourly.length, 2)
    assert.deepEqual(w.units.precipitation, 'mm')
    assert.deepEqual(w.units.snowfall, 'cm')
  })

  it('keeps a missing value as null, never as a number', async () => {
    body = response(series(['2026-10-05T14:00'], { precipitation_probability: [null], temperature_2m: [null] }))
    const [h] = (await mod.fetchWeather(QUERY)).hourly
    assert.equal(h?.precipitationProbability, null)
    assert.equal(h?.temperature, null)
  })

  it('resolves hours after the autumn DST switch through the zone, not the request-time offset', async () => {
    // Europe/Warsaw, 2026-10-25: 03:00 CEST becomes 02:00 CET. Request made
    // in summer time (offset +7200); the wall clock repeats 02:00.
    body = response(series(['2026-10-25T00:00', '2026-10-25T01:00', '2026-10-25T02:00', '2026-10-25T02:00', '2026-10-25T03:00', '2026-10-25T12:00']), 7200)
    const times = (await mod.fetchWeather(QUERY)).hourly.map((h) => h.time)
    assert.deepEqual(times, [
      '2026-10-24T22:00:00.000Z',
      '2026-10-24T23:00:00.000Z',
      '2026-10-25T00:00:00.000Z',
      '2026-10-25T01:00:00.000Z',
      '2026-10-25T02:00:00.000Z',
      '2026-10-25T11:00:00.000Z',
    ])
  })

  it('resolves hours after the spring DST switch through the zone', async () => {
    // Europe/Warsaw, 2027-03-28: 02:00 CET becomes 03:00 CEST; 02:00 never happens.
    body = response(series(['2027-03-28T00:00', '2027-03-28T01:00', '2027-03-28T03:00', '2027-03-28T12:00']), 3600)
    const times = (await mod.fetchWeather(QUERY)).hourly.map((h) => h.time)
    assert.deepEqual(times, [
      '2027-03-27T23:00:00.000Z',
      '2027-03-28T00:00:00.000Z',
      '2027-03-28T01:00:00.000Z',
      '2027-03-28T10:00:00.000Z',
    ])
  })

  it('returns an empty series, not a crash, when the response has no hourly block', async () => {
    const r = response(series([])) as Record<string, unknown>
    delete r.hourly
    body = r
    assert.deepEqual((await mod.fetchWeather(QUERY)).hourly, [])
  })
})
