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

function dispatch(event: FullscreenEvent): void {
  const prevPromoted = promotedElId(state)
  const prevManual = state.manualElId
  state = fullscreenLockReducer(state, event)
  applyPromotion(prevPromoted, promotedElId(state))
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
