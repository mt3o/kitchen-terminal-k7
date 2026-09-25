/**
 * The single owner of "which card is currently promoted to fullscreen" —
 * shared by the Slideshow (idle-driven, rotates through several cards) and
 * any widget's own manual fullscreen button (k7-card-fullscreen), so there
 * is exactly one place that touches the promotion CSS class, the
 * `.pager-track` transform, and `Pager.suspend()`/`resume()` instead of two
 * competing copies.
 *
 * Split pure/impure like slideshow.ts already is: the reducer below is
 * DOM-free and unit tested; the DOM wiring at the bottom is not, the same
 * convention slideshow.ts's own DOM half follows.
 */
import { writable } from 'svelte/store'

import type { Pager } from './pager.ts'

export type FullscreenEvent =
  | { type: 'manual-acquire'; elId: string }
  | { type: 'manual-release'; elId: string }
  | { type: 'slideshow-enter'; elId: string }
  | { type: 'slideshow-rotate'; elId: string }
  | { type: 'slideshow-exit' }

export interface FullscreenLockState {
  manualElId: string | null
  slideshowElId: string | null
}

export const INITIAL_FULLSCREEN_LOCK_STATE: FullscreenLockState = { manualElId: null, slideshowElId: null }

/**
 * The promoted element is always derived, never branched on a separate
 * "does the Slideshow still want fullscreen" flag: manual always wins while
 * held (k7-card-fullscreen's coordination rule), and releasing it falls
 * through to whatever the Slideshow already has — which is how "closing
 * manual fullscreen hands back to an already-fullscreen Slideshow" falls out
 * for free, with no explicit teardown branch.
 */
export function promotedElId(state: FullscreenLockState): string | null {
  return state.manualElId ?? state.slideshowElId
}

/**
 * The element the Slideshow is presenting *on its own* — fullscreen with
 * nobody's hand on the tablet. Deliberately not the same thing as
 * `promotedElId`: a card a person opened by hand is one they mean to USE, at
 * reading distance, with its ordinary layout and its controls; a card the
 * Slideshow put up while the kitchen is empty is being read from the doorway
 * and may trade detail for size, or show more of itself than a grid cell had
 * room for. Manual ownership therefore suppresses this outright rather than
 * layering on top of it, which is also what makes taking manual control of a
 * presenting card hand it straight back to its ordinary shape.
 */
export function presentingElId(state: FullscreenLockState): string | null {
  return state.manualElId === null ? state.slideshowElId : null
}

export function fullscreenLockReducer(state: FullscreenLockState, event: FullscreenEvent): FullscreenLockState {
  switch (event.type) {
    case 'manual-acquire':
      return { ...state, manualElId: event.elId }
    case 'manual-release':
      // A release naming a card other than the current holder is ignored —
      // a stale/late release must not clobber a newer acquire.
      return state.manualElId === event.elId ? { ...state, manualElId: null } : state
    case 'slideshow-enter':
    case 'slideshow-rotate':
      return { ...state, slideshowElId: event.elId }
    case 'slideshow-exit':
      return { ...state, slideshowElId: null }
    default:
      return state
  }
}

// --- DOM wiring ------------------------------------------------------------
//
// A module-level singleton, matching main.ts's own existing idiom for
// `pager`/`slideshowController` (reassignable bindings, not a class
// constructed per call) — because `configure()` must be callable again on
// every `render()`, not just once at boot. `render()` already
// `deck.replaceChildren()`s the whole DOM subtree and destroys+recreates
// both `pager` and the Slideshow controller on every call (initial boot,
// every reconnect recovery, every pull-to-refresh); a one-time init here
// would leave this module holding a detached track, a destroyed Pager, and a
// destroyed Slideshow controller after the very first reconnect.

const ACTIVE_CLASS = 'k7-fullscreen-active'
/** Carried alongside ACTIVE_CLASS, never instead of it: a presenting card is
 *  still fullscreen, so app.css's promotion rule must keep matching. This one
 *  lands on the same custom-element host, which is what lets a component style
 *  its own presentation look from inside its shadow root via `:host(...)`.
 *
 *  Named `-presenting` rather than the more obvious `-active` because
 *  `k7-slideshow-active` is a BURNT NAME: it was what the promotion class was
 *  called before k7-card-fullscreen renamed it to `k7-fullscreen-active`, on
 *  the grounds that it had stopped being Slideshow-exclusive. Reusing the
 *  retired string for a narrower meaning would leave the project's own history
 *  describing this selector as something it is not. */
const PRESENTING_CLASS = 'k7-slideshow-presenting'

export interface FullscreenLockDeps {
  track: HTMLElement
  pager: Pager
  /** Absent when the layout has no `slideshow` card configured. */
  slideshow?: { suspend(): void; resume(): void } | undefined
  /** Injected for testability, defaults to `document`. */
  doc?: Document
}

let deps: FullscreenLockDeps | undefined
let state: FullscreenLockState = INITIAL_FULLSCREEN_LOCK_STATE
let savedTrackTransform = ''

const promoted = writable<string | null>(null)
const manualOwner = writable<string | null>(null)
const presenting = writable<string | null>(null)

/** Read-only view for `main.ts`/`Card.svelte` to subscribe to — the bridge
 *  a card's own fullscreen trait uses to know whether it currently holds
 *  the slot, without polling. */
export const promotedElIdStore = { subscribe: promoted.subscribe }

/**
 * Separate from `promotedElIdStore`: a card must know not just "am I
 * fullscreen" but specifically "do I hold it *manually*" versus "the
 * Slideshow put me here." Tapping its own button means something different
 * in each case — release in the first, acquire (taking over from the
 * Slideshow) in the second — and only the card's own id matching this store
 * tells them apart.
 */
export const manualElIdStore = { subscribe: manualOwner.subscribe }

/**
 * The Slideshow-is-presenting-me bridge, for widgets that change what they
 * SHOW rather than only how it is styled — the styling half needs no
 * subscription at all, since `PRESENTING_CLASS` lands on the host and a
 * component can match it with `:host(.k7-slideshow-presenting)` from inside its
 * own shadow root. Reach for this store only when the difference is content:
 * more forecast days, a chart a grid cell had no room for.
 */
export const presentingElIdStore = { subscribe: presenting.subscribe }

/**
 * The id fullscreen-lock addresses a widget by, resolved from any element
 * inside that widget's shadow root — its custom-element host's id. Lives here
 * rather than in each component because it is this module's own addressing
 * convention that makes it the right answer: the promotion classes go on the
 * host, so the host's id is what a component must compare against the stores
 * above. Returns undefined until the element is actually attached.
 */
export function hostIdOf(el: Element | null | undefined): string | undefined {
  if (!el) return undefined
  const root = el.getRootNode()
  return root instanceof ShadowRoot ? (root.host as HTMLElement).id || undefined : undefined
}

/**
 * A plain synchronous read, not routed through the store above: `slideshow.ts`'s
 * `onInteraction` needs to know specifically whether *manual* currently owns
 * the slot (not just "is anything promoted" — a Slideshow rotating on its own,
 * with no manual card involved, must still exit on interaction exactly as it
 * always has). Reading the module-level state directly avoids importing
 * `svelte/store`'s `get()` for a check this local.
 */
export function isManualFullscreenActive(): boolean {
  return state.manualElId !== null
}

function applyPromotion(prevElId: string | null, nextElId: string | null): void {
  if (prevElId === nextElId) return
  const doc = deps?.doc ?? document
  if (prevElId) doc.getElementById(prevElId)?.classList.remove(ACTIVE_CLASS)
  if (nextElId) doc.getElementById(nextElId)?.classList.add(ACTIVE_CLASS)
  promoted.set(nextElId)

  if (!deps) return
  // `.pager-track`'s transform is the one ancestor that would otherwise
  // become a new containing block for `position: fixed` on the promoted
  // element, resolving it against the track instead of the viewport — clear
  // it while anything is fullscreen, restore on the way back to nothing.
  if (prevElId === null && nextElId !== null) {
    savedTrackTransform = deps.track.style.transform
    deps.track.style.transform = 'none'
    deps.pager.suspend()
  } else if (prevElId !== null && nextElId === null) {
    deps.track.style.transform = savedTrackTransform
    deps.pager.resume()
  }
}

/**
 * Separate from `applyPromotion` rather than folded into it: the two track
 * different values and cross their own null boundaries at different moments —
 * manual taking over a presenting card leaves `promotedElId` untouched (it
 * only changes which id is promoted) while ending presentation entirely.
 * Touches no pager/track state; that stays `applyPromotion`'s alone.
 */
function applyPresenting(prevElId: string | null, nextElId: string | null): void {
  if (prevElId === nextElId) return
  const doc = deps?.doc ?? document
  if (prevElId) doc.getElementById(prevElId)?.classList.remove(PRESENTING_CLASS)
  if (nextElId) doc.getElementById(nextElId)?.classList.add(PRESENTING_CLASS)
  presenting.set(nextElId)
}

function dispatch(event: FullscreenEvent): void {
  const prevPromoted = promotedElId(state)
  const prevPresenting = presentingElId(state)
  const prevManual = state.manualElId
  state = fullscreenLockReducer(state, event)
  applyPromotion(prevPromoted, promotedElId(state))
  applyPresenting(prevPresenting, presentingElId(state))
  if (state.manualElId !== prevManual) manualOwner.set(state.manualElId)

  // The Slideshow's own idle-trigger/rotation timers key off `manualElId`'s
  // OWN transitions, not the derived `promotedElId` — manual acquiring the
  // Slideshow's own currently-shown card, or a different card while it
  // rotates, doesn't cross `promotedElId` through `null` at all, so a
  // pager-style trigger would silently miss both.
  if (prevManual === null && state.manualElId !== null) deps?.slideshow?.suspend()
  else if (prevManual !== null && state.manualElId === null) deps?.slideshow?.resume()
}

/**
 * Called by `main.ts`'s `render()` every time it runs — not just at boot —
 * so this module never outlives the DOM/Pager/Slideshow controller it
 * describes. Resets the pure state too: the whole DOM was just rebuilt, so
 * whatever was promoted before no longer exists to be tracked.
 */
export function configure(newDeps: FullscreenLockDeps): void {
  deps = newDeps
  state = INITIAL_FULLSCREEN_LOCK_STATE
  promoted.set(null)
  manualOwner.set(null)
  presenting.set(null)
}

export function acquireManual(elId: string): void {
  dispatch({ type: 'manual-acquire', elId })
}

export function releaseManual(elId: string): void {
  dispatch({ type: 'manual-release', elId })
}

export function enterSlideshow(elId: string): void {
  dispatch({ type: 'slideshow-enter', elId })
}

export function rotateSlideshow(elId: string): void {
  dispatch({ type: 'slideshow-rotate', elId })
}

export function exitSlideshow(): void {
  dispatch({ type: 'slideshow-exit' })
}
