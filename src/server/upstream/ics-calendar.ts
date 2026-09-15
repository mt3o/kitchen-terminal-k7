/**
 * A read-only .ics/iCal feed as a calendar source — the household's own
 * calendars stay on Google; this is for the ones somebody else publishes
 * (a school's schedule system, a public holiday feed) that K7 only ever
 * displays, never edits.
 *
 * `node-ical` handles recurrence expansion itself (`expandRecurringEvent`,
 * backed by `rrule-temporal`), which matters here because a school schedule
 * is almost entirely `RRULE:FREQ=WEEKLY` entries, not one-off events.
 *
 * node-ical is lenient about a single malformed field (a DTSTART it cannot
 * parse comes back as the literal string rather than a Date, not an
 * exception) but throws for the whole file on some malformed RRULEs — there
 * is no per-event isolation at the library's own parse boundary. What this
 * module can guarantee is the layer above that: a `.ics` payload that DOES
 * parse but has one event with data this module cannot make sense of loses
 * that one event, never the rest of the feed.
 */
import ical from 'node-ical'

import type { CalendarEvent } from '../domain/types.ts'
import { fetchWithTimeout } from './freshness.ts'

export interface IcsCalendarQuery {
  url: string
  /** Inclusive start of the window recurring events are expanded into. */
  from: Date
  /** Inclusive end of the window. */
  to: Date
  timeoutMs?: number
}

/** Keyed by the app's own configured `Calendar.id`, not the feed URL — stable across a URL edit. */
export function icsCacheKey(calendarId: string): string {
  return `ics:${calendarId}`
}

function textOf(value: string | { val: string } | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : value.val
}

/**
 * `YYYY-MM-DD` for an all-day event, matching `CalendarEvent`'s own all-day
 * convention (`calendar.ts`'s `DATE_ONLY`). node-ical constructs a `VALUE=DATE`
 * field as local midnight of that calendar date (verified against the
 * installed version, not assumed), so reading it back with the local — not
 * UTC — getters is what recovers the literal date regardless of which
 * timezone the process itself runs under.
 */
function formatEventDate(d: Date, allDay: boolean): string {
  if (!allDay) return d.toISOString()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function fetchIcsCalendar(query: IcsCalendarQuery): Promise<CalendarEvent[]> {
  const res = await fetchWithTimeout(query.url, query.timeoutMs)
  const text = await res.text()
  const data = ical.parseICS(text)
  const events: CalendarEvent[] = []

  for (const [uid, component] of Object.entries(data)) {
    if (!component || component.type !== 'VEVENT') continue

    try {
      if (component.rrule) {
        const instances = ical.expandRecurringEvent(component, { from: query.from, to: query.to })
        for (const instance of instances) {
          const { start, end } = instance
          if (end.getTime() < start.getTime()) continue // malformed, same rule as calendar.ts's groupByDay
          events.push({
            id: `${uid}:${start.toISOString()}`,
            title: textOf(instance.summary),
            start: formatEventDate(start, instance.isFullDay),
            end: formatEventDate(end, instance.isFullDay),
            allDay: instance.isFullDay || undefined,
          })
        }
        continue
      }

      const start = component.start
      const end = component.end ?? component.start
      // A DTSTART node-ical could not parse comes back as the raw string, not
      // a Date — this is the entry that proves one bad event doesn't blank
      // the feed.
      if (!(start instanceof Date) || !(end instanceof Date)) continue
      if (end.getTime() < start.getTime()) continue
      if (end.getTime() < query.from.getTime() || start.getTime() > query.to.getTime()) continue

      const allDay = start.dateOnly === true
      events.push({
        id: uid,
        title: textOf(component.summary),
        start: formatEventDate(start, allDay),
        end: formatEventDate(end, allDay),
        allDay: allDay || undefined,
      })
    } catch {
      continue // dropped, not fatal — one bad event must not blank the feed
    }
  }

  return events
}
