/**
 * Resolves a configured `Calendar` by its app-level `id`, from the layout the
 * household itself wrote — never from a client-supplied source. Pulled out of
 * `index.ts` (which boots the whole server as an import side effect, making
 * its own functions awkward to unit test in isolation) so this stays a plain,
 * directly testable function.
 */
import type { NormalisedLayout } from '../shared/layout.ts'
import type { Calendar } from './domain/types.ts'

/**
 * Finds the configured `Calendar` (the layout's top-level `calendars`,
 * `docs/handoff/layout.schema.yaml`) matching `id`.
 *
 * `/api/calendar/week` resolves the fetch source (both the mode AND its one
 * companion field — the .ics URL, or the Google calendarId) from HERE, never
 * from client-supplied query params: found live, 2026-09-15 — a LAN client
 * could otherwise direct K7's own server to fetch an arbitrary address
 * (127.0.0.1, a docker bridge IP, another LAN host's admin panel) simply by
 * passing `mode=ics&url=...`, since the fetch happened server-side with no
 * validation against what was actually configured. `layout.yaml` is trusted
 * (only the household edits it); a request is not.
 *
 * Searches the normalised list rather than indexing the file's map by `id`:
 * a request-supplied key must never be able to reach `__proto__` or
 * `constructor` on a plain object.
 */
export function findConfiguredCalendar(layout: NormalisedLayout, id: string): Calendar | undefined {
  return layout.calendars.find((c) => c.id === id)
}
