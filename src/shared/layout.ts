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

/** The whole screen configuration: one versioned document naming a Theme. */
export interface Layout {
  version: 1
  theme: string
  grid: { columns: number; gap?: string }
  cards: Card[]
}

/** Card types slice 1 renders for real rather than as a placeholder. */
export const IMPLEMENTED: ReadonlySet<CardType> = new Set<CardType>(['clock'])
