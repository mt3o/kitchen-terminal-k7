# Research: k7-card-fullscreen

## Questions asked

1. Does the browser Fullscreen API (`Element.requestFullscreen`) work reliably
   for arbitrary elements on iPadOS 15 Safari (this project's hard baseline),
   including in an installed home-screen PWA?
2. How do the widgets (each its own custom element) and the shared `Card.svelte`
   shell actually compose, and would a CSS-overlay fullscreen approach survive
   that boundary?
3. Is there an existing convention worth reusing?

## Answers

**1. Don't use the native Fullscreen API — it's unreliable on this baseline.**
Apple staff have said on the WebKit developer forums that `requestFullscreen`
on an arbitrary element should work on iPadOS, but multiple developers report
it silently failing in practice. The `isElementFullscreenEnabled` WKPreferences
flag that reliably enables it only exists from iOS/iPadOS 15.4 and macOS 12.3
onward, and governs **WKWebView embedding** — not a guarantee for Mobile Safari
or an installed home-screen web app, which is what K7 is.
[Apple Developer Forums thread](https://developer.apple.com/forums/thread/133248),
[caniuse: Element API requestFullscreen](https://caniuse.com/mdn-api_element_requestfullscreen).
Captured as `[node:dd4d0966]`.

**2. There's already a proven precedent in this exact codebase — the Slideshow
never used the native API either.** `src/client/lib/slideshow.ts` +
`src/client/app.css` promote a card **in place** via a CSS class
(`k7-slideshow-active`: `position:fixed !important; inset:0; z-index:500`,
plus a `k7-slideshow-veil` backdrop at `z-index:499`), toggled directly on the
target element — no reparenting (which would tear down and remount a Svelte
custom element, per `disconnectedCallback`/`connectedCallback`, losing internal
state like a running timer), no native Fullscreen API. This works across the
custom-element/shadow-DOM boundary because Shadow DOM does not itself create a
new CSS containing block: `position:fixed` still resolves against the
viewport regardless of shadow nesting, **unless an ancestor's own style makes
it a containing block** (a `transform`, for instance). The one real gotcha
already found and fixed here: `.pager-track`'s inline transform (used for
page-swipe animation) is exactly such an ancestor, so `slideshow.ts` clears it
while fullscreen is active and restores it via `pager.go()`'s saved value on
exit (`src/client/lib/slideshow.ts:224-259`). The promoted element also stays
a DOM descendant of the pager's viewport even though it *paints* fixed, so its
touch/click events still bubble to the page-level pager underneath —
`pager.ts` grew `suspend()`/`resume()` on its `Pager` interface specifically so
an interaction meant to exit fullscreen isn't also read as a page swipe
(`src/client/lib/pager.ts:113-124, 152-160`).
Captured as `[node:009b7439]`, cross-referenced to the original decisions
`[node:ca0c4f4f]` and `[node:c4b43952]`.

**Recommendation for planning:** reuse this exact mechanism (CSS class +
`position:fixed`, pager suspend/resume, transformed-ancestor awareness) for
the new manual per-card fullscreen trait, rather than the native API or a
different approach.

## What recall did NOT answer — the actual planning agenda

- **`Card.svelte`'s `actions` snippet slot is currently unused by every
  widget** (`grep -rn "actions}" src/client/lib/*.svelte` matches only
  `Card.svelte`'s own definition). This is the natural home for a fullscreen
  button, and its emptiness means the shell itself could own the whole
  capability behind one opt-in prop (e.g. `<Card fullscreen>`), rather than
  each widget composing its own button + wiring — the true "no copy-paste"
  version of what was asked for. This is a design choice, not yet settled;
  /gw-plan should decide shell-level opt-in vs. a standalone shared
  composable each widget wires into its own `actions` snippet.
- **No existing bridge from inside a widget's Svelte tree to the page-level
  `Pager` singleton.** `main.ts` holds `pager` as a module-level variable and
  only ever hands it to `createSlideshowController` at construction time
  (`src/client/main.ts:167,175`) — the Slideshow reaches it because it's an
  external controller main.ts wires up itself. A manual fullscreen toggle
  invoked from *inside* a widget's own component (inside a separate custom
  element, inside its own Svelte app instance — Svelte context does not cross
  that boundary) has no such path today. Needs a bridge: a `CustomEvent`
  dispatched from the card and caught in `main.ts`, or a shared module-level
  singleton both sides import. Not decided here.
- **Unresolved conflict with the Slideshow itself.** The calendar card
  (`kalendarz`) is *also* one of the Slideshow's `cardIds`
  (`layout.yaml`'s `pokaz-domowy` rotates `zegar/pogoda/kalendarz/audiometr`).
  A manual fullscreen button and the Slideshow's idle-driven fullscreen would
  compete for the same mechanism (same CSS class shape, same z-index space,
  one `Pager` to suspend) with no coordination today. Captured as
  `[node:7b9b6efa]` — needs a product decision at plan time (e.g. manual
  fullscreen pauses the Slideshow's idle timer for its duration, or the two
  share one "currently promoted card" lock).
- **Button styling is settled by existing rules, not new research**: ghost
  button (transparent, strong border), never the card's one solid-amber
  control (`[node:a827e6ec]`, ONESOLID).

## Artifacts captured this session

- `[node:009b7439]` concept — the existing CSS in-place fullscreen-promotion
  mechanism (Slideshow's, to be reused).
- `[node:dd4d0966]` constraint — do not use the native Fullscreen API on this
  baseline.
- `[node:7b9b6efa]` issue — unresolved manual-fullscreen-vs-Slideshow conflict
  for a card that's in both.

## Next

Route to `/gw-plan`. Ground is understood; the three open design choices above
(shell-level opt-in vs. per-widget composable, the pager-bridge mechanism, and
the Slideshow-conflict resolution) are exactly what the plan needs to settle.
