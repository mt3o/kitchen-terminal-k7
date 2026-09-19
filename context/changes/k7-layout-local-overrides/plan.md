# Plan: k7-layout-local-overrides

Written and implemented in one sitting (interactive session, small bounded
change) — no separate `/gw-plan-review` sitting; memory store unreachable
this session, see `memory-backlog.md`.

## Why not a generic whole-layout deep merge

`config-layers`'s `LayeredConfig` deep-merges plain objects but treats an
array as one unit (`override`/`concat`/`union` — never per-element). Both
`layout.yaml`'s `pages` and a page's `cards` are arrays, keyed conceptually
by `id` but not addressable that way by a generic merge. Two options
considered:

1. Restructure the calendar-card contract around an object-keyed catalog
   (`calendarCatalog: Record<id, Calendar>`) referenced by id-lists from
   cards — lets `config-layers` do 100% of the merge work, but rewrites the
   already-shipped `params.calendar` contract (`layout.schema.yaml`,
   `normaliseLayout`, the frontend calendar card, `calendar-lookup.ts`) for
   a two-calendar-ids problem. Rejected as disproportionate.
2. **Chosen:** `config-layers` merges the layout's plain top-level fields
   (today: nothing needs it yet beyond tolerating a missing file, but
   `theme`/`grid` overrides come for free later); a small, hand-written,
   directly-tested function (`applyCalendarAdditions`) does the one
   id-aware append `config-layers` can't: splicing `calendarAdditions`
   entries into the matching card's `params.calendars`, walking the same
   pages/cards/cells/slides shape `calendar-lookup.ts` already walks. Zero
   changes to the calendar card contract, the frontend, or
   `calendar-lookup.ts` — they cannot tell a `layout.local.yaml`-augmented
   layout from a hand-written one.

## Implementation

- `config-layers@^0.4.0` added as a runtime dependency.
- `src/server/layout-local-overrides.ts` (new): `LocalLayoutOverrides` type
  and `applyCalendarAdditions`, unit-tested in
  `test/layout-local-overrides.test.ts` against the same nesting shapes
  `test/calendar-lookup.test.ts` covers for `findConfiguredCalendar`.
- `src/server/index.ts`'s `loadLayout()`: reads `layout.local.yaml`
  (ENOENT-tolerant → `{}`), merges it over the parsed `layout.yaml` via
  `LayeredConfig.fromLayers` (`freeze: false` so the result stays plain
  data for `normaliseLayout`; `notFoundHandler: () => undefined` because a
  fresh `LayeredConfig` instance is built per request — the library's
  default "warn once per key" dedup would otherwise warn on every single
  request for any key the (common, file-absent) case never sets), then
  applies `applyCalendarAdditions` after `normaliseLayout`.
- `.gitignore`: `layout.local.yaml` ignored, `layout.local.yaml.example`
  (tracked, documents the shape) explicitly un-ignored.
- `layout.local.yaml` (real, gitignored, on this machine only):
  `calendarAdditions` for both `kalendarz` (GLOWNA) and `kalendarz-pelny`
  (KALENDARZ page) — the household's own sunrise/sunset calendar
  (`i_212.180.165.133#sunrise@group.v.calendar.google.com`) and personal
  Gmail calendar (`teodor.kulej@gmail.com`), both `showInMain: false`.
- `layout.yaml`: a third calendar, `swieta` (`pl.polish#holiday@group.v.calendar.google.com`,
  `showInMain: true`) added directly — a public Google calendar, no reason
  to keep it out of the (public) tracked file.
- Docs: `docs/handoff/HANDOFF.md`, `docs/handoff/TECH-STACK.md`,
  `docs/handoff/layout.schema.yaml` all note the mechanism. `changelog.yaml`
  entry dated 2026-09-19.

## Verified

- `npm run check` (lint, token checks, 323 tests incl. 8 new, typecheck,
  full build) — clean.
- Ran the real dev server: `/api/layout` shows all four calendars on both
  cards with `layout.local.yaml` present, falls back to the two tracked
  ones with no errors or warnings when the file is absent/renamed away.

## Open, not this change's problem

A `calendarId` that is a personal Gmail address only resolves through the
Google Calendar API if that calendar is shared with (or is) the account the
backend's OAuth refresh token belongs to — a sharing/deployment step for the
household, not a code path this change touches.
