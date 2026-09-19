/**
 * The additive half of `layout.local.yaml` (see `index.ts`'s `loadLayout`):
 * `config-layers` merges the tracked `layout.yaml` with the gitignored local
 * file for plain fields (`theme`, `grid`, ...), but `pages`/`cards` are
 * arrays, and a generic layered-config merge treats a whole array as one
 * unit to override/concat/union — it has no notion of "this array's items
 * are keyed by id, merge those." Appending a calendar to one specific card
 * deep inside the pages/cards tree needs that id-aware step done by hand,
 * which is what this module is for.
 *
 * Kept out of `index.ts` for the same reason `calendar-lookup.ts` was: a
 * plain, directly testable function rather than one more thing folded into
 * the module that boots the whole server as an import side effect.
 */
import type { Card, NormalisedLayout } from '../shared/layout.ts'
import type { Calendar } from './domain/types.ts'

/** `layout.local.yaml`'s own shape — everything in it is optional; a missing file is an empty one. */
export interface LocalLayoutOverrides {
  /** Calendars to append to a `type: calendar` card's `params.calendars`, keyed by that card's `id`. */
  calendarAdditions?: Record<string, Calendar[]>
}

/**
 * Appends `additions[card.id]` onto that card's `params.calendars`, wherever
 * the card lives in the layout's recursive container shape (a page's own
 * `cards`, a grid's `cells`, or a carousel's `slides` — the same nesting
 * `calendar-lookup.ts`'s `findConfiguredCalendar` already walks). Cards with
 * no matching addition, and cards that are not `type: calendar`, pass through
 * unchanged.
 */
export function applyCalendarAdditions(layout: NormalisedLayout, additions: Record<string, Calendar[]>): NormalisedLayout {
  if (Object.keys(additions).length === 0) return layout

  function withAdditions(card: Card): Card {
    const extra = card.type === 'calendar' ? additions[card.id] : undefined
    const nested = (card.params?.cells ?? card.params?.slides) as Card[] | undefined
    if (!extra?.length && !nested) return card

    const params = { ...card.params }
    if (extra?.length) {
      params.calendars = [...((params.calendars as Calendar[] | undefined) ?? []), ...extra]
    }
    if (nested) {
      const nestedKey = card.params?.cells ? 'cells' : 'slides'
      params[nestedKey] = nested.map(withAdditions)
    }
    return { ...card, params }
  }

  return {
    ...layout,
    pages: layout.pages.map((page) => ({ ...page, cards: page.cards.map(withAdditions) })),
  }
}
