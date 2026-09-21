/**
 * `findConfiguredCalendar` is what closes the SSRF hole `/api/calendar/week`
 * had: the route must resolve a calendar's source (URL/calendarId) from
 * `layout.yaml`, never from the request. These tests are the proof that the
 * lookup finds a configured calendar and, just as importantly, that a
 * request for anything not actually configured — including a key that only
 * exists on every object's prototype — comes back empty rather than guessed at.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { findConfiguredCalendar } from '../src/server/calendar-lookup.ts'
import type { LayoutCalendar, NormalisedLayout } from '../src/shared/layout.ts'

const GOOGLE_CAL: LayoutCalendar = { id: 'google-primary', name: 'Google', source: { mode: 'google', calendarId: 'primary' } }
const ICS_CAL: LayoutCalendar = { id: 'kid1', name: 'Zosia', source: { mode: 'ics', url: 'https://example.com/zosia.ics' } }

function layoutWith(calendars: LayoutCalendar[]): NormalisedLayout {
  return { version: 1, theme: 'x', grid: { columns: 2 }, pages: [], calendars, mainCalendars: [] }
}

describe('findConfiguredCalendar', () => {
  it('finds a configured calendar by id', () => {
    assert.deepEqual(findConfiguredCalendar(layoutWith([GOOGLE_CAL, ICS_CAL]), 'kid1'), ICS_CAL)
  })

  it('returns undefined for an id that is not actually configured — never fabricates one', () => {
    assert.equal(findConfiguredCalendar(layoutWith([GOOGLE_CAL]), 'someone-elses-calendar'), undefined)
  })

  it('a prototype key is not a calendar', () => {
    const layout = layoutWith([GOOGLE_CAL])
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      assert.equal(findConfiguredCalendar(layout, id), undefined, id)
    }
  })

  it('a layout with no calendars never throws, just finds nothing', () => {
    assert.equal(findConfiguredCalendar(layoutWith([]), 'google-primary'), undefined)
  })
})
