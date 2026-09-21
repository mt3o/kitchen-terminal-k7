# k7-calendar-config-layers

status: implemented
created: 2026-09-21
memory_goal: UNAVAILABLE — agentic-memory unreachable this session (CLI not on PATH,
  MCP server ENOENT), see memory-backlog.md.
design_surface: n/a (config contract only; the calendar card renders the same tabs)
supersedes: k7-layout-local-overrides (its `calendarAdditions` hook)

## Goal
Make `layout.local.yaml` a real config-layers layer: a partial `layout.yaml`
with the same keys, merged entirely by the library — no bespoke key
(`calendarAdditions`) and no hand-written merge step (`applyCalendarAdditions`).
Asked for by the household on review of k7-layout-local-overrides.

Replace the per-calendar `showInMain` flag with one standalone list of calendar
ids for the GŁÓWNY tab (`mainCalendars`).

## Shape
- Calendars move out of the calendar card's `params` to the top of the layout:
  `calendars: { <id>: { name, source } }` — a map, because config-layers
  deep-merges objects per key but treats a list as one unit, and a card's
  params sit inside the `pages`/`cards` lists no key path reaches.
- `mainCalendars: [<id>, ...]`. A local list replaces the tracked one unless
  `mainCalendarsStrategy: union` sits beside it
  (`arrayLocalMergeStrategyNameSuffix: 'Strategy'`).
- Every calendar card shows every calendar. Per-card calendar sets are gone;
  both cards on the wall already showed the same list, duplicated.
- An id in `mainCalendars` not in `calendars` throws a layout error.

## Non-goals
- No backwards-compatible reading of `calendarAdditions` or card-level
  `params.calendars`: one layout file and one local file exist, both migrated.
- No change to fetching (`/api/calendar/week` still resolves by id from the
  layout, never from the request).
