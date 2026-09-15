/**
 * .ics fetch + parse, against a real fixture feed rather than mocked
 * node-ical output — the shape node-ical actually returns for a recurring
 * event, an all-day event, and one entry with a DTSTART it cannot parse
 * (node-ical hands that back as a literal string, not a Date, verified
 * against the installed version) is exactly the kind of thing that looks
 * obvious and isn't.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, describe, it } from 'node:test'

import { fetchIcsCalendar, icsCacheKey } from '../src/server/upstream/ics-calendar.ts'

const FIXTURE = readFileSync('test/fixtures/school-schedule.ics', 'utf8')
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFeed(ics: string): void {
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    text: async () => ics,
  })) as unknown as typeof fetch
}

describe('icsCacheKey', () => {
  it('keys by the app-configured calendar id, not the feed url', () => {
    assert.equal(icsCacheKey('kid1-school'), 'ics:kid1-school')
  })
})

describe('fetchIcsCalendar', () => {
  it('expands a weekly recurring event into one instance per week in the window', async () => {
    stubFeed(FIXTURE)
    const events = await fetchIcsCalendar({
      url: 'https://example.com/school.ics',
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
    })
    const mathEvents = events.filter((e) => e.id.startsWith('weekly-math@example.com:'))
    assert.equal(mathEvents.length, 4)
    assert.equal(mathEvents[0]!.title, 'Matematyka')
    assert.equal(mathEvents[0]!.start, '2026-09-07T08:00:00.000Z')
    assert.equal(mathEvents[0]!.allDay, undefined)
  })

  it('formats an all-day event as a bare YYYY-MM-DD, not a timestamp', async () => {
    stubFeed(FIXTURE)
    const events = await fetchIcsCalendar({
      url: 'https://example.com/school.ics',
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
    })
    const holiday = events.find((e) => e.id === 'holiday-allday@example.com')
    assert.ok(holiday)
    assert.equal(holiday.start, '2026-09-10')
    assert.equal(holiday.end, '2026-09-11')
    assert.equal(holiday.allDay, true)
  })

  it('drops an entry with an unparseable DTSTART rather than failing the whole feed', async () => {
    stubFeed(FIXTURE)
    const events = await fetchIcsCalendar({
      url: 'https://example.com/school.ics',
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
    })
    assert.equal(events.some((e) => e.id.startsWith('bad-date@example.com')), false)
    // The rest of the feed survives the one bad entry.
    assert.ok(events.some((e) => e.id === 'holiday-allday@example.com'))
    assert.ok(events.some((e) => e.id.startsWith('weekly-math@example.com:')))
  })

  it('returns no events for a window the feed does not reach', async () => {
    stubFeed(FIXTURE)
    const events = await fetchIcsCalendar({
      url: 'https://example.com/school.ics',
      from: new Date('2027-01-01T00:00:00Z'),
      to: new Date('2027-02-01T00:00:00Z'),
    })
    assert.deepEqual(events, [])
  })
})
