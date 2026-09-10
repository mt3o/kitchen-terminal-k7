/**
 * Pull-to-refresh, reimplemented rather than native.
 *
 * `html, body { overflow: hidden }` (app.css) is deliberate — "nothing scrolls,
 * ever" — so there is no native rubber-band overscroll for iOS to turn into a
 * refresh gesture, and no native pull-to-refresh exists in standalone PWA mode
 * regardless. This is a from-scratch touch gesture instead.
 *
 * Scoped to the header (`.shell-head`), not the whole document, on purpose:
 * the pager (`pager.ts`) owns horizontal touches on `#deck`, and several cards
 * own real vertical scroll internally (the shopping list, the chat log) where
 * a downward drag must scroll the list, never refresh the whole dashboard.
 * The header has neither, so touches starting there are unambiguous — no
 * "is this card already at the top of its own list" heuristic needed.
 *
 * Same discipline as pager.ts: the threshold arithmetic is pure and tested,
 * the DOM half is a thin adapter.
 */

/** How far down, in CSS px, a drag must travel before release commits a refresh. */
export const PULL_THRESHOLD_PX = 72
/** Resistance cap — the indicator (and the drag itself) never grows past this,
 *  so a very long drag does not feel like it broke free of the header. */
export const PULL_MAX_PX = 140
/** Early on, a drag more horizontal than vertical is a mis-aimed swipe, not a pull. */
const HORIZONTAL_ABORT_RATIO = 1.2

export interface PullState {
  /** 0–1 toward the commit threshold, for the indicator's fill/rotation. */
  progress: number
  /** Past the threshold — releasing now triggers a refresh. */
  committed: boolean
  /** Resisted drag distance, in px, for the indicator's own transform. */
  offsetPx: number
}

/** Pure: given how far down the finger has moved, what the indicator should show. */
export function resolvePull(deltaY: number): PullState {
  const clamped = Math.min(Math.max(deltaY, 0), PULL_MAX_PX)
  return {
    progress: Math.min(1, clamped / PULL_THRESHOLD_PX),
    committed: clamped >= PULL_THRESHOLD_PX,
    offsetPx: clamped,
  }
}

export interface PullToRefresh {
  destroy(): void
}

export interface PullToRefreshOptions {
  /** Called once, when a drag is released past the threshold. Awaited before the indicator resets. */
  onRefresh: () => Promise<void>
}

/**
 * Wires the header for the gesture and renders its own indicator element
 * (a themed chevron + label, styled purely via tokens) rather than requiring
 * one in index.html — nothing else needs to know this exists.
 */
export function createPullToRefresh(header: HTMLElement, options: PullToRefreshOptions): PullToRefresh {
  const indicator = document.createElement('div')
  indicator.className = 'pull-refresh-indicator'
  indicator.setAttribute('aria-hidden', 'true')
  // A literal glyph, not a numeric HTML entity: the token-contract scanner's
  // hex-colour check matches "#" followed by hex digits, which a `&#8964;`
  // reference looks exactly like.
  indicator.innerHTML = '<span class="pull-refresh-glyph">⌄</span><span class="pull-refresh-label">ODŚWIEŻ</span>'
  header.appendChild(indicator)

  let startX = 0
  let startY = 0
  let dragging = false
  let aborted = false
  let refreshing = false

  function paint(state: PullState): void {
    indicator.style.setProperty('--pull-offset', `${state.offsetPx}px`)
    indicator.style.setProperty('--pull-progress', String(state.progress))
    indicator.classList.toggle('is-active', state.offsetPx > 0)
    indicator.classList.toggle('is-committed', state.committed)
  }

  function reset(): void {
    dragging = false
    aborted = false
    paint({ progress: 0, committed: false, offsetPx: 0 })
  }

  const onTouchStart = (e: TouchEvent): void => {
    if (refreshing || e.touches.length !== 1) return
    startX = e.touches[0]?.clientX ?? 0
    startY = e.touches[0]?.clientY ?? 0
    dragging = true
    aborted = false
  }

  const onTouchMove = (e: TouchEvent): void => {
    if (!dragging || refreshing) return
    const dx = (e.touches[0]?.clientX ?? 0) - startX
    const dy = (e.touches[0]?.clientY ?? 0) - startY

    if (!aborted && Math.abs(dx) > Math.abs(dy) * HORIZONTAL_ABORT_RATIO) {
      aborted = true
      paint({ progress: 0, committed: false, offsetPx: 0 })
    }
    if (aborted || dy <= 0) {
      if (!aborted) paint({ progress: 0, committed: false, offsetPx: 0 })
      return
    }
    paint(resolvePull(dy))
  }

  const onTouchEnd = (e: TouchEvent): void => {
    if (!dragging || refreshing) return
    const dy = (e.changedTouches[0]?.clientY ?? 0) - startY
    const state = aborted ? { progress: 0, committed: false, offsetPx: 0 } : resolvePull(dy)
    dragging = false

    if (!state.committed) {
      reset()
      return
    }

    refreshing = true
    indicator.classList.add('is-refreshing')
    options
      .onRefresh()
      .catch(() => {
        /* boot() already shows its own reconnect scrim on failure — nothing more to do here. */
      })
      .finally(() => {
        refreshing = false
        indicator.classList.remove('is-refreshing')
        reset()
      })
  }

  header.addEventListener('touchstart', onTouchStart, { passive: true })
  header.addEventListener('touchmove', onTouchMove, { passive: true })
  header.addEventListener('touchend', onTouchEnd, { passive: true })
  header.addEventListener('touchcancel', reset, { passive: true })

  return {
    destroy() {
      header.removeEventListener('touchstart', onTouchStart)
      header.removeEventListener('touchmove', onTouchMove)
      header.removeEventListener('touchend', onTouchEnd)
      header.removeEventListener('touchcancel', reset)
      indicator.remove()
    },
  }
}
