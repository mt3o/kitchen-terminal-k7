/**
 * The cross-card event contract, in one place.
 *
 * Cards never import or query each other: the chat does not know whether the
 * layout has a timer, which page the recipes card is on, or whether a menu
 * hides it. It broadcasts a request on `window`, and whichever card can serve
 * it answers by writing into the event's `detail` — dispatch is synchronous,
 * so the sender reads the answer on the very next line and can tell the
 * household plainly when nothing in the layout picked the request up.
 *
 * Bringing a card on screen is main.ts's job alone (it owns the pager and the
 * menus): a card asks with {@link requestReveal} from its own host element.
 */

export const TIMER_START = 'k7-timer-start'
export const RECIPE_DRAFT = 'k7-recipe-draft'
export const SHOPPING_LIST_CHANGED = 'k7-shopping-list-changed'
/** Bubbles from a card's host to document; main.ts pages to it and selects its menu tab. */
export const REVEAL = 'k7-reveal'
/** main.ts → every k7-menu host: "make this card id your active item, if it is one of yours". */
export const MENU_SELECT = 'k7-menu-select'

export interface TimerStartDetail {
  seconds: number
  /** Written by the timer that took the request. Absent afterwards = no timer in the layout. */
  result?: 'started' | 'busy'
}

/** The unsaved shape POST /api/recipes/import and the chat's recipe-draft route both return. */
export interface RecipeDraft {
  title: string
  sourceUrl: string | null
  ingredients: string[]
  steps: string[]
  tags: string[]
}

export interface RecipeDraftDetail {
  draft: RecipeDraft
  /** Written by the recipes card: opened for review, or refused because a review is already open. */
  result?: 'opened' | 'busy'
}

export interface MenuSelectDetail {
  cardId: string
}

export function requestTimerStart(seconds: number): TimerStartDetail['result'] | 'absent' {
  const detail: TimerStartDetail = { seconds }
  window.dispatchEvent(new CustomEvent<TimerStartDetail>(TIMER_START, { detail }))
  return detail.result ?? 'absent'
}

export function offerRecipeDraft(draft: RecipeDraft): RecipeDraftDetail['result'] | 'absent' {
  const detail: RecipeDraftDetail = { draft }
  window.dispatchEvent(new CustomEvent<RecipeDraftDetail>(RECIPE_DRAFT, { detail }))
  return detail.result ?? 'absent'
}

export function announceShoppingListChanged(): void {
  window.dispatchEvent(new CustomEvent(SHOPPING_LIST_CHANGED))
}

export function requestReveal(host: HTMLElement): void {
  host.dispatchEvent(new CustomEvent(REVEAL, { bubbles: true, composed: true }))
}
