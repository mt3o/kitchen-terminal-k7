# Review — k7-clock-date-phone-fit

Reviewed 2026-10-08, **after merge** (PR #94, ee95ce1, merged 2026-10-08).

## Part 1 — Code

Recall: goal `6605aad8`. Settled constraints that apply:

- `[node:79662ce5]` theming: **honored.** The fix is `var(--text-sm)` only.
  `npm run check` (eslint, token contract, tokens:check, 828/828 tests,
  tsc, svelte-check, build) passes on main at 2d8639a.
- `[node:7108856c]` reading distances: **honored.** `--text-sm` is a read-tier
  token, and the date line has no glance-tier floor.
- `[node:0bc7e618]` Safari 15: **honored.** One `font-size` inside an existing
  media query.
- `[node:e24899db]` two card shells: **honored.** Only K7Card renders the
  clock date.

/gw-fix's own question, whether a test fails without the fix, was re-run on
main: with `K7Card.svelte` reverted to `ee95ce1^`, test/clock-date-phone-fit.test.ts
is **2 of 4 red** ("156px at 20px, wider than the 145.5px content box"). With
the fix it is 4 of 4. The test asserts behaviour (the longest date word, from
`Intl`, fits the content box at the resolved token size), plus the ruling
(exactly `--text-sm`) and the unchanged wall.

Drift vs change.md: none. 4 files: K7Card.svelte, the test, the changelog
entry, and change.md. Changelog: `changelog/2026-10-08-01-data-zegara-na-telefonie.yaml`,
in the same commit. Dangerous decisions: none.

Part 1b: skipped, `design_surface: none`.

## Part 2 — Memory review (human gate)

Store health: 8 unresolved flags store-wide. None are in this change's
territory, and none have NOTED events showing a blocked headless run.
Disputed nodes touched by this change: none.
Domain backlog: 0 proposed (21 confirmed).
Consolidation: 22 candidates store-wide, unchanged. "Rows wrap before they
crush" is still waiting → `/gw-consolidate`.

Change summary captured at review: `cde437b9` (concept, mid-term),
`DEPENDS_ON` a2717fde and 538d1960, `ABOUT` Card.

Promotion candidates:
- `[node:cde437b9]` change summary: suggest → **long-term**, so recall still
  reaches this change after the sweep.
- `[node:a2717fde]` decision: already long-term (human, earlier today).

The goal `6605aad8` goes dormant at archive, as intended.

## Part 3 — Tracker

Skipped. No issue was opened; the defect was queued in the graph.

## Verdict

**Approve.** Next: promote `cde437b9`, then `/gw-archive`.
