<!--
  The Card: the atom of the whole product. Every card type in the layout contract
  is this shell plus a body. Ships as a custom element, which is how the Web
  Components requirement is met without hand-writing one.

  CSS custom properties inherit through a shadow boundary, so the token contract
  survives encapsulation: this component can read every var(--*) the page defines
  and can define none of its own values.
-->
<svelte:options customElement={{ tag: 'k7-card', props: { label: { reflect: true }, state: { reflect: true } } }} />

<script lang="ts">
  interface Props {
    label?: string
    body?: string
    state?: 'ok' | 'warn' | 'fail' | 'idle'
    meta?: string
    glance?: string
  }

  let { label = 'KARTA', body = '', state = 'idle', meta = '', glance = '' }: Props = $props()

  // Colour never carries state alone: every state also carries a bracket glyph.
  // A wall display is read at an angle, in sunlight, through a greasy protector.
  const GLYPH: Record<string, string> = { ok: '[OK]', warn: '[!]', fail: '[X]', idle: '[--]' }
  let glyph = $derived(GLYPH[state] ?? GLYPH.idle)
</script>

<article class="card" part="card">
  <header class="card-head">
    <span class="hud-label">{label}</span>
    {#if meta}<span class="meta">{meta}</span>{/if}
  </header>

  <div class="card-body">
    {#if glance}
      <p class="glance">{glance}</p>
    {/if}
    {#if body}
      <p class="body">{body}</p>
    {/if}
  </div>

  <footer class="card-foot">
    <span class="badge badge-{state}">{glyph}</span>
  </footer>
</article>

<style>
  :host { display: block; }

  /* Elevation is a border plus a step on the surface ramp — never a shadow.
     A blurred drop shadow under a sharp-cornered amber panel looks like a
     mistake, and it costs a composite on every frame on an A8X. */
  /* border-box stated here for the same reason as Card.svelte's: app.css's
     global box-sizing rule does not reach inside this shadow root. */
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

  /* Same shell-chrome reduction as Card.svelte's own (k7-mobile-responsive)
     — this is a separate component (the clock/generic-placeholder card),
     not an importer of Card.svelte, so the fix has to land here too. */
  /* Same head-row truncation as Card.svelte's own (k7-mobile-responsive,
     2-column phone layout): a long label plus meta text can exceed a
     half-width card and get silently clipped by .card's overflow:hidden
     with no ellipsis to show it. */
  @media (max-width: 767px) {
    .card { gap: var(--space-1); padding: var(--space-2); }
    .card-head { padding-bottom: var(--space-1); }
    .hud-label, .meta {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .card-body { flex: 1 1 auto; min-height: 0; }
  .card-foot { display: flex; justify-content: flex-end; }

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

  /* Glance tier: read from the doorway at three metres, not from the counter. */
  .glance {
    margin: 0;
    font-size: var(--glance-sm);
    line-height: var(--leading-glance, 1.05);
    font-variant-numeric: tabular-nums;
    color: var(--fg);
  }

  .body { margin: 0; color: var(--fg-muted); }

  .badge {
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

  /* --- Slideshow presentation ----------------------------------------------
   *
   * Keyed on `.k7-slideshow-presenting` and deliberately NOT on
   * `.k7-fullscreen-active`, which both a Slideshow turn and a card's own
   * fullscreen button set: a card somebody opened by hand is one they mean to
   * read at arm's length, with its layout and controls where they were, while
   * a card the Slideshow put up is being looked at from the doorway with
   * nobody in the room. Taking manual control of a presenting card therefore
   * drops it back to its ordinary shape, which is the intent.
   *
   * The class lands on this component's own custom-element host, so `:host()`
   * matches it from inside the shadow root. A light-DOM rule in app.css could
   * not reach `.card-body` at all, which is why the presentation look lives in
   * each component rather than centrally.
   *
   * `--glance-lg` is the top of the glance scale — 112px, an x-height of 12.0'
   * at 3 m by DESIGN.md §4.2, well past its 8' glanceable floor. The scale has
   * no larger step on purpose. If the wall wants a clock that fills more of the
   * screen than this, that is a new `glance.xl` in the theme contract, not a
   * literal size here.
   */
  :host(.k7-slideshow-presenting) .card-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    text-align: center;
  }
  :host(.k7-slideshow-presenting) .glance { font-size: var(--glance-lg); }
  :host(.k7-slideshow-presenting) .body { font-size: var(--text-xl); }
</style>
