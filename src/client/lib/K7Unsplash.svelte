<!--
  unsplash-carousel: photos from the Unsplash API, one at a time, by swipe,
  arrow buttons or auto-rotation.

  Its own card type rather than a `carousel` of `image` slides, for the reason
  comic-of-the-day is its own type: the slides are not known when the layout is
  written — the server fetches them (GET /api/unsplash, K7_UNSPLASH_ACCESS_KEY server-side) — and
  third-party photos come with attribution that is part of the contract, which
  a generic image slide has no place for. Every visible photo credits its
  photographer and Unsplash, both linked, as Unsplash's API guidelines require.

  The slide arithmetic is carousel.ts's, shared with K7Carousel.svelte, so a
  swipe here commits and loops exactly like one there. Touch handlers stop
  propagation for the same reason as there: a photo swipe is not a page swipe.
-->
<svelte:options customElement={{ tag: 'k7-unsplash' }} />

<script lang="ts">
  import Card from './Card.svelte'
  import { advanceIndex, resolveCarouselSwipe } from './carousel.ts'

  interface Props {
    /** Topic, e.g. "kitchen". Ignored when `collections` is set. */
    query?: string
    /** Comma-separated Unsplash collection ids. */
    collections?: string
    orientation?: string
    count?: string
    widthPx?: string
    cacheDurationHours?: string
    /** "0" = manual only. Custom-element attrs are strings. */
    autoAdvanceSeconds?: string
    transition?: string
    showIndicators?: string
    label?: string
  }

  let {
    query = '',
    collections = '',
    orientation = '',
    count = '10',
    widthPx = '1080',
    cacheDurationHours = '6',
    autoAdvanceSeconds = '20',
    transition = 'fade',
    showIndicators = 'true',
    label = 'FOTO.UNSPLASH',
  }: Props = $props()

  interface Photo {
    id: string
    imageUrl: string
    altText: string
    photographerName: string
    photographerUrl: string
    photoUrl: string
  }

  interface Aged {
    ageSeconds: number
    stale: boolean
    source: string
    data: Photo[]
  }

  let aged = $state<Aged | undefined>(undefined)
  let failed = $state(false)
  let current = $state(0)
  let dragOffsetPx = $state(0)
  let viewportEl = $state<HTMLDivElement | undefined>(undefined)

  let photos = $derived(aged?.data ?? [])
  let total = $derived(photos.length)
  let photo = $derived<Photo | undefined>(photos[current])
  let isFade = $derived(transition.trim().toLowerCase() === 'fade')
  let indicatorsEnabled = $derived(showIndicators.trim().toLowerCase() !== 'false')
  let autoAdvanceMs = $derived(Math.max(0, parseInt(autoAdvanceSeconds, 10) || 0) * 1000)
  let cardState = $derived<'ok' | 'warn' | 'fail' | 'idle'>(failed && !aged ? 'fail' : !aged ? 'idle' : aged.stale ? 'warn' : 'ok')
  let meta = $derived(total > 0 ? `${current + 1}/${total}` : '')

  /** Loaded now: the current photo and its neighbours, so the next swipe is not a blank frame. */
  function isNear(i: number): boolean {
    if (total <= 3) return true
    return i === current || i === (current + 1) % total || i === (current - 1 + total) % total
  }

  function slideStyle(i: number): string {
    if (isFade) return `opacity: ${i === current ? 1 : 0}`
    return `transform: translate3d(calc(${(i - current) * 100}% + ${dragOffsetPx}px), 0, 0)`
  }

  async function load(signal: AbortSignal): Promise<void> {
    try {
      const q = (v: string): string => encodeURIComponent(v)
      let url = `/api/unsplash?count=${q(count)}&widthPx=${q(widthPx)}&cacheDurationHours=${q(cacheDurationHours)}`
      if (query) url += `&query=${q(query)}`
      if (collections) url += `&collections=${q(collections)}`
      if (orientation) url += `&orientation=${q(orientation)}`
      const res = await fetch(url, { signal })
      if (!res.ok) throw new Error(`unsplash ${res.status}`)
      const next = (await res.json()) as Aged
      aged = next
      if (current >= next.data.length) current = 0
      failed = false
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      // Keep the photos already on screen: one failed refresh should not blank the card.
      failed = true
    }
  }

  $effect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    // The server caches for cacheDurationHours; asking again every half of
    // that picks up a new set soon after it exists, without hammering the route.
    const every = Math.max(1800, Number(cacheDurationHours || 6) * 1800) * 1000
    const timer = setInterval(() => void load(controller.signal), every)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  })

  let autoTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleAuto(): void {
    if (autoTimer !== undefined) clearTimeout(autoTimer)
    autoTimer = undefined
    if (autoAdvanceMs <= 0 || total <= 1) return
    autoTimer = setTimeout(() => {
      current = advanceIndex(current, total, true, 1) ?? 0
      scheduleAuto()
    }, autoAdvanceMs)
  }

  $effect(() => {
    void total
    scheduleAuto()
    return () => {
      if (autoTimer !== undefined) clearTimeout(autoTimer)
    }
  })

  function step(direction: 1 | -1): void {
    const next = advanceIndex(current, total, true, direction)
    if (next !== null) current = next
    scheduleAuto() // a manual move resets the auto-advance clock
  }

  // --- touch swipe --------------------------------------------------------
  let dragStartX = 0
  let dragStartAt = 0
  let dragging = $state(false)

  function onTouchStart(e: TouchEvent): void {
    if (total <= 1 || e.touches.length !== 1) return
    dragStartX = e.touches[0]?.clientX ?? 0
    dragStartAt = Date.now()
    dragging = true
    e.stopPropagation()
  }

  function onTouchMove(e: TouchEvent): void {
    if (!dragging) return
    e.stopPropagation()
    if (!isFade) dragOffsetPx = (e.touches[0]?.clientX ?? 0) - dragStartX
  }

  function onTouchEnd(e: TouchEvent): void {
    if (!dragging) return
    dragging = false
    e.stopPropagation()
    const dx = (e.changedTouches[0]?.clientX ?? 0) - dragStartX
    const decision = resolveCarouselSwipe(current, total, dx, viewportEl?.clientWidth ?? 0, Date.now() - dragStartAt, true)
    dragOffsetPx = 0
    current = decision.index
    scheduleAuto()
  }
</script>

<Card label={label} meta={meta} state={cardState}>
  <div class="wrap">
    {#if failed && !aged}
      <p class="msg">[!] brak zdjęć z unsplash</p>
    {:else if !aged}
      <p class="msg">wczytywanie</p>
    {:else}
      <div
        class="viewport"
        class:dragging
        role="group"
        aria-roledescription="karuzela"
        aria-label="zdjęcia"
        bind:this={viewportEl}
        ontouchstart={onTouchStart}
        ontouchmove={onTouchMove}
        ontouchend={onTouchEnd}
        ontouchcancel={onTouchEnd}
      >
        {#each photos as p, i (p.id)}
          <div class="slide" class:is-current={i === current} style={slideStyle(i)} aria-hidden={i !== current}>
            {#if isNear(i)}
              <img class="pic" src={p.imageUrl} alt={p.altText || 'zdjęcie z unsplash'} />
            {/if}
          </div>
        {/each}
      </div>
      {#if photo}
        <p class="credit">
          fot. <a href={photo.photographerUrl} target="_blank" rel="noreferrer">{photo.photographerName}</a>
          / <a href={photo.photoUrl} target="_blank" rel="noreferrer">Unsplash</a>
        </p>
      {/if}
      {#if aged.stale}
        <p class="stale">[!] zdjęcia sprzed {Math.round(aged.ageSeconds / 3600)}h</p>
      {/if}
    {/if}
  </div>
  {#snippet actions()}
    {#if total > 1}
      <div class="nav">
        <button type="button" class="btn-ghost" aria-label="poprzednie zdjęcie" onclick={() => step(-1)}>&lsaquo;</button>
        {#if indicatorsEnabled && total <= 12}
          <span class="dots" aria-hidden="true">
            {#each photos as p, i (p.id)}
              <span class="dot" class:is-current={i === current}></span>
            {/each}
          </span>
        {/if}
        <button type="button" class="btn-ghost" aria-label="następne zdjęcie" onclick={() => step(1)}>&rsaquo;</button>
      </div>
    {/if}
  {/snippet}
</Card>

<style>
  /* Same Safari height-chain fix as K7Image/K7Comic: without it the host's
     height is indefinite inside its grid cell and the image overflows. */
  :host {
    display: block;
    height: 100%;
  }

  .wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 0;
    text-align: center;
  }

  .msg { margin: 0; color: var(--fg-muted); }

  .viewport {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    overflow: hidden;
  }

  /* Only transform and opacity animate, per the A8X budget — same rule as
     K7Carousel.svelte. */
  .slide {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3);
    pointer-events: none;
    transition:
      transform var(--motion-base) var(--ease),
      opacity var(--motion-base) var(--ease);
  }
  .slide.is-current { pointer-events: auto; }
  .viewport.dragging .slide { transition: none; }

  .pic {
    display: block;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
    border: var(--border-w) solid var(--border);
  }

  .credit {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    color: var(--fg-muted);
  }
  .credit a {
    color: var(--fg-muted);
    text-decoration: underline;
  }
  .credit a:hover { color: var(--fg); }

  .stale { margin: var(--space-2) 0 0; color: var(--warn); font-size: var(--text-sm); }

  .nav {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .dots {
    display: inline-flex;
    gap: var(--space-2);
  }

  /* Square, like K7Carousel's: radius is 0 everywhere. */
  .dot {
    width: var(--space-3);
    height: var(--space-1);
    background: var(--border);
  }
  .dot.is-current { background: var(--accent); }

  .btn-ghost {
    min-height: var(--control-h-sm);
    padding: var(--space-2) var(--control-pad-x);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-label);
    background: transparent;
    color: var(--fg);
    border: var(--border-w-strong) solid var(--border-strong);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background-color var(--motion-fast) var(--ease);
  }
  .btn-ghost:hover { background: var(--ghost-hover); }
  .btn-ghost:active { background: var(--ghost-active); }

  .btn-ghost:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  @supports selector(:focus-visible) {
    .btn-ghost:focus { outline: none; }
    .btn-ghost:focus-visible {
      outline: var(--focus-w) solid var(--focus);
      outline-offset: var(--focus-offset);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .slide,
    .btn-ghost {
      transition-duration: 0ms;
    }
  }
</style>
