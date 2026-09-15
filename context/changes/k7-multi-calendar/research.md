# Research: k7-multi-calendar

## Questions asked

1. How does the calendar card work end-to-end today?
2. What .ics parsing library fits this project's conventions?
3. Does a tabs UI pattern already exist in the design system?
4. How does the existing freshness/cache architecture work, and does it extend cleanly to a new source?

## Answers

**1. There is no real backend at all — the calendar has always been mocked.**
`K7Calendar.svelte:108-126` fetches `/api/calendar/week`; grepping the entire
`src/server/` tree for `calendar`/`google` returns nothing — no route, no
client, no OAuth2 code exists anywhere. The card has been showing
obviously-labelled mock events (`usingMockData`, `state: 'idle'`,
meta `"dane przykladowe"`) since it was built. `[node:c129f201]`
("Google Calendar is integrated bidirectionally... forces OAuth2") is a
**settled decision, not a shipped fact**. This means k7-multi-calendar's
.ics work has nothing real to avoid disturbing.
Captured as `[node:156c9e97]`.

**Scope decision this implies, needs your confirmation:** building real
Google OAuth2 is separate, much larger, untouched work (consent flow, token
storage, Calendar API client) and should stay out of this change's scope.
The multi-calendar config shape gets a slot for a `google`-type source so a
future change can wire it in without another schema rework, but that source
keeps behaving exactly as it does today (mocked) until that happens.

**2. `node-ical`** (v0.27.x, ~1.1M downloads/month) is the fitting choice —
mature, actively maintained, and it expands `RRULE` (recurring events) via
`rrule-temporal`, which matters specifically because the motivating case (a
school schedule) is almost entirely weekly-recurring events. Matches this
project's own precedent: `rss-parser` was picked the same way for
comic-of-the-day rather than hand-rolling a parser. No ics/ical dependency
exists in `package.json` today.

**3. No tabs pattern exists anywhere in the design system** — checked
`DESIGN.md` and `kitchen-terminal-k7-kit.html`, no `role="tab"` usage in any
`.svelte` file. Unlike the fullscreen button (which reused the shell
header's existing ghost-button recipe directly), this is genuinely new
surface and needs its own design pass, grounded in existing tokens
(`--control-h-sm`, ghost-button styling, bracket-glyph/uppercase HUD
conventions) rather than invented from nothing.
Captured as `[node:6cc420b8]`.

**4. The freshness/cache architecture (`createFreshnessService`,
`src/server/upstream/freshness.ts`) extends cleanly.** It's keyed by an
arbitrary string plus an `Upstream` union type
(`src/server/domain/types.ts:65`) — currently `'open-meteo' | 'google-calendar'
| 'kilo-gateway' | 'rss'`. `'rss'` was added for comic-of-the-day following
the exact same schema+migration pattern this change needs for a new `'ics'`
member. Per-calendar freshness works by keying the cache per calendar id/URL
(e.g. `ics:<id>`), same as any other per-item cache key in this codebase.

## What recall did NOT answer — open questions for you before planning

1. **URL or file for the .ics source?** You said "via .ics file" — this
   project's existing pattern for external content is fetch-by-URL, declared
   in `layout.yaml` (matching `comic-of-the-day`'s `rssUrl`), not a file
   upload (no multipart/upload infrastructure exists anywhere in this
   codebase). Most school-schedule systems (Google Classroom, ClassDojo, a
   school's own portal) publish a live .ics **URL**, which also means the
   calendar can pick up changes automatically rather than going stale the
   moment someone forgets to re-upload a file. Confirm URL-based is right,
   or say if you specifically need to point at a static local file.
2. **The Google-stays-mocked scope call above** — confirm, or say if you
   want real Google OAuth2 folded into this change too (would make this
   noticeably bigger).
3. **Tab visual design** — no existing pattern to copy. Plan will propose
   something grounded in the existing token set for your sign-off before
   implementation, rather than a full separate `/gw-wireframe` pass, given
   the scope is one tab strip inside one existing card, not a new screen.

## Artifacts captured this session

- `[node:156c9e97]` issue — the calendar backend never existed; the Google
  integration decision was never implemented.
- `[node:6cc420b8]` concept — `node-ical` as the parsing library choice, no
  existing tabs pattern to reuse.
- Domain: `Calendar` entity confirmed, `CalendarEvent`'s definition flagged
  for review (too narrow now that `Calendar` exists) — see `/gw-domain`
  session earlier this change.

## Next

Ask the three open questions above, then `/gw-plan`.
