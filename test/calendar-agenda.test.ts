/**
 * The calendar card's agenda: 30 days back to 60 ahead, only the days with
 * something on them plus today. Pure date maths from `calendar.ts`, DOM-free
 * like the rest of the calendar tests.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  agendaRange,
  agendaRows,
  CALENDAR_FUTURE_DAYS,
  CALENDAR_PAST_DAYS,
  groupByDay,
  isSameDay,
  type CalendarEvent,
} from '../src/client/lib/calendar.ts'

const TODAY = new Date(2026, 8, 21, 14, 30)

function allDay(id: string, date: string): CalendarEvent {
  return { id, title: id, start: date, end: date, allDay: true }
}

describe('agendaRange', () => {
  it('runs from 30 days back to 60 ahead, today included', () => {
    const days = agendaRange(TODAY)
    assert.equal(days.length, CALENDAR_PAST_DAYS + 1 + CALENDAR_FUTURE_DAYS)
    assert.equal(days[0]!.getTime(), new Date(2026, 7, 22).getTime())
    assert.equal(days[days.length - 1]!.getTime(), new Date(2026, 10, 20).getTime())
    assert.ok(isSameDay(days[CALENDAR_PAST_DAYS]!, TODAY))
  })

  it('lands every day on local midnight across the October DST change', () => {
    for (const d of agendaRange(TODAY)) assert.equal(d.getHours(), 0, d.toString())
  })
})

describe('groupByDay over the agenda range', () => {
  it('buckets events across the whole range and drops those outside it', () => {
    const days = agendaRange(TODAY)
    const buckets = groupByDay(
      [allDay('past', '2026-08-25'), allDay('future', '2026-11-15'), allDay('too-old', '2026-08-01'), allDay('too-far', '2026-12-01')],
      days,
    )
    const placed = buckets.flat().map((e) => e.id).sort()
    assert.deepEqual(placed, ['future', 'past'])
  })
})

describe('agendaRows', () => {
  it('keeps only days with events, plus today even when it is empty', () => {
    const days = agendaRange(TODAY)
    const buckets = groupByDay([allDay('past', '2026-08-25'), allDay('future', '2026-11-15')], days)
    const rows = agendaRows(days, buckets, TODAY)
    assert.deepEqual(
      rows.map((r) => r.day.getTime()),
      [new Date(2026, 7, 25), new Date(2026, 8, 21), new Date(2026, 10, 15)].map((d) => d.getTime()),
    )
    assert.equal(rows[1]!.events.length, 0)
  })
})
