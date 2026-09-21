# Memory backlog — k7-calendar-config-layers

Degraded mode per CLAUDE.md: `agentic-memory-mcp` failed to connect (ENOENT)
and the `agentic-memory` CLI is not on PATH — the store is unreachable by
either transport. Queued for replay.

## Would-be create_change
- change_id: k7-calendar-config-layers
- goal: "layout.local.yaml as a same-keys config-layers layer; mainCalendars replaces showInMain"
- parent_refs: k7-layout-local-overrides's surviving nodes (its backlog captures 1 and 2)

## Would-be recall_context (at change start)
- query: "config-layers layout.local.yaml calendarAdditions merge"
- query: "calendar showInMain main tab"

## Would-be captures

1. **Decision** — Calendars are declared once at the top of the layout,
   `calendars: Record<id, {name, source}>`, not in a calendar card's params;
   every calendar card shows all of them, and `mainCalendars: id[]` picks
   what the GŁÓWNY tab merges (replacing per-calendar `showInMain`).
   Why: lets `layout.local.yaml` be a partial layout.yaml merged entirely by
   config-layers — the library deep-merges objects per key but cannot reach
   into the `pages`/`cards` lists by id. Trade-off: per-card calendar sets
   are given up (both cards already showed an identical, duplicated list).
   Alternative rejected: the previous hand-written `calendarAdditions` hook
   (k7-layout-local-overrides), which the household overruled as bypassing
   the library it built for this.
   Facets: architecture, config, calendar
   Edges: CONTRADICTS / supersedes k7-layout-local-overrides capture 2
   ("the local-override surface is intentionally narrow: calendarAdditions")
   and the "generic deep merge rejected" half of capture 1.
   ABOUT: Calendar, Layout (domain entities)

2. **Invariant** — Layout data that a local layer must be able to add to or
   amend by id lives in a map keyed by id, never in a list. Lists merge only
   whole (override by default; `<key>Strategy: concat|union` beside a list
   extends it). A new private/local layout field that is a list of
   id-bearing objects is a contract bug waiting to happen.
   Facets: config, contract
   ABOUT: Layout

## Would-be journal events (end of session)
- CONTRADICTED: k7-layout-local-overrides capture 2 (narrow `calendarAdditions`
  hook) — by the household's explicit instruction, 2026-09-21.
- USED: config-layers 0.4.0 README — `arrayLocalMergeStrategyNameSuffix`;
  its merge reads the strategy from the incoming layer first
  (`incoming[key+suffix] ?? accumulated[key+suffix]`), so the local file
  alone decides whether its list extends or replaces.
- CONFIRMED: config-layers deep-copies layers (caller objects untouched) —
  covered by `test/layout-layers.test.ts`.
