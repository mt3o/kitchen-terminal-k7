/**
 * Resolves a configured `Calendar` by its app-level `id`, from the layout the
 * household itself wrote — never from a client-supplied source. Pulled out of
 * `index.ts` (which boots the whole server as an import side effect, making
 * its own functions awkward to unit test in isolation) so this stays a plain,
 * directly testable function.
 */
import type { Card, NormalisedLayout } from '../shared/layout.ts'
import type { Calendar } from './domain/types.ts'

/**
 * Finds the configured `Calendar` entry (a `calendars` array item on a
 * `type: 'calendar'` card, `docs/handoff/layout.schema.yaml`'s
 * `params.calendar`) matching `id`, wherever it lives in the layout — a card
 * can nest inside a grid's cells or a carousel's slides, per the schema's own
 * recursive-container shape.
 *
 * `/api/calendar/week` resolves the fetch source (both the mode AND its one
 * companion field — the .ics URL, or the Google calendarId) from HERE, never
 * from client-supplied query params: found live, 2026-09-15 — a LAN client
 * could otherwise direct K7's own server to fetch an arbitrary address
 * (127.0.0.1, a docker bridge IP, another LAN host's admin panel) simply by
 * passing `mode=ics&url=...`, since the fetch happened server-side with no
 * validation against what was actually configured. `layout.yaml` is trusted
 * (only the household edits it); a request is not.
 */
export function findConfiguredCalendar(layout: NormalisedLayout, id: string): Calendar | undefined {
  function searchCards(cards: Card[]): Calendar | undefined {
    for (const card of cards) {
      if (card.type === 'calendar') {
        const calendars = (card.params?.calendars as Calendar[] | undefined) ?? []
        const found = calendars.find((c) => c && c.id === id)
        if (found) return found
      }
      const nested = (card.params?.cells ?? card.params?.slides) as Card[] | undefined
      if (Array.isArray(nested)) {
        const found = searchCards(nested)
        if (found) return found
      }
    }
    return undefined
  }
  for (const page of layout.pages) {
    const found = searchCards(page.cards)
    if (found) return found
  }
  return undefined
}
