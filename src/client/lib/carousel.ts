/**
 * Slide-advance state, for the `carousel` card type.
 *
 * A sibling of `pager.ts`'s swipe resolution rather than a reuse of it: the
 * page-level pager deliberately clamps at both ends (a wall display that loops
 * pages surprises anyone counting them), but a carousel slide track has its own
 * `loop` param and is expected to wrap when it is set. Kept pure and DOM-free so
 * the arithmetic — the part that is subtly wrong — is tested without a browser.
 */

/** How far a drag must go before it counts, as a fraction of the slide width. */
export const CAROUSEL_COMMIT_RATIO = 0.22
/** A fast flick commits regardless of distance, in px per millisecond. */
export const CAROUSEL_FLICK_VELOCITY = 0.45

export interface CarouselSwipeDecision {
  index: number
  committed: boolean
}

/**
 * Where a carousel drag should land. `loop` wraps past either end instead of
 * clamping; a non-looping carousel behaves exactly like the page pager.
 */
export function resolveCarouselSwipe(
  current: number,
  count: number,
  deltaX: number,
  width: number,
  elapsedMs: number,
  loop: boolean,
): CarouselSwipeDecision {
  const last = Math.max(0, count - 1)
  if (width <= 0 || count <= 1) return { index: Math.min(Math.max(current, 0), last), committed: false }

  const velocity = elapsedMs > 0 ? Math.abs(deltaX) / elapsedMs : 0
  const far = Math.abs(deltaX) / width >= CAROUSEL_COMMIT_RATIO
  const fast = velocity >= CAROUSEL_FLICK_VELOCITY
  if (!far && !fast) return { index: current, committed: false }

  // Negative delta is a leftward drag, which moves forward through the slides.
  const direction = deltaX < 0 ? 1 : -1
  const next = advanceIndex(current, count, loop, direction)
  // advanceIndex only returns null at a non-looping boundary in the forward
  // direction (auto-advance's "stop" case); a swipe past the last slide with
  // loop off simply has nowhere to go, which is a clamp, not a null.
  const landed = next ?? current
  return { index: landed, committed: landed !== current }
}

/**
 * Step the active slide by one in `direction` (+1 forward, -1 back).
 *
 * Returns `null` when a non-looping carousel is already at the boundary in the
 * requested direction — the signal auto-advance uses to stop its own timer
 * rather than ticking forever against a clamped no-op.
 */
export function advanceIndex(current: number, count: number, loop: boolean, direction: 1 | -1 = 1): number | null {
  // Nothing to advance to: swipe-resolution falls back to the current index
  // (a clamp), and auto-advance reads null as "stop the timer".
  if (count <= 1) return null
  const next = current + direction
  if (next < 0) return loop ? count - 1 : null
  if (next >= count) return loop ? 0 : null
  return next
}
