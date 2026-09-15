/**
 * The `slideshow` card type: a layout-level controller, not a rendered Card.
 *
 * Per `docs/handoff/layout.schema.yaml`'s own KONTRAKT note, a `slideshow`
 * entry is declared inside `cards` (so the schema does not need a separate
 * top-level key) but renders nothing in its own grid slot — its `span` is
 * ignored, at most one may exist per layout, and it must never be nested
 * inside a `carousel`'s `slides`, a `grid`'s `cells`, or `sidebar.content`.
 *
 * This module is split in two: pure logic here (state machine + layout
 * filtering, both DOM-free and unit tested), DOM wiring lives in
 * `createSlideshowController` at the bottom, which is the impure half a test
 * would gain little from driving directly.
 */
import type { Card, CardType, NormalisedLayout, Page } from '../../shared/layout.ts'

export interface SlideshowConfig {
  cardIds: string[]
  idleTriggerSeconds: number
  intervalSeconds: number
  transition: 'slide' | 'fade'
  exitOnInteraction: boolean
  /** Accepted and carried so a layout author's intent is not silently dropped,
   *  but never acted on — out of scope for this change (camera access, local
   *  motion/face detection is a materially separate feature/decision). */
  wakeOnPresenceRequested: boolean
}

/** Card types that carry a nested `card` list and must never contain a `slideshow`. */
const CONTAINER_TYPES: ReadonlySet<CardType> = new Set<CardType>(['carousel', 'grid'])

function parseSlideshowParams(card: Card): SlideshowConfig | undefined {
  const params = (card.params ?? {}) as Record<string, unknown>
  const cardIds = Array.isArray(params.cardIds) ? params.cardIds.filter((v): v is string => typeof v === 'string') : []
  const idleTriggerSeconds = params.idleTriggerSeconds
  const intervalSeconds = params.intervalSeconds
  if (cardIds.length < 2 || typeof idleTriggerSeconds !== 'number' || typeof intervalSeconds !== 'number') {
    return undefined
  }
  const transition = params.transition === 'slide' ? 'slide' : 'fade'
  const exitOnInteraction = params.exitOnInteraction !== false
  const wakeOnPresence = params.wakeOnPresence as { enabled?: boolean } | undefined
  return {
    cardIds,
    idleTriggerSeconds,
    intervalSeconds,
    transition,
    exitOnInteraction,
    wakeOnPresenceRequested: wakeOnPresence?.enabled === true,
  }
}

export interface ExtractSlideshowResult {
  /** The layout with every `slideshow`-type card removed from every page's
   *  `cards`, so the grid row/column math never sees one. */
  layout: NormalisedLayout
  config?: SlideshowConfig
  /** Human-readable reasons a candidate was found but not used — surfaced via
   *  console.warn by the caller, never thrown: a malformed slideshow entry
   *  must not break the rest of the dashboard. */
  warnings: string[]
}

/**
 * Find at most one usable `slideshow` card across the whole layout and strip
 * every `slideshow`-type entry out of every page's card list.
 *
 * Only looks at top-level `page.cards` — deliberately does not recurse into
 * `carousel.slides` or `grid.cells`, which is what "never nested" means in
 * practice here: a nested one is simply invisible to the controller and falls
 * through to `createWidget`'s placeholder case when built as an ordinary Card.
 */
export function extractSlideshow(layout: NormalisedLayout): ExtractSlideshowResult {
  const warnings: string[] = []
  const candidates: Card[] = []
  for (const page of layout.pages) {
    for (const card of page.cards) {
      if (card.type === 'slideshow') candidates.push(card)
    }
  }

  let config: SlideshowConfig | undefined
  if (candidates.length > 0) {
    if (candidates.length > 1) {
      warnings.push(
        `${candidates.length} 'slideshow' cards found (ids: ${candidates.map((c) => c.id).join(', ')}); ` +
          `only one is allowed per layout — using '${candidates[0]?.id}', ignoring the rest.`,
      )
    }
    const first = candidates[0]
    const parsed = first ? parseSlideshowParams(first) : undefined
    if (first && !parsed) {
      warnings.push(`slideshow card '${first.id}' is missing required params (cardIds/idleTriggerSeconds/intervalSeconds) — ignored.`)
    }
    config = parsed
  }

  const filteredPages: Page[] = layout.pages.map((page) => ({
    ...page,
    cards: page.cards.filter((c) => c.type !== 'slideshow'),
  }))

  return { layout: { ...layout, pages: filteredPages }, config, warnings }
}

/**
 * Defensive nested-slideshow check for `createWidget`'s recursive container
 * building (carousel/grid): true if `card` is a `slideshow` and would be
 * built as a nested child of a container type. Used to log a warning instead
 * of silently rendering a full-screen controller's leftovers as a tiny card.
 */
export function isForbiddenNestedSlideshow(parentType: CardType, card: Card): boolean {
  return CONTAINER_TYPES.has(parentType) && card.type === 'slideshow'
}

// --- pure state machine ------------------------------------------------

export type SlideshowMode = 'active' | 'fullscreen'

export interface SlideshowState {
  mode: SlideshowMode
  /** Index into `SlideshowConfig.cardIds` of the card currently promoted
   *  full-screen. Meaningless while `mode === 'active'`. */
  index: number
}

export type SlideshowEvent =
  | { type: 'idle-timeout' }
  | { type: 'interval-tick' }
  | { type: 'interaction' }

export const INITIAL_SLIDESHOW_STATE: SlideshowState = { mode: 'active', index: 0 }

/**
 * The idle-timer state machine, DOM- and timer-free. `main.ts`'s
 * `createSlideshowController` is the only caller that drives this with real
 * timers and DOM events; everything about *when* a transition is legal lives
 * here instead, so it is testable without faking a clock.
 */
export function slideshowReducer(state: SlideshowState, event: SlideshowEvent, config: SlideshowConfig): SlideshowState {
  const count = config.cardIds.length
  switch (event.type) {
    case 'idle-timeout':
      return state.mode === 'active' ? { mode: 'fullscreen', index: 0 } : state
    case 'interval-tick':
      return state.mode === 'fullscreen' ? { mode: 'fullscreen', index: (state.index + 1) % Math.max(1, count) } : state
    case 'interaction':
      return state.mode === 'fullscreen' && config.exitOnInteraction ? { mode: 'active', index: state.index } : state
    default:
      return state
  }
}

// --- DOM wiring ----------------------------------------------------------
//
// Impure by nature (real timers, real DOM), so it is not unit tested the way
// the reducer above is — there would be little to gain from faking timers and
// a DOM just to re-prove the reducer's own transitions. What lives here is
// only "when do we dispatch which event" and "how do we paint the result".
//
// The promotion CSS class, the `.pager-track` transform, and
// `Pager.suspend()`/`resume()` are no longer owned here — they moved to
// `fullscreen-lock.ts`, the one module both this controller and a card's own
// manual fullscreen button call through, so there is exactly one place that
// touches them instead of two competing copies. This module now only decides
// *when* a card enters/rotates/exits fullscreen and runs its own idle/interval
// timers and crossfade veil.
import { enterSlideshow, exitSlideshow, isManualFullscreenActive, rotateSlideshow } from './fullscreen-lock.ts'

export interface SlideshowControllerDeps {
  /** Injected for testability of callers, not used by this module's own
   *  tests (there are none — see the note above). Defaults to `document`. */
  doc?: Document
}

export interface SlideshowController {
  /** Called while a card's own manual fullscreen owns the slot, so the idle
   *  timer does not silently fire underneath a manual session, and the
   *  rotation interval does not keep advancing while nothing shows it. */
  suspend(): void
  resume(): void
  destroy(): void
}

const ENTER_FADE = 'k7-slideshow-enter-fade'
const ENTER_SLIDE = 'k7-slideshow-enter-slide'
const VEIL_CLASS = 'k7-fullscreen-veil'

/**
 * Whether an interaction while `mode` should exit the Slideshow's own
 * fullscreen. `manualOwned` always wins to `false` regardless of the other
 * two: a card's own manual fullscreen currently owning the slot means this
 * interaction is not the household asking to leave the Slideshow at all —
 * most concretely, the touchstart/mousedown that ACQUIRES manual fullscreen
 * fires before the button's own click, so this guard is what stops that
 * acquiring tap from tearing the Slideshow down first. Pure and unit-tested
 * alongside `slideshowReducer`.
 */
export function shouldExitOnInteraction(mode: SlideshowMode, exitOnInteraction: boolean, manualOwned: boolean): boolean {
  if (manualOwned) return false
  return mode === 'fullscreen' && exitOnInteraction
}

export function createSlideshowController(config: SlideshowConfig, deps: SlideshowControllerDeps = {}): SlideshowController {
  const doc = deps.doc ?? document
  const win = doc.defaultView ?? window

  const resolvedIds = config.cardIds.filter((id) => {
    const el = doc.getElementById(id)
    if (!el) console.warn(`slideshow: cardId '${id}' does not match any rendered card — dropped from rotation.`)
    return Boolean(el)
  })
  if (resolvedIds.length < 2) {
    console.warn('slideshow: fewer than 2 resolvable cardIds after validation — controller not started.')
    return { suspend() {}, resume() {}, destroy() {} }
  }

  let state: SlideshowState = INITIAL_SLIDESHOW_STATE
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let intervalTimer: ReturnType<typeof setInterval> | undefined
  let suspended = false
  let veil: HTMLElement | undefined

  function ensureVeil(): HTMLElement {
    if (veil) return veil
    const el = doc.createElement('div')
    el.className = VEIL_CLASS
    el.hidden = true
    doc.body.appendChild(el)
    veil = el
    return el
  }

  function currentId(): string | undefined {
    return resolvedIds[state.index]
  }

  function currentEl(): HTMLElement | null {
    const id = currentId()
    return id ? doc.getElementById(id) : null
  }

  function startInterval(): void {
    intervalTimer = setInterval(rotate, Math.max(3, config.intervalSeconds) * 1000)
  }

  function enterFullscreen(): void {
    const id = currentId()
    if (id) enterSlideshow(id)
    ensureVeil().hidden = false
    const el = currentEl()
    if (el) {
      el.classList.add(config.transition === 'fade' ? ENTER_FADE : ENTER_SLIDE)
      // Force layout so the enter class's start state actually paints before
      // it is removed — otherwise the browser may coalesce both into one
      // frame and skip the transition entirely.
      void el.offsetHeight
      win.requestAnimationFrame(() => {
        el.classList.remove(ENTER_FADE, ENTER_SLIDE)
      })
    }
  }

  function exitFullscreen(): void {
    exitSlideshow()
    if (veil) veil.hidden = true
  }

  function rotate(): void {
    const outgoing = currentEl()
    outgoing?.classList.remove(ENTER_FADE, ENTER_SLIDE)
    state = slideshowReducer(state, { type: 'interval-tick' }, { ...config, cardIds: resolvedIds })
    const id = currentId()
    if (id) rotateSlideshow(id)
    const incoming = currentEl()
    if (incoming) {
      incoming.classList.add(config.transition === 'fade' ? ENTER_FADE : ENTER_SLIDE)
      void incoming.offsetHeight
      win.requestAnimationFrame(() => {
        incoming.classList.remove(ENTER_FADE, ENTER_SLIDE)
      })
    }
  }

  function scheduleIdle(): void {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      state = slideshowReducer(state, { type: 'idle-timeout' }, { ...config, cardIds: resolvedIds })
      if (state.mode !== 'fullscreen') return
      enterFullscreen()
      startInterval()
    }, Math.max(30, config.idleTriggerSeconds) * 1000)
  }

  function onInteraction(): void {
    const manualOwned = isManualFullscreenActive()
    if (state.mode === 'active') {
      // A card's own manual fullscreen owning the slot means our idle timer
      // is deliberately suspended (see `suspend()` below) — resetting it
      // here would silently undo that suspension.
      if (!manualOwned) scheduleIdle()
      return
    }
    if (!shouldExitOnInteraction(state.mode, config.exitOnInteraction, manualOwned)) return
    const next = slideshowReducer(state, { type: 'interaction' }, { ...config, cardIds: resolvedIds })
    if (next.mode === state.mode) return // exitOnInteraction is false: stay fullscreen
    state = next
    if (intervalTimer !== undefined) clearInterval(intervalTimer)
    intervalTimer = undefined
    exitFullscreen()
    scheduleIdle()
  }

  win.addEventListener('touchstart', onInteraction, { passive: true })
  win.addEventListener('mousedown', onInteraction)
  win.addEventListener('keydown', onInteraction)
  scheduleIdle()

  return {
    suspend() {
      if (suspended) return
      suspended = true
      if (state.mode === 'active') {
        if (idleTimer !== undefined) clearTimeout(idleTimer)
        idleTimer = undefined
      } else {
        if (intervalTimer !== undefined) clearInterval(intervalTimer)
        intervalTimer = undefined
      }
    },
    resume() {
      if (!suspended) return
      suspended = false
      if (state.mode === 'active') {
        scheduleIdle()
      } else {
        startInterval()
      }
    },
    destroy() {
      win.removeEventListener('touchstart', onInteraction)
      win.removeEventListener('mousedown', onInteraction)
      win.removeEventListener('keydown', onInteraction)
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      if (intervalTimer !== undefined) clearInterval(intervalTimer)
      if (state.mode === 'fullscreen') exitFullscreen()
      veil?.remove()
    },
  }
}
