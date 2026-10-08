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
/** main.ts (deep link) → the recipes card: "show this recipe's detail". */
export const RECIPE_OPEN = 'k7-recipe-open'
/** main.ts (deep link) → the recipes card: "leave the recipe you are showing". */
export const RECIPE_CLOSE = 'k7-recipe-close'
/** The recipes card → main.ts: the recipe on show changed (opened, closed, or a link's recipe is missing). */
export const RECIPE_SHOWN = 'k7-recipe-shown'

export interface TimerStartDetail {
  seconds: number
  /** Written by the timer that took the request. Absent afterwards = no timer in the layout. */
  result?: 'started' | 'busy'
}

/** The unsaved shape POST /api/recipes/import and the chat's recipe-draft route both return. */
export interface RecipeDraft {
  title: string
  description: string
  sourceUrl: string | null
  ingredients: string[]
  /** The method as one Markdown document — see server/domain/types.ts's Recipe. */
  stepsMarkdown: string
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

export interface RecipeOpenDetail {
  recipeId: string
  /** Written by the recipes card. `busy`: a review form is open and must not be discarded. */
  result?: 'opened' | 'busy'
}

export interface RecipeCloseDetail {
  /** Written by the recipes card. `busy` names the recipe it keeps open: its edit form is up. */
  result?: 'closed' | 'busy'
  recipeId?: string
}

export interface RecipeShownDetail {
  recipeId: string | null
  /** The recipe a link asked for does not exist (or could not be read): a fallback, not a navigation. */
  missing?: boolean
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

export function requestRecipeOpen(recipeId: string): RecipeOpenDetail['result'] | 'absent' {
  const detail: RecipeOpenDetail = { recipeId }
  window.dispatchEvent(new CustomEvent<RecipeOpenDetail>(RECIPE_OPEN, { detail }))
  return detail.result ?? 'absent'
}

export function requestRecipeClose(): RecipeCloseDetail {
  const detail: RecipeCloseDetail = {}
  window.dispatchEvent(new CustomEvent<RecipeCloseDetail>(RECIPE_CLOSE, { detail }))
  return detail
}

export function announceRecipeShown(recipeId: string | null, missing = false): void {
  const detail: RecipeShownDetail = { recipeId, ...(missing ? { missing } : {}) }
  window.dispatchEvent(new CustomEvent<RecipeShownDetail>(RECIPE_SHOWN, { detail }))
}
