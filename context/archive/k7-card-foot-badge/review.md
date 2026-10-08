# Review — k7-card-foot-badge

Reviewed 2026-10-08, **after merge** (PR #88, 5d9257b, merged 2026-10-05).
The change was worked in degraded mode, so `/gw-review` did not run before the
merge. This is that gate, held late.

## Part 1 — Code

Recall: goal `f43a5ad7`. Settled constraints that apply:

- `[node:79662ce5]` theming (no hardcoded values). **Honored.** The new
  declarations are keywords only (`wrap`, `0`, `nowrap`). `lint:tokens` and
  `tokens:check` pass.
- `[node:9b0e63ee]` colour never carries state alone; the glyph is the state.
  **Honored.** This change exists to keep that glyph legible.
- `[node:0bc7e618]` Safari 15 floor. **Honored.** Every property is long
  supported and the Safari checks pass. Not run on the iPad.

Plan drift: no plan.md. It was a /gw-fix, so change.md is the plan, and the
diff matches it: two Svelte files, one test, one changelog entry.
Changelog: `changelog/2026-10-05-01-znacznik-stanu-karty.yaml`, in the same commit. ✔
Tests: `npm test` on main gives 762/762, including card-foot-badge 15/15.
Dangerous decisions: none.

Generalizable lesson: already captured as constraint `[node:2857d837]` (the
hyphen in `[--]` is a break opportunity). No other finding generalizes.

Part 1b: skipped, `design_surface: none`.

## Part 2 — Memory review (human gate)

Store health: 13 unresolved flags store-wide (`stale_nodes`). None of them
were touched by this change. None have NOTED events showing they blocked a
headless run. Oldest age not computed. They include k7-mobile-responsive's
"nothing scrolls" cluster (`1580e5d3`, `3218cf7b`, `26582685`), which the
2026-09-25 ruling overturned. ⚠️ Work the queue: `/gw-resolve`.

Disputed nodes touched by this change: none.

Domain backlog: 1 proposed entity, `RecipeRejection` (`77ae64a2`, 10
attached). It is not this change's.

Consolidation: 22 candidates store-wide. One concerns this change: DESIGN.md
§6.1 "rows wrap before they crush" now appears in four changes —
`2ee73f47` (shell head), `538d1960` (mobile-responsive), the presenting-fit
constraint (weather), and `2857d837` (card footer). That is worth one durable
abstraction. Route it to `/gw-consolidate`; it was not worked here.

Promotion candidates:
- `[node:2857d837]` constraint, badge is one unbreakable unit. CONFIRMED
  (test run). Suggest mid-term → **long-term**: every card shell depends on it,
  and a shell refactor could reintroduce the bug unknowingly.
- `[node:807a68ee]` change summary. Suggest → **long-term**, so recall
  keeps serving it after the sweep.
- `[node:726faa94]` issue, the clock date overflows at phone width. Still open.
  Promote if it should stay in live recall until someone decides how to fix it.
  Otherwise it goes dormant.

Open the review queue: `agentic-memory-gui` → Review tab (tier controls).

## Part 3 — Tracker

Skipped. `tracker: github`, but no issue was ever opened. PR #88 is merged.

## Verdict

**Approve.** The code matches change.md and the settled constraints. The memory
queue is handed over above. Next: the promotions, then `/gw-archive`.
