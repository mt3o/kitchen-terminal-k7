// The layout contract, narrowed to what the walking skeleton renders.
// The full contract is docs/handoff/layout.schema.yaml; this file deliberately
// covers only the card types slice 1 puts on screen. Widening it is slice work,
// not a refactor.

/** A Card: an id, a type deciding which component renders it, and type-shaped params. */
export interface Card {
  id: string
  type: CardType
  span?: { cols?: number; rows?: number }
  refreshIntervalSeconds?: number
  params?: Record<string, unknown>
}

export type CardType =
  | 'weather' | 'calendar' | 'chat' | 'recipes' | 'shopping-list' | 'timer'
  | 'comic-of-the-day' | 'ascii-art-of-the-day' | 'image' | 'carousel' | 'grid'
  | 'slideshow' | 'clock' | 'menu' | 'audiometer' | 'unsplash-carousel'

export interface GridSettings {
  columns: number
  gap?: string
}

/**
 * An ordered screenful of Cards, and the unit a swipe moves between.
 *
 * Each Page carries its own grid, so adding Cards costs a new Page rather than
 * shrinking the ones already on screen. Not a Slideshow — that rotates whole
 * Cards full-screen after a period of inactivity and is driven by idleness; a
 * Page is always visible and is changed deliberately.
 */
export interface Page {
  id: string
  /** Shown on the pager indicator. Optional: dots work without labels. */
  label?: string
  /** Overrides the layout's grid for this page only. */
  grid?: GridSettings
  cards: Card[]
}

/** Where a calendar's events come from: a Google calendar id, or a read-only .ics feed. */
export type CalendarSource = { mode: 'google'; calendarId: string } | { mode: 'ics'; url: string }

/**
 * One calendar as the layout file declares it, under `calendars.<id>`. The id
 * is the key, not a field: a map rather than a list is what lets
 * layout.local.yaml add a calendar — or change one field of an existing one —
 * by writing the very same key. config-layers deep-merges objects key by key,
 * but a list is one unit it can only replace or append to whole.
 */
export interface CalendarEntry {
  name: string
  source: CalendarSource
}

/** A calendar after normalisation: its key folded back in as `id`, in declaration order. */
export interface LayoutCalendar extends CalendarEntry {
  id: string
}

/**
 * The whole screen configuration: one versioned document naming a Theme.
 *
 * `cards` and `pages` are both accepted and `cards` is kept on purpose: it is
 * the v1 shape, every existing layout uses it, and a contract that breaks its
 * own documents to gain a feature is not a contract. A layout with `cards`
 * behaves exactly as one page.
 *
 * Calendars live here, at the top, not in a calendar card's params: a card
 * sits inside the `pages`/`cards` lists, which a layered merge cannot reach
 * into by id. Every calendar card shows all of them.
 */
export interface Layout {
  version: 1
  theme: string
  grid: GridSettings
  cards?: Card[]
  pages?: Page[]
  calendars?: Record<string, CalendarEntry>
  /** Ids from `calendars` whose events the GŁÓWNY tab merges. */
  mainCalendars?: string[]
}

/** A Layout after normalisation: always pages, never the bare card list; calendars as a list. */
export interface NormalisedLayout {
  version: 1
  theme: string
  grid: GridSettings
  pages: Page[]
  calendars: LayoutCalendar[]
  mainCalendars: string[]
}

/**
 * One shape for the client to render, whichever shape the file used.
 *
 * Done once, on the server, rather than in the renderer: two code paths through
 * a layout is how the single-page case quietly stops being tested.
 */
export function normaliseLayout(layout: Layout): NormalisedLayout {
  const grid = layout.grid
  const calendars = Object.entries(layout.calendars ?? {})
    .filter(([, entry]) => entry !== null && typeof entry === 'object')
    .map(([id, entry]) => ({ id, name: entry.name, source: entry.source }))
  const mainCalendars = layout.mainCalendars ?? []
  const pages = layout.pages?.length
    ? layout.pages.map((page) => ({ ...page, grid: page.grid ?? grid }))
    : [{ id: 'main', grid, cards: layout.cards ?? [] }]
  return { version: layout.version, theme: layout.theme, grid, pages, calendars, mainCalendars }
}

/** Card types slice 1 renders for real rather than as a placeholder. */
export const IMPLEMENTED: ReadonlySet<CardType> = new Set<CardType>(['clock'])
