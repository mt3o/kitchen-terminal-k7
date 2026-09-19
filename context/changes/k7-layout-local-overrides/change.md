# k7-layout-local-overrides

status: implemented
created: 2026-09-19
memory_goal: UNAVAILABLE — agentic-memory unreachable this session (CLI not on PATH,
  MCP server ENOENT), see memory-backlog.md. Not a normal "MCP not registered"
  case — the store itself could not be reached by either transport.
design_surface: n/a (config/backend only, no UI surface change beyond new
  calendar tabs whose count/labels are a runtime config value, not a design)

## Goal
Let `layout.yaml` stay a safe, committable, public file while the household adds
private data to it locally: specifically, Google calendar IDs that must not be
pushed to the (public) GitHub repo. Leverage `config-layers` (the household's
own library, already named in TECH-STACK.md but not yet wired into the app) to
layer an optional, gitignored `layout.local.yaml` on top of the tracked
`layout.yaml`, and use it to add three calendars to the calendar card:

- A public "Holidays in Poland" Google calendar (`pl.polish#holiday@group.v.calendar.google.com`)
  — not sensitive, added directly to the tracked `layout.yaml`.
- A "sunrise/sunset" Google calendar tied to a specific IP-derived calendar id
  (`i_212.180.165.133#sunrise@group.v.calendar.google.com`) — added via the
  local override, since the id is unusual enough to be worth not publishing.
- The household member's personal Gmail calendar (id = their own email address)
  — added via the local override; this one is genuinely private (an email
  address), not just cautious.

## Non-goals
- No change to how calendars are fetched (`google-calendar.ts`/`ics-calendar.ts`
  unchanged) — `calendarId` was already free-form per `layout.schema.yaml`.
- No change to the calendar card's frontend component or its `params.calendars`
  contract — the local-override mechanism resolves to the exact same shape
  before the layout reaches `normaliseLayout()`, so nothing downstream (client,
  `calendar-lookup.ts`) can tell the difference from a hand-written `layout.yaml`.
- No generic "override any field" UI or CLI — the mechanism is intentionally
  narrow (one additive hook, `calendarAdditions`, keyed by card id) rather than
  an arbitrary deep-merge of the whole layout, because arbitrary deep-merge of
  an array-of-pages/array-of-cards tree doesn't compose the way `config-layers`
  merges plain objects (see plan.md).
