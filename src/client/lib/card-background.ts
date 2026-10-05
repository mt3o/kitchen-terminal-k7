/**
 * Deals each card one of the theme's card-background variants, at random.
 *
 * The theme owns the pictures: when its `ornament.cardBackground` is a list,
 * the stylesheet carries the variants as slot tokens --card-bg-0..11 (wrapping
 * round the list), says how many distinct ones there are in --card-bg-count,
 * and maps `[data-card-bg="n"]` to a --card-bg-pick of slot n's token. This
 * module only sets that attribute on a card's host element; Card.svelte and
 * K7Card.svelte paint `var(--card-bg-pick, var(--card-bg))`. So:
 *
 * - a theme with one picture (every theme but kawaii) emits no rules, the
 *   pick is never set, and the card paints --card-bg as it always did;
 * - the pick follows the mode, because --card-bg-n is defined per mode;
 * - a theme switched in later still has a rule for the slot, wrapped round
 *   its own list, so no card is ever left without a background.
 *
 * An attribute, not an inline custom property: a card host is a custom
 * element, and K7Menu's `style` is a component prop, not the
 * CSSStyleDeclaration — writing to it threw, and the boot loop retried
 * forever.
 *
 * Dealt, not rolled: the variants are shuffled into a deck and drawn in
 * order, refilled when empty, so every picture appears before any repeats and
 * two neighbours rarely share one. A card keeps its picture until the deck is
 * rebuilt — a reload, a re-render, or a theme change (redealCardBackgrounds)
 * — so nothing changes under someone reading it, and nothing animates.
 */

/** Slots the generator emits (src/server/theme/generate.ts, CARD_BG_SLOTS). */
export const CARD_BG_SLOTS = 12

/** Fisher–Yates over 0..n-1. */
export function shuffled(n: number, random: () => number = Math.random): number[] {
  const out = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j] as number, out[i] as number]
  }
  return out
}

export interface CardBackgroundDealer {
  /** The next slot to give a card, 0..CARD_BG_SLOTS-1. */
  next(count: number): number
}

/**
 * A deck over `count` variants. A change of count (another theme) starts a
 * fresh deck. A refill never starts with the variant just dealt, so the last
 * card of one round and the first of the next do not match either.
 */
export function createDealer(random: () => number = Math.random): CardBackgroundDealer {
  let deck: number[] = []
  let size = 0
  let last = -1
  return {
    next(count) {
      const n = Math.max(1, Math.min(CARD_BG_SLOTS, Math.floor(count) || 1))
      if (n !== size) {
        size = n
        deck = []
      }
      if (deck.length === 0) {
        deck = shuffled(n, random)
        if (n > 1 && deck[0] === last) deck.push(deck.shift() as number)
      }
      last = deck.shift() as number
      return last
    },
  }
}

let dealer = createDealer()
/** The variant count the cards on screen were dealt for; 0 = none known. */
let dealtFor = -1

/** How many variants the active theme offers; 0 when it offers none. */
function variantCount(doc: Document): number {
  const raw = getComputedStyle(doc.documentElement).getPropertyValue('--card-bg-count').trim()
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 1 ? n : 0
}

/**
 * Give one card host its picture. Called for every card the deck builds,
 * nested ones included, so a card inside a grid or carousel gets its own.
 *
 * Always dealt, even under a theme with one picture: the header menu swaps
 * the theme without rebuilding the cards, and a card must already hold a
 * slot when a theme with variants arrives. With no variants to go by, the
 * deal is over all twelve slots, which wrap round whatever list comes later.
 */
export function dealCardBackground(el: HTMLElement, doc: Document = document): void {
  const count = variantCount(doc)
  dealtFor = count
  el.dataset.cardBg = String(dealer.next(count || CARD_BG_SLOTS))
}

/**
 * Deal every card on screen again, from a fresh deck, in document order. For
 * when the theme changes: a card dealt under a theme with no variants (the
 * layout's default, before this tab's own choice has loaded) holds one of
 * twelve slots, and twelve slots wrapped round five pictures put the same
 * one on neighbours. Called once the new sheet has loaded, so the count read
 * is the new theme's.
 */
export function redealCardBackgrounds(doc: Document = document): void {
  dealer = createDealer()
  for (const el of doc.querySelectorAll<HTMLElement>('[data-card-bg]')) dealCardBackground(el, doc)
}

/**
 * Re-deal only if the theme now on screen offers a different number of
 * pictures than the cards were dealt for. The first render can run before
 * this tab's own theme sheet has applied — index.html swaps it in from
 * sessionStorage, and the picker then sees the href already in place and
 * never reports a change — so main.ts calls this once styles have loaded.
 */
export function redealIfThemeChanged(doc: Document = document): void {
  if (dealtFor !== -1 && variantCount(doc) !== dealtFor) redealCardBackgrounds(doc)
}
