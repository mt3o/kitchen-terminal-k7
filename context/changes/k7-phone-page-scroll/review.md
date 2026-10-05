# /gw-review — k7-phone-page-scroll

Reviewed 2026-09-26 by a fresh-context reviewer plus the design checks below.
Verdict: **Approve after rework** (the rework is committed with this file).

## Part 1 — code

Reviewer verdict: Approve. Rework applied anyway, because finding 1 broke
the change's own "kiosk unchanged" claim.

- **F1 (low-medium, fixed):** the pager's axis lock applied on the wall
  kiosk too. There pages never scroll, so an arcing thumb swipe whose first
  >=8px move was more vertical was silently dropped. Fixed:
  `resolveDragAxis(dx, dy, pageScrolls)` reads `scrollHeight > clientHeight`
  once at touchstart and gives every drag to the pager when the page cannot
  scroll. Verified in Chromium: kiosk arcing swipe flips; a phone page that
  fits flips; an overflowing phone page scrolls and does not move the pager;
  a horizontal swipe still flips it. Test added (`test/pager.test.ts`).
- **F2 (low, fixed):** the long comment above the 767px rule still described
  `minmax(0, 1fr)`. Rewritten.
- **F3 (low, fixed):** removed `-webkit-overflow-scrolling: touch` (a no-op on
  iOS 13+; older WebKit had bugs with fixed descendants of such containers).
- **F4 (low, open):** unverified on a real iPhone/iPad: whether an 'x' drag
  also lets a page scroll vertically (no `touch-action` on the deck), and
  fullscreen from a scrolled page (reviewer checked Chromium only: the
  promoted card covered the viewport and scroll position was restored).
- **F5 (observation):** a phone in landscape at 768px or wider falls into
  kiosk mode and still squeezes cards. Outside the ruling's <=767px scope.

Plan drift: none unplanned. The Phase 2 fullscreen check had no recorded
evidence; the reviewer ran it. No committed automated test covers the CSS or
gesture behaviour beyond the pure `resolveDragAxis` unit tests.

## Part 1b — design (surface `k7-shell-mobile`)

- **Screen coverage — SKIPPED (named):** no deck screen has an `agreed_by`
  entry naming this change. The ruling was made in conversation, not through
  `/gw-wireframe`. The `page-grid-reflow` screen, agreed by
  `k7-mobile-responsive`, was amended without one. **For the human:** decide
  whether to add `agreed_by: k7-phone-page-scroll` to it.
- **State coverage:** "phone, N columns, more cards than fit" renders (page
  scrolls, floor holds) — Chromium, with a real page padded to overflow, since
  none of the current pages overflows at 375x667.
- **Ruled gaps:** `d8ef0463` and `db145886` exist (mid-term, live).
  No `GAP:unruled`.
- **Deck drift, found and fixed:** two lines still described the old rule
  (`grid-auto-rows: minmax(0, 1fr)`; "no page-level scroll" on
  `ascii-art-overflow`). Updated to cite `[node:97c338d8]`.
- **Cited constraints:** `0bc7e618` (Safari 15) honoured, verified by build.
- **Detector — SKIPPED:** no impeccable install / `detect.mjs` on this
  machine.
- **Rule drift — SKIPPED:** no `.impeccable/design.json`.
- **Live residue:** clean. **Desk provenance:** none (no `asks.jsonl`).
- **Citation tier:** the deck cites 5 mid-term nodes (`3ea28fac`, `97c338d8`,
  `d8ef0463`, `db145886`, `e156fb5f`). Promote them or they go dormant at
  archive, out from under a permanent deck. Only `0bc7e618` is lifetime.

## Part 2 — memory (human gate)

Store health: **11 unresolved flags (oldest 17 days), up from 8 at the last
gate. Growing; work the queue.**

Disputed nodes touched by this change:
- `1580e5d3` (no page scroll on phone) — contradicted by the human ruling `97c338d8`.
- `26582685` (deck fits by construction) — narrowed to >=768px by `97c338d8`.
- `3218cf7b` (the "nothing scrolls" tension) — decided by `97c338d8`.
- Unrelated, still open: `2ccd3769`, `e4745884`, `f769a5a7`, `538d1960`,
  `009b7439`, `2135f0a4`, `f1d7ef56`, `3c7e1fe3`.

Promotion candidates:
- `f84c977b` change summary for this change (mid-term → long-term).
- `97c338d8` the ruling itself — a hard-to-reverse, surprising, traded-off decision.
- `646d47df` lesson: gate a gesture guard on the same condition as its feature.
- `65a79c91` lesson: commit each touch to one axis once a page scrolls.

Consolidation: 17 candidates → `/gw-consolidate`. Domain backlog: 1 proposed
entity (`77ae64a2` RecipeRejection).

Open the review queue: `agentic-memory-gui` → Review tab.

## Part 3 — tracker

GitHub Issues is the tracker, but this change has no issue. One comment on
PR #81 carries the verdict.
