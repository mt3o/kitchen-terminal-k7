# Memory backlog — k7-layout-local-overrides

Degraded mode per CLAUDE.md: `agentic-memory-mcp` failed to connect (ENOENT)
and the `agentic-memory` CLI is not on PATH in this session/environment —
the store itself is unreachable, not just unregistered. Queuing the
would-be operations here for replay once the surface returns, rather than
skipping the discipline.

## Would-be recall_context (at change start)
- query: "layout.yaml config layering, local overrides, secrets in layout"
- query: "config-layers library usage in this project"
- goal_ref: this change's goal (no memory_goal id exists yet — store unreachable)

## Would-be captures

1. **Decision** — `config-layers` is wired into the backend layout loader as a
   two-layer merge (`layout.yaml` base + optional gitignored `layout.local.yaml`),
   read fresh per request like `layout.yaml` already was.
   Why hard to reverse / surprising / real trade-off: establishes the pattern
   any future local-only layout data follows; alternatives considered were (a)
   stuffing calendar IDs into env vars via Varlock, rejected because the data
   is structured/array-shaped, not a scalar secret, and (b) a generic deep-merge
   of the whole layout tree, rejected because `config-layers` merges plain
   objects, not arrays-of-objects-by-id — `pages`/`cards` are arrays, so a
   whole-layout merge would wholesale-replace or blindly concat pages rather
   than augmenting one card's calendar list.
   Facets: architecture, backend, config
   ABOUT: (layout schema entity, once domain_model() is available)

2. **Decision** — the local-override surface is intentionally narrow: one
   additive key, `calendarAdditions: Record<cardId, Calendar[]>`, applied
   after `normaliseLayout()` by walking the same recursive card-container
   shape `calendar-lookup.ts` already walks (cells/slides), not a general
   "override any layout field" mechanism.
   Why: keeps the blast radius small and keeps every downstream consumer
   (frontend calendar card, `calendar-lookup.ts`, the layout schema's
   `params.calendar` contract) completely unaware the override exists — it
   only ever sees a `layout.yaml`-shaped object with more calendars in it.
   Facets: architecture, backend, config

3. **Issue/constraint** — a calendar added via `calendarId` = a personal Gmail
   address only resolves through the Google Calendar API if that calendar is
   shared with (or is) the same Google account the backend's OAuth refresh
   token belongs to; otherwise the API 404s. Not fixed by this change — a
   deployment/sharing concern, not a code path.
   Facets: calendar, deployment, caveat

## Would-be journal events (end of session)
- USED: existing `findConfiguredCalendar` recursive-container pattern
  (cells/slides) as the template for `applyCalendarAdditions`'s walk.
- CONFIRMED: `layout.schema.yaml`'s calendar `source.calendarId` is genuinely
  free-form (any Google calendar id string), not restricted to `primary` —
  no schema change needed for the two new calendars.
- NOTED: `config-layers` (github.com/mt3o/config-layers, npm `config-layers`)
  was listed in TECH-STACK.md since 2026-09-08 but had zero usage sites in the
  codebase before this change — first real integration.
