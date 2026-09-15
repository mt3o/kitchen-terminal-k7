# Plan: k7-multi-calendar

Goal: `[node:0ba26a6c]`. Ground covered in `research.md`. Domain: `Calendar`
confirmed (`[node:a7e45cb9]`), `CalendarEvent` flagged for a broadened
definition (`[node:c4994962]`, disputed — not resolved here, carried to
`/gw-plan-review`/`/gw-review`). Three scope decisions already settled:
read-only .ics (`[node:49b47c86]`), URL-based sources (`[node:6e173c60]`),
and Google bounded to refresh-token + API client, no consent-flow UI
(`[node:ab43353e]`). UI design agreed via `/gw-wireframe`:
`context/design/k7-calendar-card/deck.json` (`design_surface: k7-calendar-card`
in `change.md`), decisions `[node:834d4089]`, `[node:33cd6c5b]`, `[node:855ab1c4]`.

`impact_of` on `[node:c129f201]` (the GCAL decision) came back wide but
shallow-relevant: mostly other Faza-era goal nodes reachable through the
foundation scope, none a real functional dependent this change would break.

## Non-goals

- No OAuth2 consent/authorization web flow — the refresh token is obtained
  manually by the household and pasted into `.env.local`, exactly like the
  Cloudflare token (`[node:ab43353e]`).
- No editing of .ics-sourced events — read-only by design (`[node:49b47c86]`).
- No file upload — calendars are URLs only (`[node:6e173c60]`).
- No change to any other card type's config-passing mechanism.
- Not fixing `[node:c4994962]`'s flagged `CalendarEvent` definition text —
  that's a human action in the memory GUI, not code.

## Domain naming used throughout

`Calendar` (a configured source), `CalendarEvent` (an entry belonging to
one), `Card` — per `domain_model(status="confirmed")`. No new entity is
coined in code; "tab" is UI mechanics, not a domain noun.

## Phase 1 — Types, schema, config plumbing

- **`docs/handoff/layout.schema.yaml`**: `params.calendar` gets a required
  `calendars` array (min 1 item) replacing the single `calendarId` field.
  Each entry: `id`, `name` (tab label), `showInMain` (boolean, default
  `false`), and `source` — a discriminated shape: `{ mode: google,
  calendarId }` or `{ mode: ics, url }`. `editable` is **removed** as a
  separate field — it was never independently configurable in spirit
  (`[node:c4994962]`: editability is intrinsic to the source, Google
  read-write, ics read-only), so it becomes derived (`source.mode ===
  'google'`), not something a layout author can set inconsistently with
  reality. `view` (week/day) stays a top-level sibling of `calendars`, one
  view mode for the whole card regardless of which tab is active.
- **`src/server/domain/types.ts`**: `Upstream` union gains `'ics'` (matching
  the existing `'rss'` precedent for comic-of-the-day, `[node:e38c12d4]`) —
  confirmed this needs **no DB migration**: `upstream_cache.upstream` is a
  plain `text` column in SQLite (`drizzle/0001_...sql`), Drizzle's `{enum:
  [...]}` is TypeScript-only, no CHECK constraint exists. **`src/server/db/schema.ts:120`
  carries its own separate, hand-written copy of this enum array (`text('upstream',
  { enum: [...] })`), not derived from `domain/types.ts` — caught at
  `/gw-plan-review`: this needs the same `'ics'` addition, one line, or
  `UpstreamCacheRepository.put`'s call in the Drizzle adapter fails to
  typecheck the moment Phase 2 calls `fetchThrough({ upstream: 'ics', ... })`.
  `'rss'` already exists in both places today — this file was just missed
  when this phase was first drafted.** A `Calendar` type
  (id, name, showInMain, source) and a `CalendarSource` discriminated union
  are added here, shared shape for both server and client (client imports
  the type, not the module, matching how `CalendarEvent` already lives in
  the client-only `calendar.ts` today — decide in-phase whether `Calendar`'s
  type belongs in `calendar.ts` or `domain/types.ts` depending on whether
  the server ever needs to *construct* one vs. just receive it from the
  request; the source of truth is `layout.yaml`, which only the client reads
  today via `/api/layout`).
- **`src/server/config.ts`** / **`.env.schema`**: two new slots,
  `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`, alongside the
  already-reserved `GOOGLE_OAUTH_REFRESH_TOKEN`. All three are secrets — add
  to `secretValues()` (the scrubber list) per this project's own discipline
  that a new credential must be registered there immediately, not as an
  afterthought (the Cloudflare token comment in `config.ts` calls this out
  explicitly for exactly this reason).

**Modified:** `docs/handoff/layout.schema.yaml`, `src/server/domain/types.ts`,
`src/server/db/schema.ts` (the `'ics'` enum literal, one line — no migration),
`src/server/config.ts`, `.env.schema`.

**Verify:** `npm run typecheck`. Confirmed `layout.schema.yaml` is a
documentation contract only — nothing (`grep` across `src/` and `scripts/`
for any AJV/JSON-Schema validator came back empty) actually validates the
live `layout.yaml` against it at boot or build; `src/shared/layout.ts`'s own
TypeScript types are the real runtime contract. So Phase 1 and Phase 5 do
**not** need to land together to keep `main` green — but `npm run dev`
locally will show the calendar card broken between this phase and Phase 5
landing (the real `layout.yaml` still has the old `calendarId` shape while
the TS types expect `calendars`), same as any multi-phase change touching a
shape its own config hasn't caught up to yet. Expected, not a risk.

## Phase 2 — Backend: .ics fetch + parse

- **New dependency:** `node-ical` (`[node:6cc420b8]` — mature, handles
  `RRULE` recurrence via `rrule-temporal`, matching this project's
  `rss-parser`-for-comic-of-the-day precedent of picking a real library
  over hand-rolling a parser for a real format).
- **New: `src/server/upstream/ics-calendar.ts`**, modeled on
  `open-meteo.ts`'s shape (a free `fetchX` function using
  `fetchWithTimeout`): fetches the `.ics` URL, parses with `node-ical`,
  expands recurring events for the requested week window, maps to
  `CalendarEvent[]` (id, title, start, end, allDay). All-day and recurring
  events are exactly what a school schedule is built from — both need a
  real test fixture, not just a happy-path single event.
- Freshness: goes through the existing `createFreshnessService`
  (`[node:8f453152]`), cache key `ics:<calendar id>` (per-calendar, so three
  kids' calendars cache independently and one going stale/erroring doesn't
  block the others).
- **New test:** `test/ics-calendar.test.ts`, same shape as
  `test/comic-rss.test.ts` — a real `.ics` fixture file (weekly recurring
  event + one all-day event + one malformed/unparseable entry to prove it's
  dropped rather than crashing the whole fetch, mirroring `calendar.ts`'s
  own `groupByDay` precedent of dropping malformed entries rather than
  rendering them inside-out).

**New:** `src/server/upstream/ics-calendar.ts`, `test/ics-calendar.test.ts`,
a fixture `.ics` file under `test/fixtures/`.

**Verify:** `npm run test` — fixture-driven, no live network call.

## Phase 3 — Backend: Google Calendar OAuth2 refresh + API client

- **New: `src/server/upstream/google-calendar.ts`**: a token-refresh helper
  (`POST https://oauth2.googleapis.com/token`, standard `refresh_token`
  grant using `config.googleOauthClientId/Secret/RefreshToken`) and a fetch
  function (`GET
  https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events`
  with the fresh access token, time-bounded to the requested week), mapped
  to `CalendarEvent[]`. Access tokens are short-lived (~1h) — cache the
  token itself in memory (module-level, not the SQLite upstream cache,
  which is for *event data* freshness, not *credential* freshness) keyed by
  its own expiry, refreshing only when expired.
- Freshness: same `createFreshnessService`, cache key `google-calendar:<calendarId>`,
  upstream tag `'google-calendar'` (already exists in the enum, unused until now).
- Absent credentials (no client id/secret/refresh token configured) is not
  an error — matches `[node:4a749051]`'s no-placeholder-data-as-real rule
  the existing mock fallback already follows: a Google-sourced `Calendar`
  with no credentials configured falls back to the existing mock events,
  same `usingMockData`/`idle` treatment as today, never silently absent.
- **New test:** `test/google-calendar.test.ts` — token-refresh request
  shaping and the events-mapping logic tested against fixture JSON
  responses, no live Google call (mirrors `kilo.test.ts`'s pattern of
  testing request/response shaping without a real upstream).

**New:** `src/server/upstream/google-calendar.ts`, `test/google-calendar.test.ts`.

**Verify:** `npm run test`. Live verification against a real Google account
needs your own credentials in `.env.local` — flagged as a manual step for
Phase 5, same as `k7-lan-tls`'s Cloudflare issuance needed yours.

## Phase 4 — Frontend: tabs + multi-calendar merge

- **Tab-strip design agreed via `/gw-wireframe`** — deck at
  `context/design/k7-calendar-card/deck.json`, screen `calendar-tabs`. Supersedes
  this phase's earlier provisional sketch (colored underline); build against the
  deck, not the paragraph that used to be here. Key points, full detail in the
  deck's `states`/`behavior`/`cites`:
  - Ghost-button row directly under the card header. Active tab marked by
    **brackets around the label** (`[ GŁÓWNY ]`, reusing the existing `[ + ]`/
    `[ MOTYW: JASNY ]` convention), never a colour-only indicator
    (`[node:dffe0843]`, `[node:9b0e63ee]`).
  - Native `overflow-x` scroll on the strip; the strip's own touch handlers call
    `stopPropagation()` so a tab-scroll can never double as a page-swipe
    (`[node:834d4089]`, reusing `Carousel`'s interference-avoidance reasoning,
    not its slide-snap math).
  - Tab labels truncate with an ellipsis, `title` attribute carries the full
    name (a hover affordance, not reliable on touch — the truncated label must
    stay recognizable on its own).
  - Only renders at all when `calendars.length > 1` — the single-calendar case
    (today's only real-world one, until you add an .ics calendar) is pixel-
    identical to the current card.
  - A calendar with a problem gets a trailing glyph on its own tab, reusing
    `Card.svelte`'s existing `GLYPH` vocabulary verbatim: `[!]` serving stale
    cache, `[X]` no cache ever (`[node:855ab1c4]`). Card's footer badge reflects
    the worst state across all configured calendars.
  - No cache ever for a calendar → a synthetic all-day `CalendarEvent`-shaped
    "błąd wczytywania" entry, every day, scoped to that calendar's own bucket
    only (`[node:855ab1c4]`) — reuses the existing event markup, no new error
    component.
- **`src/client/lib/K7Calendar.svelte`** restructured: receives `calendars`
  as a JSON-stringified attribute (matching `createWidget`'s existing
  pattern of flattening structured config into custom-element string
  attributes — `main.ts`'s `case 'chat'`/`case 'menu'` (`availableModels`,
  `items`) is the closer precedent for a full `JSON.stringify`/`JSON.parse`
  round trip of nested data, unlike `timer`'s `presetsMinutes.join(',')`,
  which only ever flattens a flat list — a calendar's `source` is itself a
  nested object, not a flat list, so this needs the stringify/parse round
  trip `chat`/`menu` already establish, not the comma-join precedent).
  Fetches every configured calendar's events independently, one request per
  calendar (`[node:53a1b84b]` — plan-boundary decision, so one dead .ics feed
  can't blank the whole card). Local `$state` holds `events` keyed by calendar
  id, updating progressively as each fetch resolves (no spinner — matches the
  deck's `loading` state). `selectedTab` state (`'main'` or a calendar id)
  drives which bucket(s) feed `groupByDay`: `'main'` merges every calendar with
  `showInMain: true` (untagged/`false` ones excluded, per `[node:a7e45cb9]`'s
  own definition); a specific calendar id shows only that one, regardless of
  its `showInMain` value.
- **Per-calendar colour tick** (`[node:33cd6c5b]`): computed dynamically in a
  new pure function in `calendar.ts` (evenly-spaced hue around the wheel,
  avoiding the reserved semantic hues — warn/fail/amber-ink/signal — same
  hue-separation reasoning as `[node:ff852de4]` WARNNOTAMBER), **not** drawn
  from a small fixed token set, since the number of configured calendars is
  arbitrary and unknown at theme-build time. Runs in JavaScript, writes a
  plain hex string into an inline custom-property value — a deliberate,
  reasoned exception to token-only CSS (`[node:79662ce5]`), not a violation of
  it: the colour is still derived programmatically from this project's own
  colour-space reasoning, just computed per-request instead of baked into the
  static sheet. **Exact lightness/chroma tuning to clear the 3:1 border-
  contrast floor across all three luminance modes is real, unresolved
  implementation work** — verify with real contrast checks in this phase, do
  not guess at the numbers.
- `CalendarEvent` (client type, `calendar.ts`) gains a `calendarId` field so
  a merged bucket can still attribute each event to its source for the
  colour-tick treatment above, plus the synthetic error-event needs a way to
  be recognized as synthetic (an `id` prefix like `error:<calendarId>:<date>`
  is enough — no new field required).

- **`src/server/index.ts`**: a real `GET /api/calendar/week` route, finally —
  it has never existed (confirmed in `research.md`, `[node:156c9e97]`; the
  card has been calling a URL that 404s since it was built). Dispatches per
  requested calendar to `fetchIcsCalendar` or `fetchGoogleCalendar` by
  `source.mode`, each wrapped in `fetchThrough` with its own cache key
  (`icsCacheKey`/the Phase 3 equivalent), matching the existing `/api/comic`
  and weather routes' own `fetchThrough` wiring shape. Found missing from
  every phase's file list during Phase 2 implementation — without this,
  Phase 4's frontend restructuring would have had no real backend to call.

**Modified:** `src/client/lib/K7Calendar.svelte`, `src/client/lib/calendar.ts`,
`src/client/main.ts` (the `case 'calendar':` branch in `createWidget`),
`src/server/index.ts` (new `/api/calendar/week` route).

**New test:** extend `test/calendar-vertical-week.test.ts` or add
`test/calendar-main-view.test.ts` for the pure merge-by-`showInMain` logic
(DOM-free, same convention as `groupByDay`'s own tests) — this is exactly
the kind of pure logic this project always tests directly rather than via
the component.

**Verify:** `npm run check`; real-browser check (Phase 5) for the tab strip
itself, matching this project's established "DOM/interaction behavior needs
a real browser" discipline (`k7-offline-shell`, `k7-card-fullscreen`).

## Phase 5 — Wiring, migration, verification

- **`layout.yaml`**: migrate the existing `kalendarz` card's `params` to the
  new shape — one `Calendar` entry (`source: {mode: google, calendarId:
  primary}`, `showInMain: true`, `name: "Google"`), `editable` field
  removed. This is what makes the calendar card render correctly again
  after Phase 1's type change (see Phase 1's Verify note).
- `changelog.yaml`: one dated entry, Polish, describing the visible feature
  (tabs appear once you add a second calendar; existing single-calendar
  behavior unchanged).
- **Real-browser verification** (matching this project's own established
  discipline — `[node:63dfc17a]`, `[node:2b7b465d]`): with a scratch
  layout.yaml carrying 2+ calendars (one Google-mocked, one .ics against a
  real small test feed — a public holiday-calendar .ics is a reasonable,
  freely available fixture for this), confirm: tab strip renders only with
  2+ calendars; switching tabs shows the right per-calendar events; the
  main tab shows only `showInMain: true` calendars merged; a single
  malformed event in the .ics feed doesn't blank the whole card; the
  existing single-calendar case (no `.ics` added) looks pixel-identical to
  today.
- Google OAuth2 live verification (real refresh token, real client
  id/secret in `.env.local`) is **yours to run** — same secret-handling
  boundary as every other credential in this project; I cannot obtain or
  see it.

**Verify:** `npm run check` full suite green; real-browser scenarios above
confirmed live; changelog entry present.

## Risk

- **The `editable` field removal is a breaking schema change** for anyone
  who set it explicitly — none do today (only `layout.yaml`'s own
  `kalendarz` entry exists), so blast radius is exactly the one file this
  plan already migrates in Phase 5.
- **Multiple network calls per card render** (one per configured calendar)
  is a new pattern this project hasn't needed before — weather and comics
  are each single-source. Each goes through its own freshness cache
  independently, so this is more a design note than a real risk, but
  Phase 4/5 should confirm total request count stays reasonable for a
  wall-display refresh cadence (not re-fetching all N calendars on every
  60-second clock tick the way `today` already ticks in `K7Calendar.svelte`
  — reuse the existing `$effect`-on-mount fetch pattern, not the minute
  timer).
- **The tab-strip visual design is agreed**, via `/gw-wireframe`
  (`context/design/k7-calendar-card/deck.json`) — no longer an open risk,
  Phase 4 was revised to build against the deck rather than the earlier
  provisional sketch.
