# context/

Scaffolded by the graph-workflow lifecycle (`/gw-init`). The split this folder
enforces:

- **files = lifecycle artifacts** — a change's goal, its plan, its status.
  Thin, disposable, superseded by the next change.
- **graph = knowledge** — decisions, constraints, lessons, domain entities.
  Lives in the agentic-memory store, not in these folders.
- **`design/` = what a screen is supposed to look like** — keyed by *surface*,
  not by change, because a screen's design outlives the changes that touch it.

| Folder | Holds |
|---|---|
| `changes/` | active changes: `<change-id>/{change.md, plan.md}` |
| `archive/` | immutable, append-only — no skill writes here |
| `foundation/` | PRD, roadmap, tech-stack — long-lived documents |
| `design/` | per-surface design record: `deck.json`, `screens/`, `asks.jsonl` |

Do **not** add per-change `notes/`, `research/` or `decisions/` subfolders —
that is exactly what the graph replaces.

## Where this project's foundation documents actually live

The canonical PRD/plan/tech-stack for Kitchen Terminal K7 are in
[`../docs/handoff/`](../docs/handoff/) — `HANDOFF.md`, `PLAN.md`,
`TECH-STACK.md`, plus the `layout.schema.yaml` / `theme.schema.yaml` contracts
and the HTML wireframes. They were left in place rather than duplicated here.
Point `/gw-foundation` at that directory.
