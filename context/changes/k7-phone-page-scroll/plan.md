# Plan — k7-phone-page-scroll

memory_goal: e73397bc-9bc3-47c9-8457-f72312d46aef

The human ruling is [node:97c338d8], made in conversation on 2026-09-25. It
reverses [node:1580e5d3] (zero page scroll even on a phone) and narrows
[node:26582685] ("the deck fits by construction… a scrollbar anywhere means a
bug") to widths above 767px. Both carry a CONTRADICTS flag for the human gate.

## Decisions (from the ruling)

- **What scrolls:** each `.page`, vertically. `html, body` stay
  `overflow: hidden`, so the document itself still never scrolls. The header
  and the status footer stay fixed, and the status line never leaves the
  screen.
- **Card height:** `grid-auto-rows: minmax(var(--card-min-h), 1fr)`, with
  `--card-min-h` re-inherited (240px from `tokens.css`) instead of the `0`
  that `.page` sets for the wall. Pages that fit look exactly as they do
  today; only a page whose even share would drop below 240px grows and
  scrolls. List cards keep their inner scroll.
- **Scope:** the existing `@media (max-width: 767px)` query only. The
  kiosk, 768px and wider, is unchanged.
- **Column count:** unchanged. The phone keeps the layout's `--deck-cols`,
  as decided in [node:db145886]. Now that the page can scroll, going back to
  one column on phones is a *separate* question for the human, and is not
  decided here.

## Phase 1 — pager axis lock (`src/client/lib/pager.ts`)

With vertical scroll inside a page, today's pager would read every vertical
drag's small horizontal drift as a swipe: the pages wobble sideways, and a
diagonal drag can flip the page.

- A pure `resolveDragAxis(dx, dy)` returns `'x' | 'y' | undefined`, with an
  8px deadzone, like `pull-refresh.ts`'s `shouldAbort`. A drag goes to one
  axis once, and a `'y'` drag releases the pager for the rest of that touch:
  the track snaps back and the drag stays with native scroll.
- The touch listeners stay passive. Nothing calls `preventDefault`, so native
  vertical scroll is never blocked.

Verify: add tests for `resolveDragAxis` in `test/pager.test.ts`.

## Phase 2 — CSS (`src/client/app.css`)

- In the phone media query, `.page` gets `--card-min-h: inherit`,
  `grid-auto-rows: minmax(var(--card-min-h), 1fr)`, `overflow-y: auto`,
  `overflow-x: hidden` and `-webkit-overflow-scrolling: touch`.
- Update the "Nothing scrolls, ever" comment in `app.css` and the header
  comment in `pull-refresh.ts`, which reasons from that rule, to say
  "except per page on a phone". Pull-to-refresh listens on the header only,
  so it does not conflict.
- Fullscreen: a promoted card is `position: fixed`, and fullscreen-lock
  clears the track transform. Check in the browser that a card promoted
  from a scrolled page still covers the viewport.

## Phase 3 — design deck + changelog

- `context/design/k7-shell-mobile/deck.json`: rewrite the "phone, more cards
  than fit" state to the new behaviour, citing [node:97c338d8].
- Add a changelog entry.

Verify: `npm run check`. In headless Chromium at 390×844 with touch:
- a 6-card page scrolls;
- a 2-card page doesn't;
- the header and footer stay visible;
- a vertical drag doesn't move the pager;
- a horizontal swipe still changes the page;
- at 1024×768 nothing scrolls.
