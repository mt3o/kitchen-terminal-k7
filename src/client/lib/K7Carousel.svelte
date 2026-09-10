<!--
  KARUZELA — the `carousel` card type: a container Card that pages through its
  slides one at a time in its own grid slot, by swipe/arrow-button or optional
  auto-rotation. In contrast to `grid`, which shows every cell at once.

  Slides are ordinary Cards, built by `main.ts`'s `createWidget` and appended as
  light-DOM children — this component only paginates them via a shadow-DOM
  <slot>, it never constructs a slide itself. `createWidget` recursing on
  carousel/grid slides is what makes a carousel-of-grids work.

  The swipe gesture is handled here rather than reusing `pager.ts` directly:
  the page-level pager clamps at both ends on purpose (looping pages would
  surprise anyone counting them), but a carousel's `loop` param means it is
  *supposed* to wrap — `carousel.ts` has the loop-aware sibling logic. Touch
  handlers call stopPropagation() so a slide swipe is not also read as a page
  swipe by the pager, which listens on an ancestor inside `.deck`.
-->
<svelte:options
  customElement={{
    tag: 'k7-carousel',
    props: {
      autoAdvanceSeconds: { reflect: true },
      startDelaySeconds: { reflect: true },
      loop: { reflect: true },
      showIndicators: { reflect: true },
      swipeEnabled: { reflect: true },
      transition: { reflect: true }
    }
  }}
/>

<script lang="ts">
  import Card from './Card.svelte'
  import { advanceIndex, resolveCarouselSwipe } from './carousel.ts'

  interface Props {
    /** "0" = no auto-advance, manual only (swipe/buttons). Custom-element attrs are strings. */
    autoAdvanceSeconds?: string
    startDelaySeconds?: string
    loop?: string
    showIndicators?: string
    swipeEnabled?: string
    transition?: string
  }

  let {
    autoAdvanceSeconds = '0',
    startDelaySeconds = '0',
    loop = 'true',
    showIndicators = 'true',
    swipeEnabled = 'true',
    transition = 'slide',
  }: Props = $props()

  let autoAdvanceMs = $derived(Math.max(0, parseInt(autoAdvanceSeconds, 10) || 0) * 1000)
  let startDelayMs = $derived(Math.max(0, parseInt(startDelaySeconds, 10) || 0) * 1000)
  let loopEnabled = $derived(loop.trim().toLowerCase() !== 'false')
  let indicatorsEnabled = $derived(showIndicators.trim().toLowerCase() !== 'false')
  let swipeAllowed = $derived(swipeEnabled.trim().toLowerCase() !== 'false')
  let isFade = $derived(transition.trim().toLowerCase() === 'fade')

  let current = $state(0)
  let count = $state(0)
  let dotIndices = $derived([...Array(count).keys()])
  // Not `$state`: a `<slot>` cannot take `bind:this` or an event-handler
  // attribute directly in a Svelte template (only attributes and `let`
  // directives), so the element is found imperatively via `querySelector`
  // once `viewportEl` mounts, below.
  let slotEl: HTMLSlotElement | undefined
  let viewportEl = $state<HTMLDivElement | undefined>(undefined)

  function slides(): HTMLElement[] {
    return (slotEl?.assignedElements({ flatten: true }) ?? []) as HTMLElement[]
  }

  /** Position every slide by hand: this is per-element state (transform/
   *  opacity) that CSS alone cannot express against an arbitrary, dynamic
   *  current index — only transform and opacity animate, per the A8X budget. */
  function paint(): void {
    const els = slides()
    count = els.length
    if (current >= count) current = Math.max(0, count - 1)
    for (const [i, el] of els.entries()) {
      const active = i === current
      el.style.position = 'absolute'
      el.style.inset = '0'
      el.style.width = '100%'
      el.style.height = '100%'
      el.style.pointerEvents = active ? 'auto' : 'none'
      el.style.zIndex = active ? '1' : '0'
      if (isFade) {
        el.style.transform = 'translate3d(0, 0, 0)'
        el.style.opacity = active ? '1' : '0'
      } else {
        el.style.transform = `translate3d(${(i - current) * 100}%, 0, 0)`
        el.style.opacity = '1'
      }
    }
  }

  function onSlotChange(): void {
    paint()
  }

  $effect(() => {
    const viewport = viewportEl
    if (!viewport) return
    const slot = viewport.querySelector('slot') ?? undefined
    slotEl = slot
    slot?.addEventListener('slotchange', onSlotChange)
    paint()
    return () => slot?.removeEventListener('slotchange', onSlotChange)
  })

  let autoTimer: ReturnType<typeof setTimeout> | undefined

  function clearAutoTimer(): void {
    if (autoTimer !== undefined) clearTimeout(autoTimer)
    autoTimer = undefined
  }

  function scheduleAuto(delayMs: number): void {
    clearAutoTimer()
    if (autoAdvanceMs <= 0 || count <= 1) return
    autoTimer = setTimeout(() => {
      const next = advanceIndex(current, count, loopEnabled, 1)
      if (next === null) return // non-looping, reached the end: stop rather than tick forever
      current = next
      paint()
      scheduleAuto(autoAdvanceMs)
    }, delayMs)
  }

  function goTo(index: number): void {
    current = Math.min(Math.max(index, 0), Math.max(0, count - 1))
    paint()
    scheduleAuto(autoAdvanceMs) // a manual move resets the auto-advance clock
  }

  function step(direction: 1 | -1): void {
    const next = advanceIndex(current, count, loopEnabled, direction)
    if (next !== null) goTo(next)
  }

  $effect(() => {
    // Re-run when auto-advance config changes; the very first schedule uses
    // startDelaySeconds, everything after uses autoAdvanceSeconds (see scheduleAuto).
    scheduleAuto(startDelayMs)
    return () => clearAutoTimer()
  })

  // --- touch swipe --------------------------------------------------------
  let dragStartX = 0
  let dragStartAt = 0
  let dragging = false

  function onTouchStart(e: TouchEvent): void {
    if (!swipeAllowed || count <= 1 || e.touches.length !== 1) return
    dragStartX = e.touches[0]?.clientX ?? 0
    dragStartAt = Date.now()
    dragging = true
    e.stopPropagation() // this is a slide swipe, not a page swipe
  }

  function onTouchMove(e: TouchEvent): void {
    if (!dragging) return
    e.stopPropagation()
    if (isFade) return // no live drag feedback for a fade transition
    const dx = (e.touches[0]?.clientX ?? 0) - dragStartX
    const width = viewportEl?.clientWidth ?? 0
    if (width <= 0) return
    for (const [i, el] of slides().entries()) {
      const base = (i - current) * width
      el.style.transform = `translate3d(${base + dx}px, 0, 0)`
    }
  }

  function onTouchEnd(e: TouchEvent): void {
    if (!dragging) return
    dragging = false
    e.stopPropagation()
    const dx = (e.changedTouches[0]?.clientX ?? 0) - dragStartX
    const width = viewportEl?.clientWidth ?? 0
    const decision = resolveCarouselSwipe(current, count, dx, width, Date.now() - dragStartAt, loopEnabled)
    goTo(decision.index) // paints regardless — snaps back to place if not committed
  }
</script>

<Card label="KARUZELA" state="ok">
  <div
    class="viewport"
    role="group"
    aria-roledescription="karuzela"
    aria-label="slajdy"
    bind:this={viewportEl}
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
    ontouchcancel={onTouchEnd}
  >
    <slot></slot>
  </div>
  {#snippet actions()}
    <div class="nav">
      {#if count > 1}
        <button
          type="button"
          class="btn-ghost"
          aria-label="poprzedni slajd"
          disabled={!loopEnabled && current === 0}
          onclick={() => step(-1)}
        >
          &lsaquo;
        </button>
        {#if indicatorsEnabled}
          <span class="dots" aria-hidden="true">
            {#each dotIndices as i (i)}
              <span class="dot" class:is-current={i === current}></span>
            {/each}
          </span>
        {/if}
        <button
          type="button"
          class="btn-ghost"
          aria-label="następny slajd"
          disabled={!loopEnabled && current === count - 1}
          onclick={() => step(1)}
        >
          &rsaquo;
        </button>
      {/if}
    </div>
  {/snippet}
</Card>

<style>
  .viewport {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  /* Only transform and opacity are animated (per-slide, via JS) — never
     width/height/filter, which force a paint on every frame on an A8X
     driving a display that never sleeps. */
  ::slotted(*) {
    transition:
      transform var(--motion-base) var(--ease),
      opacity var(--motion-base) var(--ease);
  }
  :global(.viewport.dragging) ::slotted(*) {
    transition: none;
  }

  .nav {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .dots {
    display: inline-flex;
    gap: var(--space-2);
  }

  /* Square dots, not round: radius is 0 everywhere, and a round dot here
     would be the one curved thing on the screen. */
  .dot {
    width: var(--space-3);
    height: var(--space-1);
    background: var(--border);
  }
  .dot.is-current {
    background: var(--accent);
  }

  button {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-label);
    border-radius: var(--radius);
    cursor: pointer;
    transition:
      background-color var(--motion-fast) var(--ease),
      color var(--motion-fast) var(--ease),
      border-color var(--motion-fast) var(--ease);
  }

  .btn-ghost {
    min-height: var(--control-h-sm);
    /* DESIGN.md §6: "buttons pad vertically" — min-height alone leaves a
       two-line label touching the border. */
    padding: var(--space-2) var(--control-pad-x);
    background: transparent;
    color: var(--fg);
    border: var(--border-w-strong) solid var(--border-strong);
  }
  .btn-ghost:hover {
    background: var(--ghost-hover);
    color: var(--fg);
  }
  .btn-ghost:active {
    background: var(--ghost-active);
  }
  .btn-ghost:disabled {
    color: var(--fg-disabled);
    cursor: not-allowed;
  }

  button:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  @supports selector(:focus-visible) {
    button:focus {
      outline: none;
    }
    button:focus-visible {
      outline: var(--focus-w) solid var(--focus);
      outline-offset: var(--focus-offset);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    ::slotted(*),
    button {
      transition-duration: 0ms;
    }
  }
</style>
