/**
 * `applyCalendarAdditions` is the id-aware step `config-layers` itself can't
 * do: appending an entry deep inside `pages[].cards[].params.calendars`,
 * addressed by the owning card's `id`. These tests are the proof it finds
 * that card wherever the layout's recursive container shape puts it — same
 * shape `findConfiguredCalendar` (`calendar-lookup.test.ts`) already covers
 * — and that it never touches a card with no matching addition.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { applyCalendarAdditions } from '../src/server/layout-local-overrides.ts'
import type { NormalisedLayout } from '../src/shared/layout.ts'

const GOOGLE_CAL = { id: 'google-primary', name: 'Google', showInMain: true, source: { mode: 'google' as const, calendarId: 'primary' } }
const PERSONAL_CAL = { id: 'moj-kalendarz', name: 'Mój kalendarz', showInMain: false, source: { mode: 'google' as const, calendarId: 'someone@example.com' } }

function layoutWith(pages: NormalisedLayout['pages']): NormalisedLayout {
  return { version: 1, theme: 'x', grid: { columns: 2 }, pages }
}

describe('applyCalendarAdditions', () => {
  it('appends an addition onto the matching card’s existing calendars', () => {
    const layout = layoutWith([
      { id: 'p1', cards: [{ id: 'kalendarz', type: 'calendar', params: { calendars: [GOOGLE_CAL] } }] },
    ])
    const result = applyCalendarAdditions(layout, { kalendarz: [PERSONAL_CAL] })
    assert.deepEqual(result.pages[0].cards[0].params?.calendars, [GOOGLE_CAL, PERSONAL_CAL])
  })

  it('leaves a card with no matching addition untouched', () => {
    const layout = layoutWith([
      { id: 'p1', cards: [{ id: 'kalendarz', type: 'calendar', params: { calendars: [GOOGLE_CAL] } }] },
    ])
    const result = applyCalendarAdditions(layout, { 'someone-elses-card': [PERSONAL_CAL] })
    assert.deepEqual(result.pages[0].cards[0].params?.calendars, [GOOGLE_CAL])
  })

  it('never touches a non-calendar card even if its id matches a key', () => {
    const layout = layoutWith([{ id: 'p1', cards: [{ id: 'kalendarz', type: 'weather', params: {} }] }])
    const result = applyCalendarAdditions(layout, { kalendarz: [PERSONAL_CAL] })
    assert.equal(result.pages[0].cards[0].params?.calendars, undefined)
  })

  it('reaches a calendar card nested inside a grid cell', () => {
    const layout = layoutWith([
      {
        id: 'p1',
        cards: [
          {
            id: 'siatka',
            type: 'grid',
            params: { cells: [{ id: 'kalendarz', type: 'calendar', params: { calendars: [GOOGLE_CAL] } }] },
          },
        ],
      },
    ])
    const result = applyCalendarAdditions(layout, { kalendarz: [PERSONAL_CAL] })
    const cell = (result.pages[0].cards[0].params?.cells as typeof layout.pages[0]['cards'])[0]
    assert.deepEqual(cell.params?.calendars, [GOOGLE_CAL, PERSONAL_CAL])
  })

  it('reaches a calendar card nested inside a carousel slide', () => {
    const layout = layoutWith([
      {
        id: 'p1',
        cards: [
          {
            id: 'karuzela',
            type: 'carousel',
            params: { slides: [{ id: 'kalendarz', type: 'calendar', params: { calendars: [GOOGLE_CAL] } }] },
          },
        ],
      },
    ])
    const result = applyCalendarAdditions(layout, { kalendarz: [PERSONAL_CAL] })
    const slide = (result.pages[0].cards[0].params?.slides as typeof layout.pages[0]['cards'])[0]
    assert.deepEqual(slide.params?.calendars, [GOOGLE_CAL, PERSONAL_CAL])
  })

  it('applies the same addition to two different cards that both match', () => {
    const layout = layoutWith([
      { id: 'p1', cards: [{ id: 'kalendarz', type: 'calendar', params: { calendars: [GOOGLE_CAL] } }] },
      { id: 'p2', cards: [{ id: 'kalendarz-pelny', type: 'calendar', params: { calendars: [GOOGLE_CAL] } }] },
    ])
    const result = applyCalendarAdditions(layout, {
      kalendarz: [PERSONAL_CAL],
      'kalendarz-pelny': [PERSONAL_CAL],
    })
    assert.deepEqual(result.pages[0].cards[0].params?.calendars, [GOOGLE_CAL, PERSONAL_CAL])
    assert.deepEqual(result.pages[1].cards[0].params?.calendars, [GOOGLE_CAL, PERSONAL_CAL])
  })

  it('an empty additions map returns the exact same layout object, no copying', () => {
    const layout = layoutWith([{ id: 'p1', cards: [{ id: 'kalendarz', type: 'calendar', params: { calendars: [GOOGLE_CAL] } }] }])
    assert.equal(applyCalendarAdditions(layout, {}), layout)
  })
})
