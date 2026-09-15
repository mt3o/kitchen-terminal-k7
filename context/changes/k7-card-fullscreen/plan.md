# Plan: k7-card-fullscreen

Goal: `[node:4de33010]`. Ground covered in `research.md`. Three design
decisions already settled and captured: shell-level opt-in prop (`[node:8b93ca6f]`),
a shared Svelte store as the pager bridge (`[node:5ab29a2b]`), and the
manual-fullscreen-suspends-Slideshow coordination rule (`[node:ce2dbda2]`).

## Non-goals

- No other widget adopts `fullscreen` in this change — Calendar only.
- No native Fullscreen API (`[node:dd4d0966]`) — CSS promotion only.
- No Storybook story for K7Calendar — none exists today, and adding one is a
  separate concern from this feature.
- No change to `wakeOnPresence`/camera-driven wake — unrelated deferred feature.

## Phase 1 — Generalize the existing fullscreen mechanism into a shared, ownership-aware module

The Slideshow already solved "promote an element to fullscreen without
reparenting, on this device baseline" (`[node:009b7439]`, `[node:ca0c4f4f]`,
`[node:c4b43952]`). This phase extracts that mechanism out of `slideshow.ts`
into a module both the Slideshow and the new manual trait call through, so
there is exactly one place that touches the CSS class, the `.pager-track`
transform, and `Pager.suspend()/resume()` — not two competing copies.

**Revised after `/gw-plan-review` (2026-09-14, request-changes → fixed):
the extraction must include `rotate()`, not just `enterFullscreen`/
`exitFullscreen`.** `slideshow.ts:261-273`'s `rotate()` runs on every interval
tick and does its own direct `classList.add`/`remove` on whichever card is
currently showing, entirely bypassing enter/exit. Left uncovered, Phase 3's
scenario 4 (manually fullscreening a *different* card while the Slideshow is
mid-rotation on another one) has no mechanism behind it — nothing would ever
depromote the Slideshow's card. Fixed by making the module the **single
source of truth for which element currently holds the fullscreen slot**,
derived rather than branched:

**New: `src/client/lib/fullscreen-lock.ts`**, split pure/impure like
`slideshow.ts` already is:

- Pure state (unit tested): `{ manualElId: string | null, slideshowElId:
  string | null }`. Five events reduce into it: `manual-acquire(elId)`,
  `manual-release`, `slideshow-enter(elId)`, `slideshow-rotate(elId)`,
  `slideshow-exit`. The **promoted element is always derived**:
  `promotedElId = manualElId ?? slideshowElId` — manual always wins when
  present (per `[node:ce2dbda2]`), otherwise whatever the Slideshow currently
  has. `slideshow-rotate` updates `slideshowElId` the same way `enter` does;
  `manual-release` doesn't need a branch on "does the Slideshow still want
  fullscreen" as a separate flag — it just clears `manualElId` and the
  derived value falls through to whatever `slideshowElId` already is (`null`
  if the Slideshow isn't running, unchanged and still fullscreen if it is —
  this is where "back with the slideshow slideshowing" falls out for free).
- Impure wiring (verified by hand, matching this file's own existing
  convention of not unit-testing its DOM half): a module-level singleton,
  matching `main.ts`'s own existing idiom for `pager`/`slideshowController`
  (reassignable `let` bindings, not classes constructed per call). Exposes a
  `configure({ track, pager, slideshow })` function.

  **Revised after a fifth `/gw-plan-review` pass (2026-09-14, request-changes
  → fixed): this must be re-pointed on every `render()`, not initialized
  once.** `main.ts:85` (`render()`) already `deck.replaceChildren()`s the
  whole DOM subtree and destroys+recreates both `pager` and
  `slideshowController` on every call — not just at boot, but after every
  reconnect recovery (`main.ts`'s own comment: "`boot()` runs again after a
  reconnect") and every pull-to-refresh. A one-time init at boot would leave
  `fullscreen-lock.ts` holding a detached `track`, a destroyed `Pager`, and a
  destroyed `SlideshowController` after the very first reconnect — its
  `pager.suspend()`/`resume()` and transform clear/restore would act on
  dead objects with no effect on the live page, and its calls into the
  Slideshow's `suspend()`/`resume()` (fixes 4–5) would silently stop working
  entirely, exactly the kind of failure that surfaces on an always-on kiosk
  and nowhere else. **Fix:** `render()` calls `fullscreenLock.configure({
  track, pager, slideshow: slideshowController })` at the same point it
  already finishes reassigning `pager`/`slideshowController` (end of
  `render()`, after the `if (slideshowConfig)` block) — `slideshow` is
  `undefined` when no Slideshow is configured, same optionality as before,
  now just re-supplied every render rather than assumed to be supplied once.
  `configure()` also **resets the pure state to `{ manualElId: null,
  slideshowElId: null }`**: the entire DOM was just replaced, so any
  previously-manual-fullscreen card and the Slideshow's own promoted card no
  longer exist to be tracked, and pretending otherwise across a rebuild would
  be state describing elements that are gone.
  Takes the same `{ track, pager }` shape `SlideshowControllerDeps` already
  uses, plus the optional Slideshow controller.
  On every event, diffs the previous `promotedElId` against the new one — if
  it changed, removes the class from the old element (if any) and adds it to
  the new one (if any); this replaces `rotate()`'s current direct
  `classList` calls too, so a rotation while nothing manual is active behaves
  exactly as today, and a manual acquire that pre-empts an in-progress
  rotation correctly depromotes the Slideshow's card. `.pager-track`
  transform clear/restore and `pager.suspend()`/`resume()` key off whether
  `promotedElId` transitions to/from `null` — not off which side (manual or
  Slideshow) is asking — since either source entering or leaving fullscreen
  needs the exact same pager/transform handling.
  Exposes `acquireManual(elId)` / `releaseManual(elId)` for the trait to
  call, and `enterSlideshow(elId)` / `rotateSlideshow(elId)` /
  `exitSlideshow()` for `slideshow.ts` to call instead of touching the DOM
  itself.
- **Elements are addressed by the same DOM id `slideshow.ts` already uses
  today (`doc.getElementById(id)`, i.e. the widget's custom-element host) —
  not a bound element reference.** This is also the fix for the review's
  other finding: `app.css`'s promotion rule is a light-DOM stylesheet, and
  Shadow DOM style encapsulation means it cannot match anything inside a
  widget's shadow root. The class must land on the custom-element host, the
  same element `main.ts`'s `createWidget` already assigns `id` to — never on
  `Card.svelte`'s own `.card` (which lives inside that host's shadow root).
- Exposes a readable Svelte store over `promotedElId` (or a derived boolean),
  so `main.ts` and `Card.svelte` instances can react without polling — this
  is the bridge from `[node:5ab29a2b]`.

**Revised after a second `/gw-plan-review` pass (2026-09-14, request-changes
→ fixed): `slideshow.ts`'s own `onInteraction` must gate on manual
ownership, not just call into the lock.** Coverage so far only wired
`slideshow.ts` → `fullscreen-lock.ts` (enter/rotate/exit informing the lock).
But `onInteraction` (`slideshow.ts:285-297`) is registered on `window` for
`touchstart`/`mousedown`/`keydown` and treats *any* interaction while its own
`state.mode === 'fullscreen'` as "exit" (real deployed config:
`pokaz-domowy`'s `exitOnInteraction: true`, and `kalendarz` is one of its
`cardIds`). Composed touch/mouse events cross the shadow boundary and reach
that `window` listener during the bubble phase before the new fullscreen
button's own click handler runs — so tapping the button while the Slideshow
is fullscreen-showing that exact card would fire the Slideshow's *own* exit
path first (`exitFullscreen`/`lock.exitSlideshow()`, clearing
`slideshowElId` and flipping its reducer back to `'active'`), discarding the
very state `[node:ce2dbda2]` says should survive to resume into. The fix:
`onInteraction` reads the lock's `promotedElId`/manual-ownership signal
synchronously (a plain `get()` on the shared store, no new event needed) and
returns early — doing nothing to its own timers or reducer — whenever manual
currently owns the slot. This is the mirror image of `Pager.suspend()`/
`resume()` (`[node:c4b43952]`): that fixed the pager's own touch listeners
for exactly this class of problem; `onInteraction` is a second, separate
listener the same problem applies to, not covered by the Pager fix.

**Revised after a third `/gw-plan-review` pass (2026-09-14, request-changes
→ fixed): two more gaps, both real.**

**(a) The guard above protects the wrong tap — `manualOwned` is read before
it's true.** `touchstart`/`mousedown` (which `onInteraction` listens for on
`window`) fire *before* `click` in every real tap: `touchstart` → `touchend`
→ synthetic `mousedown` → `click`. Phase 2's button acquires on `click`, so
at the moment `onInteraction` first sees the tap that is *acquiring*
fullscreen, `manualOwned` still reads `false` — the exit-on-interaction path
runs and tears the Slideshow's fullscreen down *before* `acquireManual` ever
executes, reproducing the exact defect (a) was written to fix, on the very
tap meant to demonstrate it working. The guard only protects a *later* tap
after manual already holds the slot (e.g. an accidental stray tap while
already viewing the manual fullscreen) — not the initial acquiring tap.

**Fix:** the button acquires on `touchstart`/`mousedown` **fired on the
button element itself**, not on `click`. DOM event dispatch runs
target-phase listeners (anything bound directly on the element, including
inside its own shadow root) before the same event reaches an ancestor's
bubble-phase listener — and `window` only ever sees a listener in the bubble
phase. So a `touchstart`/`mousedown` handler on the button itself,
synchronously calling `acquireManual`, is guaranteed to run and update the
lock's store *before* the identical event goes on to reach `slideshow.ts`'s
`window`-level `onInteraction` for that same physical tap (Svelte store
`set()` notifies subscribers synchronously — no microtask gap for
`onInteraction`'s `get()` to race against). Releasing (closing manual
fullscreen) is unaffected and can stay on `click`: by the time a household
member taps to close, `manualOwned` has already been `true` for the whole
viewing session, so every `onInteraction` firing during that time already
correctly no-ops via fix (a) above — only the *acquiring* edge was racy.

**(b) `[node:ce2dbda2]` requires suspending the Slideshow's idle-trigger
timer too, not just the rotation interval and the interaction guard —
nothing did.** `scheduleIdle()`'s pending `setTimeout` (`slideshow.ts:275-283`)
keeps running regardless of manual ownership. If manual fullscreen opens
while the Slideshow is in its normal `'active'` mode (not yet fullscreen) and
the household lingers on the manually-fullscreened card past
`idleTriggerSeconds`, the idle timer still fires: the Slideshow's internal
`state.mode` flips to `'fullscreen'` and its interval timer starts — both
invisible while manual holds `promotedElId`, but very much real. On release,
the derived value falls back to a `slideshowElId` that only came into
existence *during* the manual session, dropping the household into the
Slideshow's fullscreen instead of the normal grid the manual session
actually started from.

**Fix:** `slideshow.ts`'s controller gains its own `suspend()`/`resume()`
pair on the returned `SlideshowController` (today it exposes only
`destroy()`), mirroring `Pager.suspend()`/`resume()` — `suspend()` clears
whichever of `idleTimer`/`intervalTimer` is currently set (remembering which,
via the existing `state.mode`); `resume()` reschedules accordingly:
`scheduleIdle()` fresh if it was `'active'`, restart the interval if it was
`'fullscreen'`. `fullscreen-lock.ts`'s impure wiring — already holding
`{ track, pager }` — takes an optional fourth dependency, the Slideshow
controller (optional because a layout may have none configured).

**Revised after a fourth `/gw-plan-review` pass (2026-09-14, request-changes
→ fixed): the Slideshow's `suspend()`/`resume()` must key off `manualElId`'s
own transitions, not `promotedElId`'s.** The first version of this fix wired
it to the same `promotedElId` null-transitions as the pager/track handling —
correct for the pager (which only cares "is anything fullscreen at all"),
but wrong here, because it silently misses exactly the two scenarios
`[node:ce2dbda2]` and Phase 3's own scenarios 3/4 exist to cover: manual
acquiring the *same* card the Slideshow already has promoted produces no
transition in `promotedElId` at all (it was already that value), and manual
acquiring a *different* card while the Slideshow is rotating produces a
non-null-to-non-null transition, not a null-crossing — in both cases the
Slideshow's interval would keep silently ticking, `state.index` advancing
underneath, with the drift only surfacing later as "release lands somewhere
other than where it was." **Correct trigger:** `slideshow.suspend()` fires
on every `manual-acquire` (regardless of what `promotedElId` was doing),
`slideshow.resume()` fires on every `manual-release` — this is a genuinely
different condition from the pager/track handling, not the same symmetry;
say so plainly rather than reusing "the exact same moments" language that
implied one trigger covers both.

**Rename** the CSS classes it now owns, since they stop being
Slideshow-specific: `k7-slideshow-active` → `k7-fullscreen-active`,
`k7-slideshow-veil` → `k7-fullscreen-veil` (enter-fade/enter-slide stay
Slideshow-only — the manual trait has no crossfade, it's a direct toggle).
Two string-literal sites in `slideshow.ts` (the `ACTIVE_CLASS`/veil
constants) plus `app.css`'s six rules — small, mechanical, no behavior
change.

**Modified:**
- `src/client/lib/slideshow.ts` — `enterFullscreen`/`rotate`/`exitFullscreen`
  call `lock.enterSlideshow(el)` / `lock.rotateSlideshow(el)` /
  `lock.exitSlideshow()` instead of owning the class/transform/pager logic
  or touching `classList` directly. `onInteraction` gains a guard: a small
  pure helper, `shouldExitOnInteraction(mode, exitOnInteraction,
  manualOwned)`, factored out so it is unit-testable the same way
  `slideshowReducer` is — returns `false` whenever `manualOwned` is true,
  regardless of `mode`/`exitOnInteraction`, before falling through to the
  existing logic. `SlideshowController`'s returned interface gains
  `suspend()`/`resume()` alongside the existing `destroy()`, implementing
  fix (b) above.
- `src/client/lib/fullscreen-lock.ts`'s impure wiring takes the Slideshow
  controller as an optional dependency and calls its new `suspend()` on
  every `manual-acquire` event and `resume()` on every `manual-release`
  event — keyed to `manualElId`'s own transitions, deliberately *not* the
  same `promotedElId` transitions that drive the pager/transform handling
  (see the fourth-review correction above for why those two triggers must
  differ).
- `src/client/app.css` — class renames, values unchanged.
- `src/client/main.ts` — `render()` calls `fullscreenLock.configure({ track,
  pager, slideshow: slideshowController })` once it has finished
  reassigning `pager`/`slideshowController` for this render, so the lock's
  captured references (and its pure state, reset to null/null) never
  outlive the DOM they describe — implementing the fifth-review correction.

**New test:** `test/fullscreen-lock.test.ts`, same shape as
`test/slideshow.test.ts` (pure reducer only). Cases: manual acquire while the
Slideshow owns a *different* element → manual wins, derived `promotedElId`
switches to the manual one (the Slideshow's old element is what the
DOM-wiring half must depromote); manual acquire on the *same* element the
Slideshow already has → no change in derived value; manual release while the
Slideshow still has an element set → derived value falls back to it, no
explicit "teardown" branch needed; manual release while the Slideshow has
none → derived value becomes `null`; a rotation tick while no manual owner
exists → derived value follows the Slideshow's new element (regression:
behaves exactly as today); a rotation tick while a manual owner exists →
derived value stays the manual one (Slideshow's internal `slideshowElId`
still updates, but nothing visible changes until manual releases).

**Extended test:** `test/slideshow.test.ts` gains cases for
`shouldExitOnInteraction` (defined in `slideshow.ts`, tested alongside
`slideshowReducer`): returns `false` whenever `manualOwned` is true,
regardless of `mode`/`exitOnInteraction`; matches today's existing
mode/`exitOnInteraction`-only truth table whenever `manualOwned` is false —
this is the regression check that nothing changes for the Slideshow's
existing behavior when the new trait isn't involved at all. Also covers
`suspend()`/`resume()`'s bookkeeping at the reducer/state level: suspending
while `mode==='active'` and resuming reschedules idle detection fresh;
suspending while `mode==='fullscreen'` (mid-rotation) and resuming restarts
the interval rather than re-entering fullscreen from scratch.

**Verify:** `npm run check` — new tests green, existing `slideshow.test.ts`
unchanged and still green (the reducer's own transitions aren't touched, only
where the DOM-wiring half delegates).

## Phase 2 — `fullscreen` trait on `Card.svelte`

- New optional prop `fullscreen?: boolean` (default `false`).
- When true, renders a ghost icon-button in the header, after `actions`/`meta`
  — ghost, not solid-amber (`[node:a827e6ec]`, ONESOLID: a card gets one solid
  control at most, and this isn't it). Icon only, no label text (header is
  already tight); an accessible name via `aria-label` (Polish, matching the
  rest of the UI's language — "PELNY EKRAN" / "ZAMKNIJ" depending on state).
- **Revised after `/gw-plan-review`: the trait addresses its own
  custom-element host, not `.card`.** `bind:this` on the root `.card` element
  is still needed (to derive the host from it), but `acquireManual`/
  `releaseManual` are called with `(cardEl.getRootNode() as
  ShadowRoot).host.id` — the same id `main.ts` already assigned to the
  widget's host element — not the `.card` reference itself. This is a new
  technique for this codebase (nothing here currently reads
  `getRootNode()`/`.host`); worth a one-line comment at the call site
  explaining why, matching this project's habit of a WHY-comment on a
  non-obvious constraint.
- `isFullscreen` is **derived by comparing the lock module's `promotedElId`
  store against this card's own host id** (from the same `getRootNode()`
  lookup, read once on mount), not a fully local `$state` boolean — so if the
  Slideshow (or, later, another manually-fullscreened card) changes which
  element holds the slot, this card's button state and `class:` binding stay
  correct without polling or guessing.
- **Revised after the third `/gw-plan-review` pass: acquiring must happen on
  `touchstart`/`mousedown` at the button itself, not on `click`.** `click`
  fires last in the sequence (`touchstart` → `touchend` → synthetic
  `mousedown` → `click`), *after* `slideshow.ts`'s `window`-level
  `onInteraction` has already seen and acted on the earlier events in that
  same sequence — so acquiring on `click` is too late to prevent the race
  fix (a) in Phase 1 exists to close. The button's own `touchstart`/
  `mousedown` handlers call `acquireManual` directly (target-phase listeners
  run before the same event reaches an ancestor's bubble-phase listener,
  `window` included) — this is what makes `onInteraction`'s `manualOwned`
  check actually see `true` in time. **Releasing stays on `click`** — no race
  there, since `manualOwned` has already been `true` for the entire viewing
  session by the time a closing tap occurs.
- CSS: the button uses existing ghost-button tokens (ghost pattern already
  used elsewhere in the design system — ghost buttons are already in fixed
  supply per the codebase, sized to `--control-h-sm` like other header-scale
  controls). The promotion class (`k7-fullscreen-active`, renamed in Phase 1)
  stays exactly where it already lives — `app.css`, applied to the
  custom-element host — Phase 2 adds no new CSS for the promoted state
  itself, only for the button.

**Modified:** `src/client/lib/Card.svelte`, `src/client/app.css` (button
styling).

**Verify:** no automated test — this project doesn't unit-test Svelte DOM
wiring (established pattern: `slideshow.ts`'s impure half has none either,
and `k7-offline-shell`'s own notes record that headless browser automation
lied about Service Worker registration timing). Real-browser check folded
into Phase 3.

## Phase 3 — Wire K7Calendar, verify all five coordination scenarios, changelog

- `src/client/lib/K7Calendar.svelte`: pass `fullscreen` to its `<Card>` usage
  (one line, per the design's whole point).
- **Real-browser verification** (`npm run dev`, real Chromium — headless
  timing already burned this project once on Service Worker registration;
  same discipline applies to fullscreen/DOM promotion):
  1. Normal page view (Slideshow idle, not rotating): tap Calendar's
     fullscreen button → card fills viewport; tap again → returns to grid.
     Page-swipe gesture is inert while fullscreen, works again after.
  2. Force the Slideshow into its own fullscreen rotation (short
     `idleTriggerSeconds` in a scratch layout, or wait it out): confirm
     rotation continues as today when nothing manual happens.
  3. While the Slideshow is fullscreen-rotating and has landed on the
     calendar card, tap its fullscreen button: rotation stops (interval timer
     paused), card stays fullscreen (no flicker — it was already there).
     **Wait past `intervalSeconds` before closing it** — this is the case
     the fourth review pass caught: `promotedElId` never changes value here
     (it's the calendar throughout), so a wrong implementation could leave
     the interval timer running silently underneath with no visible symptom
     until release. Close it: rotation resumes **from the same card it was
     on before the tap** (not one or more rotations further along), still
     fullscreen (per `[node:ce2dbda2]` — "back with the slideshow
     slideshowing"), not dropped to the normal grid.
  4. While the Slideshow is fullscreen-rotating on a *different* card
     (weather, say) and the household opens the calendar's fullscreen from a
     different page (calendar isn't currently the one shown): confirm the
     Slideshow's rotation is paused (doesn't yank the screen away from the
     manually-opened calendar). **Wait past `intervalSeconds` before
     closing** — same reasoning as scenario 3, since `promotedElId` here
     transitions between two non-null values, not through `null`. Closing
     calendar's fullscreen returns to the Slideshow, still fullscreen, on
     the **same card it had before** (weather), continuing to rotate from
     there.
  5. **Added after the third `/gw-plan-review` pass** — the idle-timer dwell
     case: from normal page view (Slideshow in its normal `'active'` mode,
     not fullscreen), open the calendar's manual fullscreen and *leave it
     open* past whatever `idleTriggerSeconds` the scratch layout uses.
     Confirm the Slideshow's idle timer did not silently fire underneath
     (i.e. it does not start rotating while manual is still showing, and —
     the actual regression this guards — closing manual fullscreen afterward
     returns to the **normal grid**, not to an unexpected Slideshow
     fullscreen the household never asked for).
- `changelog.yaml`: one dated entry, Polish, describing the visible feature
  (per CLAUDE.md's standing constraint — same change that ships it).

**Verify:** `npm run check` full suite green; the five manual scenarios above
confirmed live; changelog entry present.

## Risk

`impact_of` on the two nodes this phase reuses/extends
(`[node:c4b43952]` pager suspend/resume, `[node:ca0c4f4f]` CSS promotion)
came back narrow — only this change's own nodes and one already-completed
goal (`carousel/grid/slideshow/menu` implementation, long since shipped).
Refactor risk is contained to `slideshow.ts` + `app.css`; the Slideshow's own
pure reducer (`slideshowReducer`) is untouched.

**Five rounds of independent `/gw-plan-review` found six real gaps in
this plan before any code was written — all fixed above, none guessed
away:**
1. The promotion class must live on the custom-element host, never
   `Card.svelte`'s own `.card` (Shadow DOM style encapsulation rules this
   out entirely — not a judgment call the first draft treated it as).
2. The extraction must cover `rotate()` as well as enter/exit, or Phase 3's
   own scenario 4 has no mechanism behind it.
3. Acquiring fullscreen must happen on `touchstart`/`mousedown` at the
   button, not `click` — `click` fires after `slideshow.ts`'s `window`-level
   `onInteraction` has already seen and acted on the same tap sequence,
   which is exactly backwards from what the interaction guard needs.
4. Manual fullscreen must actually suspend the Slideshow's idle-trigger
   timer (a real `suspend()`/`resume()` pair on the controller), not just
   gate the interaction-triggered exit path — a long-enough dwell in manual
   fullscreen could otherwise silently flip the Slideshow's internal state
   underneath and surface on release.
5. That `suspend()`/`resume()` pair from (4) must key off `manualElId`'s own
   transitions, not `promotedElId`'s — the derived value the pager/track
   handling correctly uses doesn't change at all when manual acquires the
   Slideshow's own currently-shown card (scenario 3), and only moves between
   two non-null values when manual acquires a different one while the
   Slideshow is rotating (scenario 4). Keying the Slideshow suspend to the
   same trigger as the pager would silently miss both cases the feature
   most needs to get right.
6. The whole module must be re-pointed at fresh `{ track, pager, slideshow }`
   on every `render()`, not constructed once at boot — `main.ts` already
   destroys and rebuilds `pager`/`slideshowController` on every reconnect
   recovery and pull-to-refresh (an expected, frequent event on an always-on
   kiosk, not an edge case), and a one-time init would have every mechanism
   in this plan silently acting on detached, destroyed objects after the
   first one.

The pattern across all six: the first draft repeatedly treated settled DOM/
event-ordering/state-machine/lifecycle facts as open "decide during
implementation" choices, or over-generalized one correct trigger condition
(the pager's) onto a mechanism (the Slideshow's timers) that needed a
different one. None remain open — every mechanism above is now fully
specified in Phases 1–2, not deferred, and Phase 3's scenarios 3–4 now
specify a dwell period long enough that a regression here would actually be
caught by hand-verification, not just look fine by accident.
