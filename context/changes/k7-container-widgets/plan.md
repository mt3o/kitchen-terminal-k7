# Plan — k7-container-widgets

memory_goal: 85a5c983-13fe-4c52-a72e-9d1621485898

## Goal

Implement the four remaining `layout.schema.yaml` card types — `carousel`,
`grid`, `slideshow`, `menu` — in `src/client/main.ts`'s `createWidget` switch,
replacing the generic placeholder fallback they currently hit. Authoritative
contract: `docs/handoff/layout.schema.yaml` lines ~408-610 (`params.carousel`,
`params.grid`, `params.slideshow`, `params.menu`).

## Findings that shape the plan

- Domain model already confirms **Card**, **CardGrid**, **Slideshow**, **Page**
  as ratified/proposed entities describing exactly this territory
  ([node:49ba726c], [node:d8f13deb], [node:d2844438], [node:e1da2600]) and
  issue [node:0598ee91] already names the slideshow "declared as a card but
  behaves as a layout controller" tension. **Carousel** and **Menu** are not
  yet in the domain model — proposed as entities this session
  ([node:aff11b74] Carousel, [node:441547c8] Menu), pending human ratification.
- `createWidget(card)` in `src/client/main.ts` is a single non-exported
  function; **no circular-import problem exists** for recursion — carousel and
  grid slides/cells are built by building each nested `Card` with the *same*
  `createWidget` function (plain recursive call) and appended as **light DOM**
  children of the container custom element (`<k7-carousel>`/`<k7-grid>`), which
  project their content via `<slot>` inside the shadow DOM. No new circular
  dependency between `main.ts` and the new `.svelte` files is introduced.
- Every other card type follows the `Card.svelte` shell + custom-element
  wrapper convention (`K7Timer.svelte` is the clearest template: `import Card
  from './Card.svelte'`, `$state`/`$derived` runes, `$effect` for
  interval/timeout cleanup, `.btn-solid`/`.btn-ghost` styling paying both axes
  of padding per DESIGN.md §6).
- `pager.ts`'s `resolveSwipe` is page-level and **clamps rather than loops** —
  wrong for `carousel.loop`. A new pure module (`src/client/lib/carousel.ts`)
  is needed with loop-aware swipe resolution and index advance, mirroring
  `pager.ts`'s shape (pure functions, unit tested) but not reusing it directly.
  Carousel's own touch handlers must `stopPropagation()` so a slide-swipe is
  not also interpreted by the page-level pager (both listen on elements inside
  `.deck`, and pager's touch listeners are on `deck`, not `window`).
- `slideshow` is a **layout-level controller**, not a rendered card
  ([node:0598ee91], schema KONTRAKT note). It must be filtered out of
  `page.cards` *before* `render()`'s grid row/column math runs (that math
  already has a documented footgun around `span.rows === 0`, see
  [node:e501e6f3] — treat the filtering as happening earlier, not interacting
  with that logic at all). At most one across the whole layout; extras are
  dropped with a `console.warn`, not a thrown error (no human is at the wall
  to fix a bad layout file at 2am).
- Reparenting a Svelte custom element (`appendChild` to a new parent) fires
  `disconnectedCallback`/`connectedCallback`, which **tears down and
  re-mounts the Svelte component instance** — losing internal state (a running
  timer, mic-armed audiometer, in-progress chat scroll position). The chosen
  mechanism avoids this: promote the *already-rendered* target element in
  place to `position: fixed; inset: 0` (a CSS class), which works because nothing
  currently gives `.pager-track` (the only transformed ancestor, and a
  transform creates a containing block for `position: fixed` descendants) a
  transform while the slideshow is active — it is temporarily cleared.
  No reparenting, no component remount, no data refetch.
- `menu` **does** render a widget (occupies a real grid slot, per
  `layout.yaml`'s `menu-kuchnia`) but does not render its targets' content.
  Coordination is necessarily page-level: the menu custom element dispatches a
  bubbling+composed `CustomEvent('k7-menu-change', {detail:{cardId}})`, and
  `main.ts` (which alone has the full `items` list from `card.params`, and
  alone can call `document.getElementById`) owns a listener that toggles the
  native `hidden` attribute on every other target. `layout.yaml`'s
  `menu-kuchnia` (`audiometr`/`minutnik-kuchnia`, both on the `kuchnia` page)
  is the acceptance target — verified live via `npm run dev` + browser.
- **`[hidden]` is a UA-stylesheet rule and loses to any component that sets
  its own `:host { display: ... }`.** Only `K7Card.svelte` currently does
  (`display: block`); `K7Timer`/`K7Weather`/`K7Audiometer` etc. rely on the
  browser's default and are unaffected. To make `hidden` reliable regardless
  of which widget ends up as a menu target (including future ones with an
  explicit `:host` rule, and my own new components, which will set one), add
  one defensive rule to `app.css`: `.page [hidden] { display: none !important; }`.
  This is the kind of thing that "just happens to work" on today's two menu
  targets and silently breaks the day someone points a menu at a `clock` card.
- Hiding a target card via `[hidden]` does **not** leave a visual gap: CSS
  Grid auto-placement re-flows remaining items into the freed cells (a
  `display: none` item is not part of grid layout at all), it only leaves
  trailing cells empty if the *total* visible count drops below what the
  page's explicit row/column count was sized for. Acceptable, not a bug —
  flagged in the PR rather than solved by a dynamic row recompute (out of
  scope; the grid is currently sized once at render time from the full card
  list, a pattern already established for other cards).
- No Tabler icon asset pipeline exists anywhere in this codebase yet (no
  npm dependency, no SVG sprite, sidebar's own `toggleIcon` is unimplemented
  too — sidebar itself doesn't exist in `src/shared/layout.ts` or `main.ts`).
  `menu.items[].icon` is accepted (stored, not dropped) but rendered as plain
  label text for every `style` value in this change — flagged as a deferred
  gap, not silently faked.
- **`wakeOnPresence` is explicitly out of scope** per the task brief — a
  materially separate feature (camera access, local motion/face detection).
  `idleTriggerSeconds` + `intervalSeconds` + `transition` + `exitOnInteraction`
  are implemented fully; `wakeOnPresence` is parsed from params (so a layout
  author doesn't get a silent JSON-schema-shaped no-op) but never acted on,
  and is called out in the PR description. A **prior lifetime decision**
  already exists in the graph about this exact feature
  ([node:9ea20285] `CAMERALOCAL`: "Presence-wake from the slideshow uses the
  camera, and every frame is processed locally in the browser") — this change
  does not implement it, but does not contradict it either; it is simply not
  built yet. Noted for whoever picks it up next.

## Phases

### Phase 1 — pure logic + tests (no DOM)

1. `src/client/lib/carousel.ts`: `resolveCarouselSwipe(current, count, deltaX,
   width, elapsedMs, loop)` (loop-aware sibling of `pager.ts`'s
   `resolveSwipe`) and `advanceIndex(current, count, loop, direction)` for
   auto-advance/arrow-equivalent stepping (returns `null` when a
   non-looping carousel is already at the end, so the auto-advance timer
   knows to stop rather than tick forever against a clamped no-op).
2. `src/client/lib/slideshow.ts`: pure `slideshowReducer(state, event,
   config)` state machine (`active` ⇄ `fullscreen`, `idle-timeout` /
   `interval-tick` / `interaction` events) plus a pure `extractSlideshow
   (layout: NormalisedLayout)` that (a) finds at most one top-level
   `slideshow`-type card across all pages (warns and drops extras), (b)
   returns a `NormalisedLayout` with all `slideshow`-type cards filtered out
   of every page's `cards` array, so `render()`'s existing grid math never
   sees them.
3. `test/carousel.test.ts`, `test/slideshow.test.ts` — cover swipe resolution
   (far/fast/clamped-vs-looped), advance-index at boundaries (loop on/off),
   the reducer's four transitions, and `extractSlideshow`'s dedup/filter
   behaviour against small fixture layouts (mirrors `pager.test.ts`'s style).

### Phase 2 — CardGrid (`grid`) and Carousel (`carousel`) components

4. `src/client/lib/K7Grid.svelte` (`k7-grid`): `Card` shell, `columns`/`gap`
   attrs, a `<div class="cells"><slot></slot></div>` grid container reading
   `--cell-cols`/`--cell-gap` (set from attrs via JS, same "runtime layout
   variable" pattern `main.ts` already uses for `--deck-cols`/`--card-gap` —
   excluded from the token-contract check by the same convention, see
   [node:fb55b3b0]/[node:8a7dfeec] on how runtime vs theme vars are told
   apart). `::slotted(*) { min-width: 0; min-height: 0; overflow: hidden; }`.
5. `src/client/lib/K7Carousel.svelte` (`k7-carousel`): `Card` shell, `<slot>`
   for light-DOM slides, prev/next ghost buttons (`.btn-ghost`, both-axis
   padding), dot indicators (`showIndicators`) styled after `.pager-dot`,
   touch handlers (`stopPropagation`) driving `resolveCarouselSwipe`,
   `$effect`-managed `setTimeout`/`setInterval` for `startDelaySeconds` +
   `autoAdvanceSeconds` (cleared on destroy and on manual interaction, so a
   manual swipe doesn't fight the next auto-tick), `transition` (`slide` via
   `transform: translate3d`, `fade` via `opacity`) — transform/opacity only,
   per the A8X budget ([node:716987ce]). No `window` keydown binding (would
   collide with the page-level pager's arrow-key paging); prev/next buttons
   cover keyboard/a11y instead.
6. `src/client/main.ts`: `createWidget` grows `case 'carousel'` / `case
   'grid'` that create the container element, set its own attrs, then loop
   `params.slides`/`params.cells` calling `createWidget` recursively and
   `appendChild`-ing the result — this is what makes a grid-of-clocks or a
   carousel-of-grids actually work, not just the flat `layout.yaml` cases.
7. `.stories.ts` for both, mirroring `K7Timer.stories.ts` (import for
   registration side effect, `html` render with nested `<k7-card>` slides).

### Phase 3 — Menu (`menu`)

8. `src/client/lib/K7Menu.svelte` (`k7-menu`): `Card` shell, `items` (JSON
   string attr), `orientation`, `style`, `defaultActive`. `$state` tracks the
   active `cardId`; clicking an item updates it and dispatches
   `k7-menu-change` (`bubbles: true, composed: true`) via `$host()` (Svelte 5
   custom-element host accessor). One `$effect` fires the same event once on
   mount with the resolved initial active id, so `main.ts` has exactly one
   code path for "apply the active selection" rather than a separate
   initial-paint special case. `icon` is accepted and stored per item but
   rendered as label text (no Tabler pipeline exists yet — flagged, not
   faked).
9. `src/client/main.ts`: `case 'menu'` builds the element from `params.items`
   (validates `minItems: 2` defensively — schema should already guarantee it,
   but a hand-edited `layout.yaml` might not) and registers the
   `k7-menu-change` listener that toggles `hidden` on every *other* item's
   target (`document.getElementById(item.cardId)`), logging a `console.warn`
   for any `cardId` that resolves to nothing (typo protection, not a thrown
   error — this must never break the rest of the dashboard).
10. `app.css`: add `.page [hidden] { display: none !important; }` (see
    Findings above).
11. `.stories.ts` for `K7Menu` — visual-only; the cross-widget coordination
    is `main.ts`'s job, not the component's, so the story demonstrates the
    picker UI and active-state styling, not the hide/show wiring (documented
    as such in the story's description block).

### Phase 4 — Slideshow (`slideshow`)

12. `src/client/lib/slideshow.ts` grows a `createSlideshowController(...)`
    (impure, DOM-facing) built around the Phase 1 reducer: `window`
    listeners for `touchstart`/`mousedown`/`keydown` (mirrors `pager.ts`'s
    own choice of events) reset a single `setTimeout` for
    `idleTriggerSeconds`; on fire, enters fullscreen mode, clears
    `.pager-track`'s inline `transform` (restored via the existing `pager.go`
    handle on exit) and promotes the first target card via a CSS class
    (`position: fixed; inset: 0`), starts a `setInterval` for
    `intervalSeconds` driving `advanceIndex`-equivalent rotation with a
    slide/fade transition between the outgoing and incoming target
    (transform/opacity only, `--motion-slow`); exits on interaction when
    `exitOnInteraction` is true, restoring the pager's transform and the
    normal in-flow position of whichever card was showing.
13. `src/client/main.ts`: `render()` calls `extractSlideshow(layout)` first;
    builds pages/grid from the *filtered* layout as today; if a slideshow
    config came back, tears down any previous controller (idempotency, same
    reason `pager?.destroy()` already exists) and starts a new one after the
    deck is in the DOM (so `document.getElementById` for every `cardId`
    resolves).
14. `layout.yaml`: add one `slideshow` example so the feature is actually
    exercised on the real dashboard, respecting "at most one, never nested."
    Candidate: rotate `pogoda`, `zakupy`, `kalendarz` after a long idle
    period on the main deck — concrete values chosen during implementation
    once the real card ids are back in view.
15. CSS for the fullscreen promotion (`app.css`, global — this is
    layout-level chrome, not a single component's shadow DOM): `.k7-slideshow-*`
    classes for the fixed positioning and the slide/fade enter/exit states.

### Phase 5 — integration pass + checks

16. Manual smoke check via `npm run dev` (or `run` skill) against
    `layout.yaml`'s real `karuzela`, `grid-wskazniki`, `menu-kuchnia` trio,
    and the new `slideshow` example — carousel swipe + auto-advance, grid
    cell layout, menu hide/show, slideshow idle-trigger + rotation + exit.
    Also hand-test one nested case not in `layout.yaml` today (a grid cell
    that is itself a carousel, or vice versa) to prove the recursion actually
    works, per the task brief's explicit ask.
17. `npm run check` (lint, token contract, tokens:check, tests, build) and
    `npm run build:storybook`; fix anything flagged.
18. Memory captures for the real decisions above (already partly captured
    during research; phase-boundary captures for anything that changed
    during implementation), `append_events` journal, PR.

## Open questions flagged for human review (not blocking implementation)

1. **`wakeOnPresence` deferral** — confirmed in scope-of-non-scope by the
   task brief; flagged again here because [node:9ea20285] records camera-based
   presence-wake as an already-decided *lifetime* feature, not a maybe — a
   human should decide when it gets picked up, and by whom, given it needs
   its own privacy/consent UX decision (the layout schema's own
   `wakeOnPresence.enabled` defaults to `false`, so shipping it unimplemented
   is not a regression for anyone with a layout file written against the
   current schema).
2. **Menu's "shared slot" framing vs. `layout.yaml`'s real usage.** The
   schema prose frames `menu` as switching "which card is active in a given
   slot" (singular), suggesting the target cards might share exactly one
   grid position. The actual `menu-kuchnia` example instead gives
   `audiometr` and `minutnik-kuchnia` **each their own separate grid slot**
   and lets the menu hide one of them, leaving its cell empty (reflowed away
   by CSS Grid, not a visible hole, but the page's reserved row/column count
   doesn't shrink to match). This plan implements exactly that — the literal
   `layout.yaml` behaviour — rather than inventing a "shared slot" container
   mechanism the schema doesn't fully specify and no layout file exercises.
   A human should confirm this reading before more `menu` usages accumulate
   with the other assumption in mind.
3. **Slideshow fullscreen mechanism is CSS-promotion-in-place, not
   reparenting or cloning**, specifically to avoid Svelte's
   disconnect/reconnect component remount destroying widget state (a running
   timer, an armed audiometer). This works today because the only
   `position: fixed`-breaking ancestor (`.pager-track`'s transform) is one
   this change controls and can clear. If a future change adds another
   transformed ancestor anywhere between a card and `<body>`, the same
   containing-block problem returns silently. Worth a code comment (added)
   and worth knowing about if the shell layout gets restructured later.
4. **`menu.items[].icon` and `style: icons`/`sidebar.toggleIcon` render as
   text, not real Tabler icons** — no icon asset pipeline exists in the repo
   yet. A human should decide whether/when to add one (affects `menu` here
   and the not-yet-built `sidebar`).

## Post-implementation: independent plan review findings and how they landed

An independent fresh-context review (no inherited research bias, per this
change's "no human to do it for you" constraint) confirmed Phases 1-3 sound
as planned, and caught one real bug in Phase 4 plus one contract gap:

1. **Real bug: pager/slideshow event collision.** The promoted fullscreen
   card stays a DOM descendant of `.pager-track`/`deck` even though it is
   visually `position: fixed` — DOM bubbling follows the tree, not paint
   position. `pager.ts` was still listening for touch/keydown on that
   subtree with no awareness the slideshow owns the screen, so an
   interaction meant to exit fullscreen would *also* be read as a page
   swipe, silently repainting the pager underneath. **Fixed**: `pager.ts`'s
   `Pager` interface grew `suspend()`/`resume()` (a `suspended` flag checked
   in every handler), called by the slideshow controller around fullscreen
   entry/exit — a real, planned architectural change, not a comment.
2. **Contract gap: missing scrim.** DESIGN.md §5 grants `backdrop-filter`
   exactly two uses — "the slideshow and dialog scrim" — mirroring
   `.reconnect-veil`'s existing pattern. The original Phase 4 sketch had no
   scrim at all. **Fixed**: `.k7-slideshow-veil` in `app.css`, a sibling
   layer behind the promoted card (z-index 499 vs. the card's 500), same
   4px blur, same reasoning as `.reconnect-veil` (a filter on the content
   itself would give it a new containing block).
3. **Minor gaps**, both addressed: `slideshow.cardIds` entries that don't
   resolve via `getElementById` are now filtered out with a `console.warn`
   at controller start (mirrors the menu's existing per-item warning); a
   controller that ends up with fewer than 2 resolvable ids does not start
   at all, rather than rotating through a broken/empty set.
   `isForbiddenNestedSlideshow` is wired into `buildNestedChild`, the
   helper `createWidget`'s `carousel`/`grid` cases call for every nested
   slide/cell, and renders an explicit `[X]` diagnostic card in that slot
   rather than falling through to the generic "not implemented" placeholder
   (which would be actively wrong — slideshow *is* implemented, just illegal
   there).

Verified afterward in a real browser (headless Chromium, transient
`playwright-core` dependency added then reverted before commit — never
shipped) against `layout.yaml`'s actual `karuzela`/`grid-wskazniki`/
`menu-kuchnia` cards: carousel next-button click correctly advances both
slides' `translate3d()` values; `menu-kuchnia`'s `defaultActive` correctly
shows `audiometr`/hides `minutnik-kuchnia` on initial mount, and clicking
the second item correctly flips both, confirming the full
`k7-menu-change` → `main.ts` listener → `document.getElementById` →
`hidden` attribute → `[hidden] { display: none !important }` pipeline
works end to end with no console errors.
