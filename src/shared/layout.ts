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
  | 'comic-of-the-day' | 'ascii-art-of-the-day' | 'carousel' | 'grid'
  | 'slideshow' | 'clock' | 'menu' | 'audiometer'

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

/**
 * The whole screen configuration: one versioned document naming a Theme.
 *
 * `cards` and `pages` are both accepted and `cards` is kept on purpose: it is
 * the v1 shape, every existing layout uses it, and a contract that breaks its
 * own documents to gain a feature is not a contract. A layout with `cards`
 * behaves exactly as one page.
 */
export interface Layout {
  version: 1
  theme: string
  grid: GridSettings
  cards?: Card[]
  pages?: Page[]
}

/** A Layout after normalisation: always pages, never the bare card list. */
export interface NormalisedLayout {
  version: 1
  theme: string
  grid: GridSettings
  pages: Page[]
}

/**
 * One shape for the client to render, whichever shape the file used.
 *
 * Done once, on the server, rather than in the renderer: two code paths through
 * a layout is how the single-page case quietly stops being tested.
 */
export function normaliseLayout(layout: Layout): NormalisedLayout {
  const grid = layout.grid
  if (layout.pages?.length) {
    return {
      version: layout.version,
      theme: layout.theme,
      grid,
      pages: layout.pages.map((page) => ({ ...page, grid: page.grid ?? grid })),
    }
  }
  return {
    version: layout.version,
    theme: layout.theme,
    grid,
    pages: [{ id: 'main', grid, cards: layout.cards ?? [] }],
  }
}

/** Card types slice 1 renders for real rather than as a placeholder. */
export const IMPLEMENTED: ReadonlySet<CardType> = new Set<CardType>(['clock'])
