# k7-card-foot-badge

status: archived
archived: 2026-10-08
merged: 2026-10-05, PR #88 (5d9257b); reviewed post-merge 2026-10-08 (review.md)
created: 2026-09-21
lifecycle: /gw-fix (bug — red test before the source edit)

## Goal
At phone width the CZAT card's footer status badge `[--]` broke over two
lines, as `[-` / `-]`. The badge is the colour-independent carrier of a
card's state (DESIGN.md §8, "Status badge") and must never be split.

Root cause: Card.svelte's `.card-foot` is a `display: flex;
justify-content: space-between` row holding the widget's meta and `.badge`
(`margin-left: auto`). The row could not wrap, and the badge could both
shrink (default `flex-shrink: 1`) and break (a hyphen is a line-break
opportunity). K7Chat puts its meta ("kilo-auto/free | dziś: $0.0000") in the
footer because its head holds its own controls; at 390×844 that meta is
wider than the chat card, so the badge was squeezed to its min-content and
broke after the first hyphen — 2 line boxes, 46px tall. The idle glyph
`[--]` is the only one of the four with a break opportunity inside it.

The defect is new to the household's eyes, not new code: the footer badge
was clipped below every card until k7-card-box-sizing (same day) made the
footer visible.

Fix (DESIGN.md §6.1, "rows wrap before they crush"):
- Card.svelte: `.card-foot { flex-wrap: wrap }`; `.badge { flex-shrink: 0;
  white-space: nowrap }`. When meta and the badge do not fit side by side the
  badge drops to its own line and stays bottom-right by its existing
  `margin-left: auto`.
- K7Card.svelte: `.badge { flex-shrink: 0; white-space: nowrap }`. Its footer
  holds only the badge, so there is nothing to wrap; the rule keeps the glyph
  atomic if the footer ever gains text.
- `test/card-foot-badge.test.ts` (static `<style>`-block assertions, the
  pattern of shadow-box-sizing and PR #69's phone-horizontal-overflow):
  both shells' badges nowrap + flex-shrink 0 at every width and at phone
  width; any shell footer that holds text beside the badge must wrap, and the
  badge keeps `margin-left: auto`. Red first: 10 of 15 failing before the
  source edit.

Considered and not taken: PR #69's head-row approach for the footer — meta
`flex-basis: 0` plus a floor at phone width, so the footer stays one line and
meta truncates first. It keeps 28px of card body, but truncates meta harder:
the chat's footer meta carries today's cost, which the one-line version
would cut even shorter than the broken footer's "kilo-auto/free | dz…"
(the whole badge takes 45px, the squeezed one took 31px), while the
wrapped one shows "…| dziś: $…". §6.1
states the wrap outright, the broken footer was already two lines (46px vs
51px now), and only K7Chat and K7Unsplash (meta "3/8") put meta in the
footer, so the height cost is confined to the chat card at phone width.

Verified in headless Chromium (playwright-core against Chromium 1243,
installed transiently in the session scratchpad, never committed) against a
production build (`vite build` + `build-precache.mjs`) served by a scratch
server with temp data dirs, clock fixed to Monday 2026-09-21, reduced motion,
every page and every PRZEPISY MENU tab, dark and light:
- 390×844 and 375×667: split badges 1 → 0 (CZAT `[--]`: 2 line boxes/46px →
  1/23px, footer 51px, badge inside the card, bottom-right). No text or
  control is clipped that was not clipped before; the only set differences
  are the weather card's live "N min temu" age string changing between runs.
- 1024×768: every screen pixel-identical before/after, dark and light,
  except an 83×11px box on GLOWNA that is the weather card's live age text
  ("teraz" vs "4 min temu") — no layout change.
- `npm run check`: eslint, token contract, tokens:check, 572/572 tests,
  tsc + svelte-check, production build — all pass.
- Card.svelte merges cleanly with open PR #69 (trial `git merge-file`).
- The changelog entry moved to `changelog/2026-10-05-01-znacznik-stanu-karty.yaml`
  when the change was carried onto main on 2026-10-05 (main replaced
  `changelog.yaml` with `changelog/` on 2026-09-21). On that main the new test
  is still 10 of 15 red without the source edit and 15 of 15 green with it.

Seen in passing, left out: K7Card's clock date `.body` ("poniedziałek, 21
września 2026") at ≤390px — "poniedziałek," is wider than the half-width
card's content box and its comma paints over the right border (0.5px past
the border box at 375×667; K7Card has no `overflow: hidden`, so nothing is
cut). Every fix is a design trade-off this bug did not call for:
`overflow-wrap: break-word` would open a line with ", 21" and add a line of
height to a card with no slack, and a smaller date size at phone width is a
typography decision. Queued as an issue in memory-backlog.md §2b.

design_surface: none

tracker: github — no issue opened (creating one is outward-facing; left
for the human to open or waive)

memory_goal: f43a5ad7-013a-4599-81f7-648092f9c407   # minted at /gw-archive 2026-10-08 (backlog replayed)
change_anchor: 05a0a900-999c-4203-9580-035e126d56e6
change_summary: 807a68ee-542b-4717-87ee-351351cf253c

## Archive (2026-10-08)

Memory backlog replayed at archive (memory-backlog.md, marked REPLAYED).
Promoted by the human before the sweep: constraint 2857d837 → lifetime,
change summary 807a68ee → long-term. Issue 726faa94 was resolved by
k7-clock-date-phone-fit (#94) and archived by the human.

`memory_lifecycle.py deactivate k7-card-foot-badge --sweep`: this change's
goal f43a5ad7 swept dormant. The store-wide sweep also retired 07a456b4
(k7-offline-shell's unimplemented API-caching decision, left at mid-term by
the human) and the goals of k7-lan-tls, k7-offline-shell and
k7-pages-and-audiometer, deactivated in the GUI earlier the same day. It
reactivated 1580e5d3, which the human had archived as superseded in guided
review, because k7-mobile-responsive is still active. That reverses a human
ruling, and it is raised as a separate issue rather than patched here.

An earlier accidental deactivate+sweep in this session (the lifecycle
script's `--dry-run` applies only to `recompute-trust`) was undone at once
with `activate --sweep`. Both are in the journal.
