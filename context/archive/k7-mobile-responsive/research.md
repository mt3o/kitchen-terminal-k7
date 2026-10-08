# Research: k7-mobile-responsive

## Questions asked

1. Why do MINUTNIK (timer) and ASCII.DNIA (ascii-art) specifically overflow
   at phone width while other cards (recipes, comic, weather, clock) don't?
2. Does a breakpoint scheme already exist anywhere (schema, tokens, CSS), or
   does one need inventing from scratch?
3. Is the sidebar's documented phone-collapsible behavior relevant here?
4. What does the shell's page/grid layout math actually assume, and does it
   already have a scrolling escape hatch?

## Answers

**1. Root cause is a two-axis desync in the grid math, not a per-card
problem.** `main.ts`'s `render()` computes `--deck-rows` once from the
layout's declared **desktop** column count (`rows = ceil(cardCount /
columns)`) and sets it as an inline custom property at boot/reconnect —
never recomputed. `app.css`'s only phone media query
(`@media max-width:767px`) overrides `grid-template-columns` to force one
column, but never touches `grid-template-rows`, which still declares the
desktop row count. A 4-card page with `columns: 2` computes `rows: 2`
(correct for a 2×2 desktop grid); at phone width, CSS forces 1 column but
the grid still only has 2 explicit rows, so cards 3–4 fall into
browser-generated implicit rows, and since `.page` sits inside
`.deck{overflow:hidden}`, anything past the 2-row allocation is clipped.
Column reflow (CSS) and row-count math (JS) are two mechanisms that have
drifted apart — only one has a phone rule. `[node:3ea28fac]`

Compounding: `.page`'s own CSS deliberately sets `--card-min-h: 0` (overriding
the design system's 240px floor) for loading-state row stability — this
removes any safety net against the row mismatch crushing a card. Same node.

**2. A breakpoint scheme exists in prose and in an unadopted schema field —
not wired to any real CSS.** `design-system/DESIGN.md` §6 documents a full
3-tier table (≥1024px / 768–1023px / <768px) as normative prose, tied to the
(unbuilt) sidebar. The *running* theme file already carries a v2-shaped
`layout:` block (`breakpointTabletPx: 768`, `breakpointDesktopPx: 1024`)
matching `theme.schema.v2.yaml` — but `src/server/theme/generate.ts` only
reads/emits `sidebarWidthPx`/`targetViewportPx`; the two breakpoint fields
are silently dropped. The only real CSS breakpoint shipped today is one
hardcoded `767px` literal in `app.css`, coincidentally matching
`breakpointTabletPx` but not driven by it. `[node:611bc3d8]` — blocked on the
still-unsettled v1-vs-v2 theme schema adoption question (`[node:f42da1a9]`).

**3. Not in scope.** The sidebar's phone-collapsible rule (`[node:f1d7ef56]`)
is real design intent but the sidebar has no runtime representation at all —
confirmed independently by a prior `/gw-review` finding. The screenshots that
motivated this change show no sidebar, consistent with it not existing.
`[node:015d07b2]`

**4. No resize/orientation handling exists; `.deck`/`body` explicitly never
scroll.** `render()` computes layout once per boot/reconnect/pull-to-refresh,
never on resize. `app.css` states as an explicit invariant that nothing
scrolls at the page/deck level ("on the wall nobody is there to scroll
anyway") — a real tension with a phone use case where someone *is* there to
scroll. Needs an explicit decision (override at the deck level for narrow
viewports, or guarantee every card fits its cell exactly), not a silent
violation. `[node:3218cf7b]`

**Per-card specifics**, confirmed by reading the actual components:
K7Timer.svelte's idle state already has the overflow-safe
`flex:1 1 auto; min-height:0; overflow-y:auto` pattern (an established
precedent, copied from K7ShoppingList.svelte); its running/paused/finished
`.readout` state (72px text) has none of that — a real asymmetry within one
component. K7AsciiArt.svelte's `<pre>` block has `overflow:auto` but its
natural height can push the whole page past `.deck{overflow:hidden}` before
that ever activates, and iOS's overlay scrollbars give no visible affordance
anyway. `[node:97d0c4ba]`

## Artifacts captured this session

- `[node:3ea28fac]` issue — the grid-row/column desync root cause.
- `[node:3218cf7b]` constraint — the never-scrolls deck invariant vs. phone need.
- `[node:611bc3d8]` issue — breakpoint theme fields silently dropped by generate.ts.
- `[node:97d0c4ba]` issue — MINUTNIK idle/running asymmetry, ASCII.DNIA's page-level overflow.
- `[node:015d07b2]` decision — sidebar out of scope, unbuilt.
- `[node:f1d7ef56]` flagged `needs_review` (CONTRADICTED-by-absence, not by drift).

## Next

`/gw-wireframe` — go screen-by-screen with the user on how the reflow should
actually behave (deck-level scroll vs. per-card guarantees; whether to wire
the theme's breakpoint fields now or defer the v1/v2 schema question).
