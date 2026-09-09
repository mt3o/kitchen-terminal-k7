<!--
  The card shell, as an ordinary Svelte component rather than a custom element.

  Every widget renders one of these. Keeping it a plain component and not a
  second custom element avoids slotting content across two shadow roots, which
  is the fiddly way to do this, and it keeps the shell's CSS in exactly one file
  — which is what the token contract needs to stay checkable.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    meta?: string
    state?: 'ok' | 'warn' | 'fail' | 'idle'
    /** Rendered right of the label row; for a widget's own controls. */
    actions?: Snippet
    children?: Snippet
  }

  let { label, meta = '', state = 'idle', actions, children }: Props = $props()

  // Colour never carries state alone: a wall display is read at an angle, in
  // sunlight, by people with colour-vision deficiency, through a greasy
  // protector. The glyph is the carrier; the colour reinforces it.
  const GLYPH: Record<string, string> = { ok: '[OK]', warn: '[!]', fail: '[X]', idle: '[--]' }
  let glyph = $derived(GLYPH[state] ?? GLYPH.idle)
</script>

<article class="card">
  <header class="card-head">
    <span class="hud-label">{label}</span>
    {#if actions}{@render actions()}{:else if meta}<span class="meta">{meta}</span>{/if}
  </header>

  <div class="card-body">{@render children?.()}</div>

  <footer class="card-foot">
    {#if meta && actions}<span class="meta">{meta}</span>{/if}
    <span class="badge badge-{state}">{glyph}</span>
  </footer>
</article>

<style>
  /* Elevation is a border plus a step on the surface ramp — never a shadow. A
     blurred drop shadow under a sharp-cornered amber panel looks like a mistake
     and costs a composite on every frame on an A8X. */
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    height: 100%;
    min-height: var(--card-min-h);
    padding: var(--card-pad);
    background: var(--surface);
    border: var(--border-w-strong) solid var(--border-strong);
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
    padding-bottom: var(--space-2);
  }

  .card-body { flex: 1 1 auto; min-height: 0; }

  .card-foot {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .hud-label {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--fg-muted);
  }

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
