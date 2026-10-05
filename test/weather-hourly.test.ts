/**
 * The weather card's hourly ASCII graphs (src/client/lib/weather-hourly.ts).
 *
 * The fixture starts at local midnight 2026-10-24 in Europe/Warsaw — the shape
 * /api/weather returns (#87: 120 hours from local midnight, real instants) —
 * so a 72-hour window from Saturday afternoon crosses the 2026-10-25 switch
 * back from summer time, where the wall clock shows 02:00 twice.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { describe, it } from 'node:test'

import {
  dayLabel,
  fitCells,
  graphHeader,
  graphRows,
  hasPrecipitation,
  hourLabel,
  lineText,
  shownSlice,
  upcomingHours,
  type GraphOptions,
  type WeatherHour,
} from '../src/client/lib/weather-hourly.ts'

const ZONE = 'Europe/Warsaw'
const HOUR = 3_600_000
/** 2026-10-24 00:00 in Warsaw (CEST, +02:00). */
const MIDNIGHT = Date.parse('2026-10-23T22:00:00Z')
/** Saturday 14:20 local. */
const NOW = Date.parse('2026-10-24T12:20:00Z')

function hour(i: number, over: Partial<WeatherHour> = {}): WeatherHour {
  return {
    time: new Date(MIDNIGHT + i * HOUR).toISOString(),
    temperature: 10 + (i % 7),
    precipitation: 0,
    precipitationProbability: 0,
    weatherCode: 3,
    rain: 0,
    snowfall: 0,
    ...over,
  }
}

const series = (n = 120, over: (i: number) => Partial<WeatherHour> = () => ({})): WeatherHour[] =>
  Array.from({ length: n }, (_, i) => hour(i, over(i)))

const OPTS: GraphOptions = { timeZone: ZONE, unit: 'mm', tempCells: 20, precipCells: 10, showMm: true, showPct: true }

/** The precipitation bar of a single-hour graph, exactly precipCells wide. */
function bar(h: Partial<WeatherHour>, opts: Partial<GraphOptions> = {}): string {
  const o = { ...OPTS, ...opts }
  const text = lineText(graphRows([hour(0, h)], o)[0])
  const start = 2 + 2 + 1 + o.tempCells + 1 + 3 + 2
  return text.slice(start, start + o.precipCells)
}

describe('upcomingHours', () => {
  it('starts at the hour containing now and stops at the limit', () => {
    const hours = upcomingHours(series(), NOW)
    assert.equal(hours.length, 72)
    assert.equal(hours[0].time, new Date(MIDNIGHT + 14 * HOUR).toISOString())
  })

  it('drops the past hours of a stale answer too', () => {
    // Two days after the answer was fetched, only what is still ahead remains.
    const hours = upcomingHours(series(), NOW + 48 * HOUR)
    assert.equal(hours.length, 120 - 62)
  })

  it('treats a missing series as none, and skips a time that does not parse', () => {
    assert.deepEqual(upcomingHours(undefined, NOW), [])
    assert.deepEqual(upcomingHours(null, NOW), [])
    const broken = [hour(14, { time: 'not a time' }), hour(15)]
    assert.deepEqual(upcomingHours(broken, NOW).map((h) => h.time), [hour(15).time])
  })
})

describe('graphRows: temperature', () => {
  it('marks the first line, the current hour, with >', () => {
    const lines = graphRows(upcomingHours(series(), NOW), { ...OPTS, maxLines: 3 })
    assert.ok(lineText(lines[0]).startsWith('> 14'))
    assert.ok(lineText(lines[1]).startsWith('  15'))
  })

  it('places a point on the min..max of the hours drawn, ends included', () => {
    const lines = graphRows([hour(0, { temperature: -4 }), hour(1, { temperature: 16 }), hour(2, { temperature: 6 })], OPTS)
    const track = (l: number): string => lineText(lines[l]).slice(5, 5 + OPTS.tempCells)
    assert.equal(track(0).indexOf('o'), 0)
    assert.equal(track(1).indexOf('o'), OPTS.tempCells - 1)
    assert.equal(track(2).indexOf('o'), Math.round(0.5 * (OPTS.tempCells - 1)))
    assert.equal(lineText(lines[0]).slice(5 + OPTS.tempCells + 1, 5 + OPTS.tempCells + 4), ' -4')
  })

  it('does not divide by zero on a flat window', () => {
    const lines = graphRows([hour(0, { temperature: 5 }), hour(1, { temperature: 5 })], OPTS)
    for (const l of lines) assert.equal(lineText(l).slice(5, 5 + OPTS.tempCells).indexOf('o'), Math.floor((OPTS.tempCells - 1) / 2))
  })

  it('draws no point and -- for an hour without a temperature', () => {
    const text = lineText(graphRows([hour(0, { temperature: null }), hour(1)], OPTS)[0])
    assert.ok(!text.slice(5, 5 + OPTS.tempCells).includes('o'))
    assert.equal(text.slice(5 + OPTS.tempCells + 1, 5 + OPTS.tempCells + 4), ' --')
  })
})

describe('graphRows: precipitation', () => {
  it('is blank for a dry hour, and ignores snowfall depth on the water scale', () => {
    assert.equal(bar({ precipitation: 0, snowfall: 3 }), ' '.repeat(10))
  })

  it('uses a fixed 4 mm/h scale, not one stretched to the window', () => {
    assert.equal(bar({ precipitation: 2, rain: 2 }), '#####     ')
    assert.equal(bar({ precipitation: 4, rain: 4 }), '##########')
  })

  it('gives any measurable amount at least one glyph', () => {
    assert.equal(bar({ precipitation: 0.05, rain: 0.05 }), '#         ')
  })

  it('caps past the end with > and keeps the rain:snow proportions', () => {
    assert.equal(bar({ precipitation: 5.1, rain: 5.1 }), '#########>')
    const mixed = bar({ precipitation: 8, rain: 4 })
    assert.equal(mixed.length, 10)
    assert.ok(mixed.endsWith('>'))
    const body = mixed.slice(0, 9)
    assert.ok(Math.abs(body.split('#').length - body.split('*').length) <= 1, `even split, got ${mixed}`)
  })

  it('draws the snow share as precipitation minus rain, with * after #', () => {
    assert.equal(bar({ precipitation: 2, rain: 1 }), '###**     ')
    assert.equal(bar({ precipitation: 1.2, rain: 0 }), '***       ')
  })

  it('shows both kinds when both fell, whatever the rounding', () => {
    const b = bar({ precipitation: 1, rain: 0.95 })
    assert.ok(b.includes('#') && b.includes('*'), b)
  })

  it('never infers snow from a missing split: a null rain draws as rain', () => {
    assert.equal(bar({ precipitation: 2, rain: null }), '#####     ')
  })

  it('never draws negative snow when rain exceeds the total', () => {
    assert.equal(bar({ precipitation: 1, rain: 1.4 }), '###       ')
  })

  it('reads the scale from units.precipitation: an inch fills at 0.16/h', () => {
    assert.equal(bar({ precipitation: 0.08, rain: 0.08 }, { unit: 'inch' }), '#####     ')
    const text = lineText(graphRows([hour(0, { precipitation: 0.08, rain: 0.08 })], { ...OPTS, unit: 'inch' })[0])
    assert.ok(text.includes('0.08'))
  })

  it('shows the amount and the probability as bare numbers, -- when missing', () => {
    const lines = graphRows([hour(0, { precipitation: 1.25, rain: 1.25, precipitationProbability: 70 }), hour(1, { precipitation: null, precipitationProbability: null })], OPTS)
    assert.match(lineText(lines[0]), / {2}1\.3 {3}70$/)
    assert.match(lineText(lines[1]), / {2}-- {3}--$/)
  })
})

describe('graphRows: lines, days and geometry', () => {
  it('counts a midnight separator against maxLines, and never ends on one', () => {
    // From 14:00 the 11th hour is midnight: 10 hours, a separator, 13 hours.
    const hours = upcomingHours(series(), NOW)
    const lines = graphRows(hours, { ...OPTS, maxLines: 24 })
    assert.equal(lines.length, 24)
    assert.equal(lines.filter((l) => l[0].role === 'separator').length, 1)
    // Budget 11: the 10 hours fit, the separator cannot be followed by its hour.
    const short = graphRows(hours, { ...OPTS, maxLines: 11 })
    assert.equal(short.length, 10)
    assert.notEqual(short[short.length - 1][0].role, 'separator')
  })

  it('labels the autumn switch on the zone clock: 02:00 twice, under a fixed weekday table', () => {
    const hours = upcomingHours(series(), NOW).slice(10, 15)
    const text = graphRows(hours, OPTS).map(lineText)
    assert.equal(text[0].slice(0, 4), '> 00')
    assert.deepEqual(text.slice(1).map((t) => t.slice(2, 4)), ['01', '02', '02', '03'])
    assert.equal(dayLabel(Date.parse('2026-10-24T22:00:00Z'), ZONE), '-- NIEDZ 25.10 --')
    assert.equal(dayLabel(Date.parse('2026-10-26T12:00:00Z'), ZONE), '-- PON 26.10 --')
  })

  it('draws the same text whatever the machine zone is', () => {
    const script = `
      import { graphRows, lineText, upcomingHours } from ${JSON.stringify(new URL('../src/client/lib/weather-hourly.ts', import.meta.url).href)}
      const h = (i) => ({ time: new Date(${MIDNIGHT} + i * 3600000).toISOString(), temperature: i % 9, precipitation: i % 5 ? 0 : 1, precipitationProbability: 10, weatherCode: 3, rain: 0.5, snowfall: 0 })
      const hours = upcomingHours(Array.from({ length: 120 }, (_, i) => h(i)), ${NOW})
      process.stdout.write(graphRows(hours, ${JSON.stringify(OPTS)}).map(lineText).join('\\n'))`
    const run = (tz: string): string =>
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' })
    const warsaw = run('Europe/Warsaw')
    assert.ok(warsaw.includes('-- NIEDZ 25.10 --'))
    assert.equal(run('America/New_York'), warsaw)
    assert.equal(run('UTC'), warsaw)
  })

  it('puts every hour line at one width, inside the columns fitCells was given', () => {
    for (const columns of [34, 40, 82]) {
      for (const showPct of [true, false]) {
        const cells = fitCells(columns, { showMm: true, showPct })
        const lines = graphRows(upcomingHours(series(), NOW), { ...OPTS, ...cells })
        const widths = new Set(lines.filter((l) => l[0].role !== 'separator').map((l) => lineText(l).length))
        assert.equal(widths.size, 1, `${columns} cols: ${[...widths]}`)
        assert.ok([...widths][0] <= columns, `${columns} cols, line ${[...widths][0]}`)
      }
    }
  })

  it('drops the mm figure below 40 columns and keeps the probability', () => {
    assert.deepEqual(fitCells(34, { showMm: true, showPct: true }), { tempCells: 9, precipCells: 9, showMm: false, showPct: true })
    assert.equal(fitCells(82, { showMm: true, showPct: true }).showMm, true)
  })

  it('emits only 7-bit ASCII, whatever the values', () => {
    const wild = series(120, (i) => ({
      temperature: i % 11 === 0 ? null : -12 + (i % 30),
      precipitation: [0, 0.1, 2.5, 9.9, null][i % 5],
      rain: [0, 0, 1, null, 0][i % 5],
      precipitationProbability: i % 13 === 0 ? null : (i * 7) % 101,
    }))
    for (const unit of ['mm', 'inch', '']) {
      const hours = upcomingHours(wild, NOW)
      const all = [...graphHeader(hours, { ...OPTS, unit, windowHours: 72 }), ...graphRows(hours, { ...OPTS, unit })]
        .map(lineText).join('\n')
      const bad = [...all].filter((c) => c.charCodeAt(0) > 0x7f)
      assert.deepEqual(bad, [], `unit ${unit || '(empty)'}`)
    }
  })
})

describe('graphHeader', () => {
  it('sits each label over its column, with the min..max of the painted hours', () => {
    const hours = upcomingHours(series(120, (i) => ({ temperature: i - 14 })), NOW)
    const opts = { ...OPTS, maxLines: 5, windowHours: 24 }
    const [labels] = graphHeader(hours, opts).map(lineText)
    // Hours 14..18 painted: temperatures 0..4, not the whole window's 0..71.
    assert.ok(labels.startsWith('GODZ TEMP 0..4'), labels)
    const barStart = 2 + 2 + 1 + OPTS.tempCells + 1 + 3 + 2
    assert.equal(labels.indexOf('OPADY'), barStart)
    assert.equal(labels.indexOf('%'), lineText(graphRows(hours, opts)[0]).length - 1)
  })

  it('shows the legend when something falls, and says so when nothing does in the window shown', () => {
    const wet = series(120, (i) => (i === 30 ? { precipitation: 1, rain: 1 } : {}))
    const legend = (maxLines: number, windowHours: number): string =>
      lineText(graphHeader(upcomingHours(wet, NOW), { ...OPTS, maxLines, windowHours })[1])
    assert.equal(legend(30, 72), '# deszcz  * snieg')
    // Hour 30 is the 17th hour from 14:00, past a 10-line budget.
    assert.equal(legend(10, 24), 'OPADY // brak w ciagu 24 h')
  })

  it('names the imperial scale in the header', () => {
    const [labels] = graphHeader(upcomingHours(series(), NOW), { ...OPTS, unit: 'inch', windowHours: 72 }).map(lineText)
    assert.ok(labels.includes('0..0.16 in/h'), labels)
  })
})

describe('hasPrecipitation and shownSlice', () => {
  it('looks only at the hours given', () => {
    const wet = series(120, (i) => (i === 30 ? { precipitation: 0.2, rain: 0.2 } : {}))
    const hours = upcomingHours(wet, NOW)
    assert.equal(hasPrecipitation(hours), true)
    assert.equal(hasPrecipitation(shownSlice(hours, { ...OPTS, maxLines: 10 })), false)
    assert.equal(hasPrecipitation(shownSlice(hours, { ...OPTS, maxLines: 24 })), true)
  })

  it('labels hours on the zone clock, not the machine clock', () => {
    assert.equal(hourLabel(Date.parse('2026-10-24T12:00:00Z'), ZONE), '14')
    assert.equal(hourLabel(Date.parse('2026-10-24T12:00:00Z'), 'America/New_York'), '08')
  })
})
