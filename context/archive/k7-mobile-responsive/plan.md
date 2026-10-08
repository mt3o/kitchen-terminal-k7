# Plan: k7-mobile-responsive

Goal: `[node:ac7165c9]`. Ground covered in `research.md`. Wireframe agreed via
`/gw-wireframe`: `context/design/k7-shell-mobile/deck.json`
(`design_surface: k7-shell-mobile` in `change.md`), 4 screens —
`page-grid-reflow`, `shell-header-wrap`, `timer-readout-squeeze`,
`ascii-art-overflow`.

Root cause (`[node:3ea28fac]`): `main.ts`'s `render()` computes `--deck-rows`
once from the layout's declared **desktop** column count; the existing
`@media (max-width: 767px)` query overrides only `grid-template-columns`, so
at 1-column width the grid still only has the desktop row count's worth of
explicit rows, and later cards fall into implicit rows clipped by
`.page > * { overflow: hidden }`.

Scroll policy (`[node:1580e5d3]`, human ruling): zero page/deck-level scroll
is preserved on phone, same as desktop — every card must fit its grid cell
exactly; internal per-card scrolling is the only escape hatch, never a
page-level one.

## Non-goals

- The 768–1023px "iPad portrait" tier from DESIGN.md's own documented 3-tier
  breakpoint table is not touched — only the existing <768px query is fixed.
  DESIGN.md documents 3 tiers; the shipped app has only ever implemented one
  media query. Adding the middle tier is real, separate scope, not evidenced
  by the reported problem (phone-width screenshots, not iPad-portrait ones).
- Server-driven breakpoint numbers (`theme.layout.breakpointTabletPx`, which
  exists in the theme file but is silently dropped by
  `src/server/theme/generate.ts`, `[node:611bc3d8]`) are not wired up here —
  blocked on the still-unsettled v1-vs-v2 theme schema adoption question
  (`[node:f42da1a9]`). The existing hardcoded `767px` literal stays hardcoded.
- The Sidebar's phone-collapsible behavior (`[node:015d07b2]`) is not built —
  the sidebar has no runtime representation at all; out of scope.
- No audit of every one of the ~14–19 card types for overflow safety. Scope
  is bounded to the two cards the screenshots actually showed broken
  (Timer/MINUTNIK, ascii-art/ASCII.DNIA) plus the shell mechanisms (grid row
  math, header wrap) that make every card's *cell* correctly sized in the
  first place. Any other card found broken during Phase 4's real-browser
  verification gets captured as an issue and fixed here if trivial, or
  flagged for a follow-up change if not.

## Phase 1 — Grid row/column reflow fix

- **`src/client/app.css`**: inside the existing `@media (max-width: 767px)`
  block, add `grid-template-rows: none;` (removes the JS-computed explicit
  row count entirely at this width) and `grid-auto-rows: minmax(0, 1fr);`
  (lets CSS Grid derive the row count from the actual number of `.page`
  children — 1 column means each card is alone in its row — and distribute
  the fixed `.page` height equally among them, shrinkable). No JS change:
  `main.ts`'s `render()` keeps computing `--deck-cols`/`--deck-rows` exactly
  as today for the desktop/tablet case; the phone media query simply
  overrides both properties the same way it already overrides
  `grid-template-columns`. `[node:d8ef0463]`
- Verify: every page in `layout.yaml` (4 pages, page card counts 4–6)
  renders with the correct number of full-width rows at 375px width in a
  real browser, no card partially clipped, no card given more height than
  its `1/N` share when there's slack. This is the phase that makes every
  other phase's per-card fix meaningful — a broken row count would mask
  whether Phase 2/3's per-card overflow handling actually works.

**Modified:** `src/client/app.css`.

**Verify:** `npm run check`; real-browser check at 375×667 (iPhone 6s/SE
viewport, this project's phone floor per `[node:0bc7e618]`) for all 4 pages
in `layout.yaml`, per this project's own established "DOM/layout facts need
a real browser, not inspection" discipline (`k7-card-fullscreen`,
`k7-offline-shell`) — confirmed empirically at `/gw-plan-review` via a real
headless-Chrome test reproducing `.page`'s exact rules: 4 cards at 375×667
render 4 equal-share rows, a 900px-tall card's content shrinks to its cell
with zero clip-through, `body.scrollHeight === body.clientHeight`.

## Phase 2 — Timer readout + ascii-art overflow (the two reported cards)

- **`src/client/lib/K7Timer.svelte`**: `.readout` gets a phone-width media
  query overriding `font-size` from `var(--glance-md)` (72px) to
  `var(--glance-sm)` (48px). This is the first viewport-width typography
  swap in this codebase — caught at `/gw-plan-review`: the plan originally
  cited SIATKA's nested-card density reduction as precedent, but
  `K7Grid.svelte`'s own `--glance-sm: var(--text-xl)` override is an
  unconditional shadow-DOM cascade for nested cells, not a `@media`-width
  swap; there is no exact precedent, this is a new (small, Safari-15-safe)
  pattern, not a copy of an existing one. Not `clamp()`/`vw`-based smooth
  scaling (still a bigger new-pattern step), not container-query-based
  (Safari 15 floor, `[node:0bc7e618]`). `[node:7108856c]`'s doorway-distance
  glanceability floor (3m) is a settled/lifetime constraint that directly
  governs this token scale, but its premise is a wall-mounted kiosk read at
  a distance — a phone is handheld, read at arm's length, so the floor does
  not transfer to this state. Noted explicitly here rather than left
  unaddressed, per `/gw-plan-review`'s finding. `[node:538d1960]`. The
  idle-state preset picker (`.idle-wrap`/`.presets`) already has the correct
  `flex:1 1 auto; min-height:0; overflow-y:auto` pattern and needs no change.
- **`src/client/lib/K7AsciiArt.svelte`**: the plan's first pass (`.art`
  gaining `flex:1 1 auto; min-height:0` directly) was verified at
  `/gw-plan-review` to be a no-op via a real headless-Chrome test —
  `Card.svelte`'s `.card-body` is not itself `display:flex`, so a flex-item
  property on `.art` does nothing; `.art` stayed at its full natural content
  height (420px vs. a 148px cell in the test) and its internal `overflow:
  auto` never activated (`scrollHeight === clientHeight`). The established
  precedent (`K7ShoppingList`'s `.list`, `Timer`'s `.idle-wrap`/`.presets`)
  has a load-bearing third piece the plan first missed: the scrollable
  element's *direct parent* is its own wrapper (`.wrap`/`.idle-wrap`) that
  is itself `display:flex; flex-direction:column; height:100%; min-height:
  0;`. Fix: wrap the whole card-body conditional in a new `<div class="wrap">`
  with that same CSS, and give `.art`/`.art.fallback` `flex:1 1 auto;
  min-height:0;` as originally planned — now inside a context where that
  actually does something. `[node:97d0c4ba]`

**Modified:** `src/client/lib/K7Timer.svelte`, `src/client/lib/K7AsciiArt.svelte`.

**Verify:** `npm run check`; real-browser check of MINUTNIK in each phase
(idle/running/paused/finished) and ASCII.DNIA at 375×667, on a page squeezed
enough to actually exercise the fix (per Phase 1's row math).

## Phase 3 — Shell header wrap

- **`src/client/app.css`**: `.shell-head` gains `flex-wrap: wrap` — a direct
  application of DESIGN.md §6.1's already-documented "rows wrap before they
  crush" rule, never applied to this specific header before now. The whole
  `.shell-status` group (changelog button + status text + cursor) drops to
  its own row when tight; the title (`.hud-label`, "TERMINAL K7") stays
  single-line since it no longer competes for the same row.
  `[node:538d1960]`
- If `.shell-status`'s own three children still don't fit one line at
  375px after this, the same `flex-wrap` treatment applies one level down —
  **verify live before deciding this is needed**; do not add it speculatively.

**Modified:** `src/client/app.css`.

**Verify:** `npm run check`; real-browser check of the header at 375px width
— title never wraps, `[ i ] DZIENNIK ZMIAN` button text never wraps
mid-word, status/cursor still legible.

## Phase 4 — Real-browser verification across all 4 pages + changelog

- Full real-browser pass (transient `playwright-core` against the real
  system Chrome, this project's established precedent — installed and
  uninstalled, never committed) at 375×667, across every page in
  `layout.yaml`: confirm no card is clipped, Timer's every phase reads
  correctly at `--glance-sm`, ASCII.DNIA scrolls internally rather than
  spilling past its cell, the header never wraps the title. Also spot-check
  desktop width (1024×768) is pixel-identical to before this change — this
  is a phone-width fix, not a redesign.
- If any OTHER card (beyond Timer/ascii-art) turns out to clip at 375px once
  Phase 1's row math is correct, capture it as an issue; fix here only if
  it's the same mechanical `flex:1 1 auto; min-height:0` pattern as Phase 2,
  otherwise flag for a follow-up change rather than expanding this one's
  scope mid-flight.
- **`changelog.yaml`**: one dated entry, Polish, describing the visible
  change (the dashboard no longer clips card content or the header on a
  phone-width screen).

**Verify:** `npm run check` full suite green; real-browser scenarios above
confirmed live at both 375×667 and 1024×768; changelog entry present.

## Phase 5 — Scope expansion: real-theme re-verification broke Phase 4's premise

Phase 4's first real-browser pass was run against a split `vite --port` +
`node src/server/index.ts` dev setup. That setup's vite proxy forwards `/api`
but never `/theme.css` — confirmed via `curl`, which returned vite's SPA
fallback HTML instead of CSS — so every design token (`--glance-sm`, every
`--space-*`) resolved empty and the whole app silently rendered at
browser-default sizing. Phase 4's "0 overflow findings" was a false clear.
Re-running the same verification against a real production build (`npm run
build` + a single `node src/server/index.ts`, no split dev server) surfaced
overflow across nearly every card — far beyond Timer/ascii-art — which the
human explicitly ruled to fix in this same change rather than ship partial or
revisit the scroll policy: **"keep pushing now, retrofit every affected card
in this same change."** `[node:97d0c4ba]` (issue capturing the accurate
findings).

- **Card shell chrome reduction** (`Card.svelte`, `K7Card.svelte`): the SYSTEM
  page (6 cards) revealed that a card's own fixed chrome (padding, head/foot
  rows, inter-element gaps, border) can exceed the cell a dense page's phone
  layout gives it, before any card content is even considered. Both shell
  components shrink padding/gap/head-padding-bottom at the phone breakpoint —
  `K7Card.svelte` needed the identical fix separately since it does not
  import `Card.svelte` (backs the generic `k7-card` element for the clock
  card); it was also missing `.card-body`'s `min-height: 0`, fixed alongside.
  Human ruling: **"shrink Card's chrome at the phone breakpoint."**
  `[node:e24899db]`
- **Phone layout keeps 2 columns, not 1** (`app.css`): even after chrome
  reduction, SYSTEM's cards (67px cell, 1-column-forced) still clipped
  glance-tier text outright — not a chrome problem, a content-vs-viewport
  one. Reversed the blanket single-column-at-phone rule; every page in
  `layout.yaml` is authored with `columns: 2`, so the phone media query no
  longer overrides `grid-template-columns` at all, letting the base rule's
  `--deck-cols` apply at phone width too. Row-count derivation
  (`grid-template-rows: none; grid-auto-rows: minmax(0, 1fr)`) is unchanged
  from Phase 1. `[node:db145886]`
- **Head-row text truncation** (`Card.svelte`, `K7Card.svelte`): halving card
  width exposed that `.hud-label`/`.meta` don't shrink below content size by
  default (flex `min-width: auto`), overflowing past the card's own
  `overflow: hidden` with no ellipsis. Fixed with `min-width: 0` +
  `text-overflow: ellipsis` + `white-space: nowrap` at the phone breakpoint.
  This directly exposed a second bug: `Card.svelte`'s `.fullscreen-btn`
  renders literal `"[ + ]"`/`"[ x ]"` text with no `white-space: nowrap`, so
  once its container could shrink, the label itself wrapped onto three
  lines — fixed with `white-space: nowrap; flex-shrink: 0`. `[node:25827824]`
- **Carousel dots hidden at phone width** (`K7Carousel.svelte`): prev/dots/
  next plus the card label didn't fit a half-width header; the dots are
  redundant with the arrows' own disabled-at-the-ends state, so they are what
  gives — never the arrow buttons, which carry the touch-target floor.
  `[node:c5e8c11c]`
- **Chat composer padding reduced at phone width** (`K7Chat.svelte`): the mic
  and wyslij buttons' full horizontal padding left the message input almost
  no room in a half-width card; only `padding-left`/`padding-right` shrink,
  `min-height` (touch-target floor) is untouched. Same ruling as the carousel
  fix. `[node:c5e8c11c]`
- **Scrollable-list-plus-trailing-form retrofit** (`K7ShoppingList.svelte`,
  `K7Timer.svelte`, `K7Recipes.svelte`): each card's rigid trailing form
  (add-item, custom-duration, import-URL) had no shrink/scroll escape hatch
  of its own and spilled past the card boundary once the list above it gave
  up all its slack. Fixed by moving `overflow-y: auto` from the inner list
  (`.list`/`.presets`) to the outer wrapper (`.wrap`/`.idle-wrap`) — **and**,
  found only via real-browser verification at *desktop* width (not phone):
  the inner list must stay `flex: 0 0 auto` (natural size), never
  `flex: 1 1 auto; min-height: 0`, because a shrunk list with no overflow
  clipping of its own visually spills its overflowing rows into the form
  below rather than being contained — the squeeze-ratio bug, not a
  viewport-size one. `[node:14679772]`
- **`K7Weather.svelte`** re-verified against the real production build (its
  original fix, in Phase 2's era, was only checked against the broken
  theme-less dev setup) — the `.wrap` pattern itself was already the right
  shape, but had never actually landed against a real theme; re-applying it
  against the production build confirmed the same `display:flex;
  flex-direction:column; height:100%; min-height:0; overflow-y:auto` wrapper
  used by `K7AsciiArt.svelte`. Corrected here from an earlier draft of this
  phase, which claimed "no change needed" — caught by `/gw-review`: the file
  *is* modified in this change, not merely re-verified unchanged.
- Not touched this phase, checked and found already correct: `K7AsciiArt.svelte`,
  `K7Timer.svelte`'s `.readout`, `K7Audiometer.svelte`, `K7Menu.svelte`.

**Modified:** `src/client/lib/Card.svelte`, `src/client/lib/K7Card.svelte`,
`src/client/app.css`, `src/client/lib/K7Carousel.svelte`,
`src/client/lib/K7Chat.svelte`, `src/client/lib/K7ShoppingList.svelte`,
`src/client/lib/K7Timer.svelte`, `src/client/lib/K7Recipes.svelte`,
`src/client/lib/K7Weather.svelte`, `test/timer-presets-scroll.test.ts`
(updated to match the corrected architecture), `changelog.yaml`.

**Verify:** `npm run check` (typecheck + lint + lint:tokens + full test
suite) green; real-browser verification at 375×667 across all 4
`layout.yaml` pages against a real production build (`npm run build` +
single-server `node src/server/index.ts`, never the split dev proxy — that
gap is exactly what produced Phase 4's false clear); real-browser
verification at 1024×768 confirming the desktop/tablet render is unchanged
(dots still shown, full labels, no wrap-scroll overlap).

## Risk

- **CSS Grid `grid-auto-rows` vs `grid-template-rows` interaction is a real
  browser-engine detail, not something to trust from reading the spec
  alone** — Phase 1's own verify step is real-browser, not inspection, for
  exactly this reason (matches this project's own repeated experience that
  DOM/layout facts are easy to get wrong by inspection: `k7-card-fullscreen`
  found 2 bugs only via real-browser testing, `k7-multi-calendar`'s
  `/gw-review` found a similar pre-existing reactivity bug that static
  analysis missed).
- **Scope creep into "fix every card"** was the main risk flagged at Phase 4
  — it materialized (Phase 5), but as a deliberate, human-ruled expansion
  after a test-harness bug (not a card-design flaw) invalidated the original
  "only two cards are broken" premise, not as silent drift.
- **A split dev-server setup is not a trustworthy verification environment
  for anything theme-token-dependent** — vite's dev proxy forwards `/api`
  but not `/theme.css`, so every `var(--*)` resolves empty and the app
  renders at browser-default sizing with no visible error. Real-browser
  verification for this project must run against a production build behind
  a single server from here on.
