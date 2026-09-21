/**
 * Pure logic for multi-calendar merging: which events feed the day grid for
 * a given tab, the synthetic "load error" placeholder for a calendar with
 * nothing cached, and the colour-tick hue/contrast math — all DOM-free, the
 * same convention `groupByDay`'s own tests already follow.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  calendarTickColor,
  calendarTickHue,
  isSyntheticErrorEvent,
  selectEventsForTab,
  syntheticErrorEventId,
  syntheticErrorWeek,
  type Calendar,
  type CalendarEvent,
} from '../src/client/lib/calendar.ts'

const GOOGLE_MAIN: Calendar = { id: 'google-primary', name: 'Google', source: { mode: 'google', calendarId: 'primary' } }
const KID1: Calendar = { id: 'kid1', name: 'Zosia', source: { mode: 'ics', url: 'https://example.com/zosia.ics' } }
const KID2: Calendar = { id: 'kid2', name: 'Kuba', source: { mode: 'ics', url: 'https://example.com/kuba.ics' } }
/** The layout's `mainCalendars`: KID1 deliberately left out. */
const MAIN_IDS = [GOOGLE_MAIN.id, KID2.id]

function ev(id: string, calendarId: string): CalendarEvent {
  return { id, title: id, start: '2026-09-08T10:00:00Z', end: '2026-09-08T11:00:00Z', calendarId }
}

describe('selectEventsForTab', () => {
  it('with a single configured calendar, shows its events unconditionally — no tab strip, no choice to make', () => {
    const only = GOOGLE_MAIN
    const events = selectEventsForTab([only], [], { [only.id]: [ev('a', only.id)] }, 'main')
    assert.deepEqual(events.map((e) => e.id), ['a'])
  })

  it('the main tab merges only the calendars named in mainCalendars', () => {
    const eventsByCalendar = {
      [GOOGLE_MAIN.id]: [ev('g1', GOOGLE_MAIN.id)],
      [KID1.id]: [ev('k1a', KID1.id)],
      [KID2.id]: [ev('k2a', KID2.id)],
    }
    const events = selectEventsForTab([GOOGLE_MAIN, KID1, KID2], MAIN_IDS, eventsByCalendar, 'main')
    const ids = events.map((e) => e.id).sort()
    assert.deepEqual(ids, ['g1', 'k2a']) // KID1 (not in mainCalendars) excluded
  })

  it('a specific calendar tab shows only that calendar, whether or not it is in mainCalendars', () => {
    const eventsByCalendar = {
      [GOOGLE_MAIN.id]: [ev('g1', GOOGLE_MAIN.id)],
      [KID1.id]: [ev('k1a', KID1.id)],
    }
    const events = selectEventsForTab([GOOGLE_MAIN, KID1], MAIN_IDS, eventsByCalendar, KID1.id)
    assert.deepEqual(events.map((e) => e.id), ['k1a'])
  })

  it('an unknown tab id (or a calendar with no events yet) yields an empty list, not a crash', () => {
    assert.deepEqual(selectEventsForTab([GOOGLE_MAIN, KID1], MAIN_IDS, {}, KID1.id), [])
  })
})

describe('syntheticErrorWeek / syntheticErrorEventId / isSyntheticErrorEvent', () => {
  it('produces one all-day placeholder per day of the week, scoped to that calendar', () => {
    const weekStart = new Date(2026, 8, 7) // Monday 2026-09-07
    const placeholders = syntheticErrorWeek('kid1', weekStart)
    assert.equal(placeholders.length, 7)
    assert.ok(placeholders.every((e) => e.allDay === true))
    assert.ok(placeholders.every((e) => e.calendarId === 'kid1'))
    assert.equal(placeholders[0]!.start, '2026-09-07')
    assert.equal(placeholders[6]!.start, '2026-09-13')
  })

  it('the id is recognisable as synthetic without a dedicated field', () => {
    const id = syntheticErrorEventId('kid1', '2026-09-07')
    assert.equal(id, 'error:kid1:2026-09-07')
    assert.equal(isSyntheticErrorEvent({ id, title: '', start: '', end: '' }), true)
    assert.equal(isSyntheticErrorEvent({ id: 'kid1', title: '', start: '', end: '' }), false)
  })
})

describe('calendarTickHue', () => {
  it('never lands inside the amber/warn/fail band [0,50) or the signal/teal band [145,180)', () => {
    for (let total = 1; total <= 12; total++) {
      for (let i = 0; i < total; i++) {
        const hue = calendarTickHue(i, total)
        assert.ok(hue >= 0 && hue < 360, `hue ${hue} out of range`)
        assert.ok(!(hue >= 0 && hue < 50), `hue ${hue} lands in the reserved amber/warn/fail band`)
        assert.ok(!(hue >= 145 && hue < 180), `hue ${hue} lands in the reserved signal/teal band`)
      }
    }
  })

  it('a single calendar still gets a real, stable hue — not a degenerate case', () => {
    const hue = calendarTickHue(0, 1)
    assert.equal(Number.isFinite(hue), true)
  })

  it('adding a second calendar does not reshuffle the first one\'s hue', () => {
    const first1 = calendarTickHue(0, 1)
    const first2 = calendarTickHue(0, 2)
    assert.equal(first1, first2)
  })
})

describe('calendarTickColor', () => {
  function hexToRgb(hex: string): [number, number, number] {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
  }
  function relativeLuminance([r, g, b]: [number, number, number]): number {
    const lin = (c: number): number => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  function contrast(hexA: string, hexB: string): number {
    const la = relativeLuminance(hexToRgb(hexA))
    const lb = relativeLuminance(hexToRgb(hexB))
    const [lighter, darker] = la >= lb ? [la, lb] : [lb, la]
    return (lighter + 0.05) / (darker + 0.05)
  }

  const SURFACE_SUNKEN: Record<'light' | 'dark' | 'night', string> = { light: '#efece4', dark: '#18140d', night: '#030201' }

  it('returns a well-formed hex colour', () => {
    assert.match(calendarTickColor(0, 3, 'dark'), /^#[0-9a-f]{6}$/)
  })

  for (const mode of ['light', 'dark', 'night'] as const) {
    it(`clears the 3:1 CONTRASTFLOORS non-text floor against --surface-sunken in ${mode} mode, across many hues`, () => {
      for (let total = 1; total <= 8; total++) {
        for (let i = 0; i < total; i++) {
          const color = calendarTickColor(i, total, mode)
          const ratio = contrast(color, SURFACE_SUNKEN[mode])
          assert.ok(ratio >= 3, `${mode} index ${i}/${total}: contrast ${ratio.toFixed(2)} < 3:1 (${color} vs ${SURFACE_SUNKEN[mode]})`)
        }
      }
    })
  }
})
