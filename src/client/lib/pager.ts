/**
 * Paging between screenfuls.
 *
 * A Page is changed deliberately — a swipe, an arrow key — which is what makes
 * it a different thing from the Slideshow, that rotates on idleness. Both may
 * exist in one layout and they must not be confused.
 *
 * Only `transform` is animated. On an A8X driving a display that never sleeps,
 * animating `left` or `width` costs layout on every frame; `transform` is the
 * one property that does not.
 */

/** How far a drag must go before it counts, as a fraction of page width. */
export const COMMIT_RATIO = 0.22
/** A fast flick commits regardless of distance, in px per millisecond. */
export const FLICK_VELOCITY = 0.45

export interface SwipeDecision {
  index: number
  committed: boolean
}

/**
 * Where a drag should land. Pure, because the arithmetic is the part that is
 * subtly wrong and the DOM is not.
 */
export function resolveSwipe(
  current: number,
  count: number,
  deltaX: number,
  width: number,
  elapsedMs: number,
): SwipeDecision {
  const last = Math.max(0, count - 1)
  if (width <= 0 || count <= 1) return { index: Math.min(Math.max(current, 0), last), committed: false }

  const velocity = elapsedMs > 0 ? Math.abs(deltaX) / elapsedMs : 0
  const far = Math.abs(deltaX) / width >= COMMIT_RATIO
  const fast = velocity >= FLICK_VELOCITY
  if (!far && !fast) return { index: current, committed: false }

  // Negative delta is a leftward drag, which moves forward through the pages.
  const next = deltaX < 0 ? current + 1 : current - 1
  // Clamped, not wrapped: a wall display that loops surprises people who are
  // counting pages, and there is no affordance saying it will.
  const clamped = Math.min(Math.max(next, 0), last)
  return { index: clamped, committed: clamped !== current }
}

export interface PagerPage {
  id: string
  label?: string | undefined
}

export interface Pager {
  go(index: number): void
  destroy(): void
}

/**
 * Wire a viewport that already contains `.pager-track > .page*`.
 * Returns a handle so a re-render can tear the old one down — leaving listeners
 * on a replaced DOM tree is how a kiosk slows down over a week.
 */
export function createPager(viewport: HTMLElement, pages: PagerPage[]): Pager {
  const track = viewport.querySelector<HTMLElement>('.pager-track')
  const dots = viewport.querySelector<HTMLElement>('.pager-dots')
  let index = 0
  let startX = 0
  let startAt = 0
  let dragging = false

  const count = pages.length

  function paint(offsetPx = 0): void {
    if (!track) return
    const base = -index * viewport.clientWidth
    track.style.transform = `translate3d(${base + offsetPx}px, 0, 0)`
  }

  function setDragging(on: boolean): void {
    dragging = on
    track?.classList.toggle('dragging', on)
  }

  function go(next: number): void {
    index = Math.min(Math.max(next, 0), Math.max(0, count - 1))
    paint()
    if (dots) {
      for (const [i, dot] of [...dots.children].entries()) {
        dot.classList.toggle('is-current', i === index)
        dot.setAttribute('aria-current', i === index ? 'true' : 'false')
      }
    }
  }

  const onTouchStart = (e: TouchEvent): void => {
    if (count <= 1 || e.touches.length !== 1) return
    startX = e.touches[0]?.clientX ?? 0
    startAt = Date.now()
    setDragging(true)
  }

  const onTouchMove = (e: TouchEvent): void => {
    if (!dragging) return
    const dx = (e.touches[0]?.clientX ?? 0) - startX
    // Resist at the ends so the edge is felt rather than discovered.
    const atEdge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0)
    paint(atEdge ? dx / 3 : dx)
  }

  const onTouchEnd = (e: TouchEvent): void => {
    if (!dragging) return
    setDragging(false)
    const dx = (e.changedTouches[0]?.clientX ?? 0) - startX
    go(resolveSwipe(index, count, dx, viewport.clientWidth, Date.now() - startAt).index)
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowRight') go(index + 1)
    else if (e.key === 'ArrowLeft') go(index - 1)
    else return
    e.preventDefault()
  }

  const onResize = (): void => paint()

  viewport.addEventListener('touchstart', onTouchStart, { passive: true })
  viewport.addEventListener('touchmove', onTouchMove, { passive: true })
  viewport.addEventListener('touchend', onTouchEnd, { passive: true })
  viewport.addEventListener('touchcancel', onTouchEnd, { passive: true })
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)

  go(0)

  return {
    go,
    destroy() {
      viewport.removeEventListener('touchstart', onTouchStart)
      viewport.removeEventListener('touchmove', onTouchMove)
      viewport.removeEventListener('touchend', onTouchEnd)
      viewport.removeEventListener('touchcancel', onTouchEnd)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    },
  }
}
