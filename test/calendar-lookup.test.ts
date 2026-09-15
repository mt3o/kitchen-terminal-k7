/**
 * `findConfiguredCalendar` is what closes the SSRF hole `/api/calendar/week`
 * had: the route must resolve a calendar's source (URL/calendarId) from
 * `layout.yaml`, never from the request. These tests are the proof that the
 * lookup actually finds a calendar wherever the layout's recursive
 * container shape puts it — a card can nest inside a grid's cells or a
 * carousel's slides — and, just as importantly, that a request for
 * anything not actually configured comes back empty rather than guessed at.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { findConfiguredCalendar } from '../src/server/calendar-lookup.ts'
import type { NormalisedLayout } from '../src/shared/layout.ts'

const GOOGLE_CAL = { id: 'google-primary', name: 'Google', showInMain: true, source: { mode: 'google' as const, calendarId: 'primary' } }
const ICS_CAL = { id: 'kid1', name: 'Zosia', showInMain: false, source: { mode: 'ics' as const, url: 'https://example.com/zosia.ics' } }

function layoutWith(pages: NormalisedLayout['pages']): NormalisedLayout {
  return { version: 1, theme: 'x', grid: { columns: 2 }, pages }
}

describe('findConfiguredCalendar', () => {
  it('finds a calendar entry on a top-level page card', () => {
    const layout = layoutWith([
      { id: 'p1', cards: [{ id: 'kalendarz', type: 'calendar', params: { calendars: [GOOGLE_CAL, ICS_CAL] } }] },
    ])
    assert.deepEqual(findConfiguredCalendar(layout, 'kid1'), ICS_CAL)
  })

  it('returns undefined for an id that is not actually configured — never fabricates one', () => {
    const layout = layoutWith([{ id: 'p1', cards: [{ id: 'kalendarz', type: 'calendar', params: { calendars: [GOOGLE_CAL] } }] }])
    assert.equal(findConfiguredCalendar(layout, 'someone-elses-calendar'), undefined)
  })

  it('finds a calendar nested inside a grid cell', () => {
    const layout = layoutWith([
      {
        id: 'p1',
        cards: [
          {
            id: 'siatka',
            type: 'grid',
            params: { cells: [{ id: 'kalendarz', type: 'calendar', params: { calendars: [ICS_CAL] } }] },
          },
        ],
      },
    ])
    assert.deepEqual(findConfiguredCalendar(layout, 'kid1'), ICS_CAL)
  })

  it('finds a calendar nested inside a carousel slide', () => {
    const layout = layoutWith([
      {
        id: 'p1',
        cards: [
          {
            id: 'karuzela',
            type: 'carousel',
            params: { slides: [{ id: 'kalendarz', type: 'calendar', params: { calendars: [ICS_CAL] } }] },
          },
        ],
      },
    ])
    assert.deepEqual(findConfiguredCalendar(layout, 'kid1'), ICS_CAL)
  })

  it('searches every page, not just the first', () => {
    const layout = layoutWith([
      { id: 'p1', cards: [{ id: 'inny', type: 'weather', params: {} }] },
      { id: 'p2', cards: [{ id: 'kalendarz', type: 'calendar', params: { calendars: [GOOGLE_CAL] } }] },
    ])
    assert.deepEqual(findConfiguredCalendar(layout, 'google-primary'), GOOGLE_CAL)
  })

  it('an empty layout (no calendar card anywhere) never throws, just finds nothing', () => {
    const layout = layoutWith([{ id: 'p1', cards: [{ id: 'zegar', type: 'clock', params: {} }] }])
    assert.equal(findConfiguredCalendar(layout, 'google-primary'), undefined)
  })
})
