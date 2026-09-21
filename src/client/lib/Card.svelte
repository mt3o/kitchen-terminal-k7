<!--
  The card shell, as an ordinary Svelte component rather than a custom element.

  Every widget renders one of these. Keeping it a plain component and not a
  second custom element avoids slotting content across two shadow roots, which
  is the fiddly way to do this, and it keeps the shell's CSS in exactly one file
  — which is what the token contract needs to stay checkable.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  import { acquireManual, manualElIdStore, releaseManual } from './fullscreen-lock.ts'

  interface Props {
    label: string
    meta?: string
    state?: 'ok' | 'warn' | 'fail' | 'idle'
    /** Rendered right of the label row; for a widget's own controls. */
    actions?: Snippet
    children?: Snippet
    /** Opt-in: renders a header button that promotes this card's own
     *  widget to fullscreen via fullscreen-lock.ts, the same mechanism the
     *  Slideshow uses. */
    fullscreen?: boolean
  }

  // Renamed from the prop's own `state` on the way in: a local binding named
  // `state` turns every `$state(...)` rune in this file into Svelte's
  // store-subscription syntax, and the compiler blames the runes rather than
  // the name (same gotcha K7Calendar.svelte's own `cardState` works around).
  let { label, meta = '', state: cardStatus = 'idle', actions, children, fullscreen = false }: Props = $props()

  // Colour never carries state alone: a wall display is read at an angle, in
  // sunlight, by people with colour-vision deficiency, through a greasy
  // protector. The glyph is the carrier; the colour reinforces it.
  const GLYPH: Record<string, string> = { ok: '[OK]', warn: '[!]', fail: '[X]', idle: '[--]' }
  let glyph = $derived(GLYPH[cardStatus] ?? GLYPH.idle)

  let cardEl: HTMLElement | undefined

  // fullscreen-lock.ts addresses elements by the id of the widget's own
  // custom-element host, not `cardEl` — `cardEl` lives inside that host's
  // shadow root, and app.css's promotion rule is a light-DOM stylesheet that
  // cannot match anything inside a shadow root at all. `getRootNode()` is
  // only meaningful once `cardEl` is actually attached to the document.
  let hostId = $state<string | undefined>(undefined)
  $effect(() => {
    if (!cardEl) return
    const root = cardEl.getRootNode()
    if (root instanceof ShadowRoot) hostId = (root.host as HTMLElement).id
  })

  // Distinct from "is this card fullscreen at all" (`$promotedElIdStore ===
  // hostId`, not tracked separately here since nothing else needs it): a
  // card can be fullscreen because the Slideshow put it there, with no
  // manual acquire ever having happened. Tapping the button means something
  // different in each case (see `onPointerDown` below), so the two must not
  // be conflated.
  let isManuallyMine = $derived(hostId !== undefined && $manualElIdStore === hostId)

  // Acquiring must happen on touchstart/mousedown, on the button itself —
  // not on click. slideshow.ts's own exit-on-interaction listener sits on
  // `window` and would otherwise see the acquiring tap first
  // (touchstart/mousedown fire before the synthetic click that follows
  // them) and tear a Slideshow's own fullscreen down before this ever runs.
  // A target-phase listener on the button runs before the same event
  // reaches that window-level one. Releasing has no such race — manual
  // ownership is already true for the whole viewing session by the time a
  // closing tap occurs — so it can safely wait for click.
  //
  // Found by real-browser testing, not by inspection: binding `onclick`
  // *reactively* to `isFullscreen ? release : undefined` is wrong — a real
  // tap's mousedown flips `isFullscreen` to true, Svelte's reactivity
  // updates the binding before the same tap's own `click` fires (mousedown
  // and click are separate browser-dispatched events with a microtask flush
  // between them), so `onclick` resolves to `release` and the tap undoes
  // its own acquire. `suppressClick` remembers that *this* interaction's
  // pointerdown already acted, so the click that follows it is a no-op
  // rather than a second, opposite toggle. `event.preventDefault()` on
  // `touchstart` additionally stops the browser from synthesizing a
  // trailing mousedown/click for that same touch (which would otherwise
  // re-trigger the same race a second way) — only needed on the acquiring
  // path; the closing tap deliberately lets the synthetic events through so
  // `suppressClick` can be reset by them before the real `click` releases.
  //
  // Also found by real-browser testing: gating this on `isFullscreen`
  // (rather than `isManuallyMine`) was a second, separate bug — when the
  // Slideshow already has this exact card fullscreen, `isFullscreen` is
  // true but manual owns nothing yet. Treating that as "already handled,
  // wait for click" leaves the acquiring tap's mousedown to bubble to
  // `window` with manual ownership still false, so slideshow.ts's own
  // exit-on-interaction guard sees an ordinary interaction and wrongly
  // exits the Slideshow's fullscreen entirely — clearing `slideshowElId`
  // before this card ever gets a chance to take manual control of it. Only
  // "I already manually hold this" should defer to click; "the Slideshow
  // put me here" must acquire immediately, same as "not fullscreen at all."
  let suppressClick = false

  function onPointerDown(event: Event): void {
    if (isManuallyMine) {
      // Already manually open by this exact tap sequence's own doing —
      // nothing to acquire; clear any stale flag from an earlier tap so a
      // later click is free to release rather than being wrongly suppressed.
      suppressClick = false
      return
    }
    // Not fullscreen at all, OR fullscreen because the Slideshow currently
    // shows it — either way, taking control now, and must win the race
    // against slideshow.ts's own window-level interaction guard.
    if (event.type === 'touchstart') event.preventDefault()
    suppressClick = true
    acquire()
  }

  function onActivate(): void {
    if (suppressClick) {
      suppressClick = false
      return
    }
    // Reached with no preceding pointerdown — a keyboard Enter/Space
    // activation, which fires `click` directly.
    if (isManuallyMine) release()
    else acquire()
  }

  function acquire(): void {
    if (hostId) acquireManual(hostId)
  }
  function release(): void {
    if (hostId) releaseManual(hostId)
  }
</script>

<article class="card" bind:this={cardEl}>
  <header class="card-head">
    <span class="hud-label">{label}</span>
    <div class="card-head-right">
      {#if actions}{@render actions()}{:else if meta}<span class="meta">{meta}</span>{/if}
      {#if fullscreen}
        <button
          type="button"
          class="fullscreen-btn"
          aria-label={isManuallyMine ? 'zamknij' : 'pelny ekran'}
          ontouchstart={onPointerDown}
          onmousedown={onPointerDown}
          onclick={onActivate}
        >{isManuallyMine ? '[ x ]' : '[ + ]'}</button>
      {/if}
    </div>
  </header>

  <div class="card-body">{@render children?.()}</div>

  <footer class="card-foot">
    {#if meta && actions}<span class="meta">{meta}</span>{/if}
    <span class="badge badge-{cardStatus}">{glyph}</span>
  </footer>
</article>

<style>
  /* Elevation is a border plus a step on the surface ramp — never a shadow. A
     blurred drop shadow under a sharp-cornered amber panel looks like a mistake
     and costs a composite on every frame on an A8X. */
  /* border-box stated here, not inherited from app.css: that sheet's
     `*, *::before, *::after` rule stops at the shadow boundary, so inside a
     widget `height: 100%` plus padding and border came out 2×(padding +
     border) taller than the grid cell, and `.page > *`'s overflow: hidden
     cut off the bottom border and the footer badge on every card. */
  .card {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 100%;
    min-height: var(--card-min-h);
    padding: var(--card-pad);
    /* --card-bg and --card-frame are a theme's pictures and brass: a flat
       surface and no frame image unless the theme supplies them, which is
       exactly the plain card this always was. */
    background: var(--card-bg);
    /* --card-border is --border-strong unless the theme sets cards apart by
       their fill instead (a white note on cork) and wants a hairline here. */
    border: var(--border-w-strong) solid var(--card-border);
    border-image: var(--card-frame);
    border-radius: var(--radius);
    color: var(--fg);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    line-height: var(--leading-body);
    overflow: hidden;
  }

  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    border-bottom: var(--border-w) solid var(--border);
    /* An ornamental rule replaces the line when the theme has one; `none`
       otherwise, and the plain border above draws as before. */
    border-image: var(--rule);
    padding-bottom: var(--space-2);
  }

  /* Found during k7-mobile-responsive's real-browser verification: on a
     page with several cards (SYSTEM's 6), the cell a card gets can be
     smaller than this shell's OWN fixed chrome (padding + head + foot +
     gaps) even before any card-specific content is considered — no
     per-card content fix can address that, since the excess isn't
     content, it's this shared shell. Padding and inter-row gaps shrink at
     the phone breakpoint; control-height-driven elements (buttons) are
     untouched — DESIGN.md's touch-target floor is not negotiable, visual
     breathing room is. */
  /* Found in the same verification pass as the chrome reduction above, once
     SYSTEM's cards went from full-width to a 2-column half-width phone
     layout: `.card-head` is `justify-content: space-between` with no
     `min-width: 0` on its children, so a long label plus a meta string (e.g.
     "2 min temu") that together exceed the now-narrower row don't shrink —
     flex items default to `min-width: auto`, refusing to shrink below their
     own content width — and the overflow is silently clipped by `.card`'s
     own `overflow: hidden` with no ellipsis to show it happened. Truncating
     keeps the head row at one line (the height budget this whole change is
     fighting for) while at least showing that something was cut. */
  @media (max-width: 767px) {
    .card { gap: var(--space-1); padding: var(--space-2); }
    .card-head { padding-bottom: var(--space-1); }
    .card-head-right { min-width: 0; }
    .hud-label, .meta {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  /* Groups actions/meta with the fullscreen button so `.card-head` still
     only ever has two flex children for `justify-content: space-between` to
     pack apart — a third top-level child would float in the middle of the
     remaining space instead of sitting next to the other header controls. */
  .card-head-right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* Same ghost-button recipe as the shell header's `.hud-button` (app.css) —
     duplicated rather than shared because this component's output lives
     inside each widget's own shadow root, which a light-DOM stylesheet like
     app.css cannot reach; only the token custom properties themselves cross
     that boundary. */
  .fullscreen-btn {
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-label);
    min-height: var(--control-h-sm);
    padding: var(--space-1) var(--space-2);
    display: inline-flex;
    align-items: center;
    background: transparent;
    color: var(--fg-muted);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    /* Its own label is literally "[ + ]" / "[ x ]" — plain text with spaces
       in it, so once .card-head-right's phone-width min-width: 0 let this
       button shrink below its natural size, the browser wrapped it onto
       three lines at the spaces instead of just staying one line and
       letting the label/meta beside it lose the truncation contest. */
    flex-shrink: 0;
    white-space: nowrap;
  }
  .fullscreen-btn:hover { background: var(--ghost-hover); color: var(--fg); }
  .fullscreen-btn:active { background: var(--ghost-active); }
  .fullscreen-btn:focus {
    outline: var(--focus-w) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
  @supports selector(:focus-visible) {
    .fullscreen-btn:focus:not(:focus-visible) { outline: none; }
  }

  .card-body { flex: 1 1 auto; min-height: 0; }

  .card-foot {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  /* The card's title. Set in the theme's display face — which, unless a theme
     names one, is the HUD label exactly: UI face, --text-sm, uppercase, tracked,
     muted. The first letter is capitalised so a theme that lowercases titles
     (script is unreadable in capitals) still starts them with a capital. */
  .hud-label {
    font-family: var(--font-display);
    font-size: var(--display-size);
    font-weight: var(--display-weight);
    text-transform: var(--display-case);
    letter-spacing: var(--display-tracking);
    line-height: var(--display-leading);
    color: var(--fg-display);
  }
  .hud-label::first-letter { text-transform: uppercase; }

  .meta {
    font-size: var(--text-xs);
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
  }

  .badge {
    margin-left: auto;
    font-size: var(--text-sm);
    letter-spacing: var(--tracking-label);
    font-variant-numeric: tabular-nums;
  }
  /* Teal means good-and-settled. Warn and fail are not amber — on an amber
     screen a warm warning is invisible. */
  .badge-ok   { color: var(--signal); }
  .badge-warn { color: var(--warn); }
  .badge-fail { color: var(--fail); }
  .badge-idle { color: var(--fg-disabled); }
</style>
