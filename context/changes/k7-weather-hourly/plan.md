# Plan — k7-weather-hourly

memory_goal: 7f63f396-9eb4-45f7-ac01-7c072df71923
design_surface: k7-weather-card (deck: `context/design/k7-weather-card/deck.json`, 4 screens agreed 2026-10-05)

The screens are settled in the deck and the graph (`[node:f1290406]`,
`[node:97369103]`, `[node:0ea3bd46]`, `[node:3f599ef1]`, `[node:7f4027ac]`).
This file is sequencing only. Plan-boundary captures: `[node:e0d9cfb5]`
(graph geometry is measured at runtime; the text comes from a pure module) and
`[node:0c340910]` (trim against a clock that advances on every load attempt).

## Starting point

- `main` already has #85 (phone fit, `[node:eede0e36]`). This branch sits on
  it, so the PR targets `main` directly. No retargeting needed.
- **The server half is done, as PR #87** (branch `k7-weather-hourly-server`,
  from `main` d12f481, built by a parallel session). It adds `WeatherHour[]`,
  the `hourly` request, `precipitation_unit`, DST-safe `resolveLocalInstant`,
  and `test/open-meteo.test.ts`. It touches only the server files. Its decision
  is `[node:2de61225]`: the full 120-hour series from local midnight, with
  trimming left to the card. The contract, as confirmed by that session:
  - every value is `number | null`, where `null` means "not provided";
  - `precipitation` is the total as water (`units.precipitation`);
  - `rain` = rain + showers, as water;
  - **`snowfall` is depth in cm, a different quantity.** The snow share on
    the mm bar is `precipitation − rain`; `snowfall` never goes on that scale;
  - label hours by formatting `time` in the local zone.
- This branch has no commits of its own yet. `41a406e`, which landed here
  by accident when the two sessions shared a checkout, is #85's and is
  already in `main`.
- Refresh already exists (`[node:8f453152]`): the client polls every 900 s and
  the server treats data as fresh for 900 s. Nothing to build.

## Non-goals

- `forecastDays` wiring (`[node:0a1201ce]`). Not needed: `forecast_days=5`
  from local midnight always leaves ≥ 97 h ahead of the current hour, which
  is more than 72.
- The daily sunrise/sunset DST defect (`[node:9baa87db]`). Separate fix.
- A backup weather provider. Open-Meteo only, per the user.
- A design-system chart component. Ruled out in `[node:f1290406]`.
- Changes to the cache key or the Service Worker.

## Phase 1 — Server: hourly series on `/api/weather`

Adopt PR #87. Do not re-implement it.

1. Base the card work on #87: rebase `change/k7-weather-hourly` onto `main`
   once #87 merges, or onto `k7-weather-hourly-server` if the card work
   starts first. The card PR then targets `main` and carries only client
   files.
2. Check that the `/api/weather` route passes `hourly` and the new `units`
   fields through unchanged (it returns `fetchThrough`'s `data` as is).
3. Implement in a worktree of this change's own
   (`../kitchen-terminal-k7-weather-hourly`), not the shared main checkout.
   The parallel session asked for this after its commit landed on this
   branch.

Files: none of this change's own. They come from #87.
Verify: `npm test` green. A live `curl /api/weather` returns `hourly` with
120 rows of real instants. A cached row from before the change still serves,
without `hourly`.

## Phase 2 — Pure module: trimming, the strip and the ASCII rows

New `src/client/lib/weather-hourly.ts`. No DOM and no Svelte, so it can be
tested under `node --test`, like `wmo.ts`.

- `upcomingHours(hourly, nowMs, limit = 72)`: rows from the current hour
  (the hour containing now). Works on stale data too, so past rows drop out.
  Tolerates `hourly` being absent and returns `[]`.
- `stripCells(hours, n)`: the next n full hours (6, or 4 on a phone) as
  `{ hour, temp, pct }`. A `null` value becomes `'--'`.
- `graphRows(hours, { tempCells, precipCells, showMm, unit })`: returns lines
  of segments `{ text, role }`, where `role` is `hour | marker | value | rain
  | snow | muted | separator`, so the component can colour them with tokens.
  - Temperature: one `o` per hour on the window's min..max, placed in
    `tempCells` columns (`[node:0ea3bd46]`).
  - Precipitation: a fixed scale with full width = 4 mm/h (0.16 in/h in
    imperial). Past the end, the bar is capped and ends in `>`. Rain is `#`
    and snow is `*`: the `#` share is `rain`, the `*` share is
    `precipitation − rain`. `snowfall` (cm of depth) is never put on this
    scale.
  - A separator row at local midnight: `-- PON 06.10 --` (pl-PL, no
    diacritics, like `WMO`).
  - `> ` marks the first row. Every glyph is 7-bit ASCII (`[node:f1290406]`).
- `hasPrecipitation(hours)`, for the `brak w ciagu …` header.

Files: `src/client/lib/weather-hourly.ts`, `test/weather-hourly.test.ts`.
Verify: unit tests for trimming across a stale gap; null handling; min = max
(a flat line must not divide by zero); the `>` cap; the rain/snow split; a
midnight separator across the autumn DST hour (rows come from the instants
the server resolved); the imperial scale; and that every output character is
`< 0x80`.

## Phase 3 — Standard card: the hourly strip (screen `standard-card`)

- `K7Weather.svelte`: extend the `Aged` type with `hourly?` and the new units.
  Add a `nowMs` state that advances on **every** `load()` attempt, success or
  failure, so rows still trim forward when a refresh fails and stale data is
  kept.
- Strip between `.detail` and `.days`: `grid-template-columns: repeat(6,
  minmax(0, 1fr))`, and `repeat(4, …)` below 767px (rendering 4 cells, not
  hiding 2). Same type recipe as `.days`/`dt`. `0%` in `--fg-muted`. Omitted
  entirely when there are no upcoming hours.
- Canned data: add `hourly` to `scripts/theme-preview.mjs`'s `CANNED` and to
  `K7Weather.stories.ts` (one wet hour, one snowy hour, one null).

Files: `K7Weather.svelte`, `scripts/theme-preview.mjs`,
`K7Weather.stories.ts`, `test/weather-hourly-card.test.ts` (source-text
contract, in the style of `weather-presenting-fit.test.ts`).
Verify: in Chromium via theme-preview at 1024×768 on the *glowna* Page,
measure `.wrap` `scrollHeight − clientHeight` (agent-notes §3) for the
default theme and for `light` + `density: large`, and report both. Per the
user's ruling the `.wrap` scroll stays the fallback and nothing else is cut.
Also check 375×667.

## Phase 4 — Maximized: graphs with a vertical scroll area (screen `maximized`)

- Opt the card into the fullscreen button: `<Card … fullscreen>`, the same
  opt-in calendar, chat and audiometer use.
- `manual = $manualElIdStore === hostId`, read the way Card.svelte reads it.
  The graphs show when `manual || presenting`. That is content, so it is
  keyed on the store, not only on the `:host()` class (`[node:8b25dd73]`,
  `[node:465e38f0]`: styling lives in this component's shadow CSS).
- Layout while maximized: a one-row summary band (it wraps on a phone), a
  fixed graph header (labels, min..max, legend `# deszcz * snieg`, or `OPADY
  // brak w ciagu 72 h`), then a scroll area: `overflow-y: auto`,
  `touch-action: pan-y`, `-webkit-overflow-scrolling: touch`. It holds all
  ≤72 rows and never shows more than 24 rows before scrolling (max-height in
  `em` of the row line height; `lh` is past Safari 15).
- **Graph geometry is measured, not set per breakpoint.** A ResizeObserver on
  the graph box (Safari 13.1+) reads the box width and one measured mono
  character, and from those derives `tempCells` and `precipCells`. Below
  ~40 columns, `showMm=false` (the phone ruling, `[node:7f4027ac]`).
- `<pre>` rows use the `.art` recipe: `--font-mono`, `white-space: pre`,
  token colours per segment role. The block is `aria-hidden`, and a
  visually-hidden sentence summarises it (min/max, the first wet hour).
- States: no hourly data → one muted line, `brak prognozy godzinowej`. Stale
  → graphs stay. Loading and error unchanged.

Files: `K7Weather.svelte`, `test/weather-hourly-card.test.ts`.
Verify, in Chromium at 1024×768 and 375×667, maximized:
- a finger drag (CDP touch) scrolls the graph and the Page does not move (the
  pager is suspended while fullscreen, `[node:2733b7b2]`);
- the header stays put;
- no more than 24 rows are visible;
- releasing fullscreen returns the standard card unchanged.

## Phase 5 — Slideshow presentation, wall and phone (screens `slideshow-presenting`, `slideshow-presenting-phone`)

- When `presenting` is true and there are hours: landscape (`@media
  (orientation: landscape)`) puts the hero and graphs in two columns, and
  portrait stacks them (`[node:3f599ef1]`, `[node:7f4027ac]`). Graph rows are
  `--text-lg` on the wall and `--text-sm` below 767px. No scroll area: the row
  count is `floor(boxHeight / rowHeight)`, capped at 24, from the same
  ResizeObserver, so no half-cut row is painted.
- The hero keeps every rule from #84/#85. Centring stays on auto margins, and
  the graph column is start-aligned so overflow loses its end, never its
  start (`[node:32f913e8]`).
- **When there are no hours, the presentation is exactly today's.** This is
  guarded by keeping `test/weather-presenting-fit.test.ts` green unchanged,
  with any two-column rules scoped under a `.has-hours` class.
- Portrait with too few rows: drop `.detail` first (`[node:3f599ef1]`).

Files: `K7Weather.svelte`, `test/weather-hourly-card.test.ts`.
Verify: drive the real Slideshow rotation with a fake clock at 1024×768,
768×1024, 375×667, 667×375 **and 844×390**, the size from #85's
residue. Check that nothing is clipped at the start, rows ≤ 24, and
`.wrap` does not overflow. Screenshot-diff the presentation with hourly data
removed against `main` (agent-notes §6).

## Phase 6 — Changelog, docs, gate

- `changelog/2026-10-DD-NN-pogoda-godzinowa.yaml`, Polish and dated on the
  day it lands. Number it after whatever is already in `changelog/` for that
  day.
- Deck: `prototype` stays `null`. Record `implements` as checked.
- `npm run check` green (lint, token contract, tokens, tests, build).

## Risks

| Risk | Mitigation |
|---|---|
| The standard card no longer fits its cell; the strip hides the 3-day row behind `.wrap` scroll | Measure it in Phase 3 and report. The user ruled that scroll is the fallback; nothing else is cut. |
| Landscape phones ≥ 768px wide (844×390) get two columns at wall sizes in a 390px-tall box | Measured row count caps what is painted. If the hero alone overflows, add `(max-height: 500px)` to the phone step-down. Decide with the 844×390 screenshot in Phase 5. |
| #87 changes in review before it merges | Phase 2 codes against `WeatherHour` as #87 defines it. If review changes the shape, rebase and re-run Phase 2's tests; report any mismatch to #87, don't patch around it in the card. |
| Mono advance width differs per theme (Courier Prime vs Source Code Pro) | Geometry measured from one rendered character per theme, not a 0.6 em constant. |
| A ResizeObserver loop on Safari 15 (resize → re-render → resize) | The graph's own size never depends on its row text: fixed font-size, `width: 100%`. Only the cell counts change. |
| Not verified on the iPad | Said plainly at review (agent-notes §6). Chromium is not Safari 15. |

## Plan-review amendments (2026-10-05, independent /gw-plan-review: APPROVE WITH AMENDMENTS)

Implementation is taken over by the "Widget display in fullscreen slideshow"
session on branch `k7-weather-hourly-card` (= main + #87 c8cc1f1 + the plan
commit). Phase 2 is built by the K7 weather session in its own worktree and
cherry-picked; that session also runs the Chromium checks for Phases 3–5.
**F9 (branch names):** the card PR is rebased onto `main` once #87 merges, so
it carries client files only.

- **F1 (Phase 5): the presenting rows box gets its height from the layout,
  not from its content.** Under `.has-hours` the graph rows box is `flex: 1 1
  0` (or a `1fr` track), `min-height: 0`, `overflow: hidden`, `margin: 0`,
  overriding the #85 auto margins for that box only. The ResizeObserver
  measures the rows box, never the header. If the box took its height from its
  rows, `floor(box / row)` would lock at 0 or a wrong count.
- **F2 (Phase 3): the `fullscreen` opt-in moves to Phase 3.** `[ + ]` makes
  the head taller, so the standard card's `.wrap` overflow is measured with
  the button present.
- **F3 (Phase 5): dropping `.detail` in stacked portrait is decided from the
  row count computed as if `.detail` were present.** Otherwise hiding it adds
  rows, which un-hides it, and the layout flips back and forth.
- **F4 (Phase 2): the budget counts lines, not hours.** `graphRows(...,
  maxLines)` counts midnight separators, so 24 hours plus a separator never
  paints 25 lines.
- **F5 (Phase 2): precipitation edge cases.**
  - The snow share is `max(0, precipitation − rain)`.
  - When `rain` is `null` and `precipitation` is not, the whole bar draws as
    rain (`#`). Snow is never inferred from a missing split.
  - A capped bar keeps its rain/snow proportions.
  - The scale comes from `units.precipitation` (`inch` → 0.16 in/h), not
    from the card's `units` prop. The header reads `in/h` in imperial.
  - Value segments carry numbers only. Units live in the header, so every
    output character stays below 0x80 (no `°`).
- **F6 (Phases 2–3): role colours and deterministic labels.**
  - **Colour per role:**

    | Role | Token |
    |---|---|
    | `hour` | `--fg-muted` |
    | `marker` | `--accent` (the amber ink) |
    | `value` | `--fg` |
    | `rain` | `--fg` |
    | `snow` | `--fg-muted` |
    | `pct` | `--fg-muted` |
    | `muted` | `--fg-disabled` |
    | `separator` | `--fg-muted` |

    Not `--signal` (teal: at most twice per card, dffe0843) and not `--warn`
    (that means a state). Rain and snow differ by glyph, never by colour alone.
  - **Time zone:** the pure module takes a `timeZone`. The card passes the
    response's `timezone` (added to `Aged`). Hours are formatted with
    `Intl.DateTimeFormat(… { timeZone, hour: '2-digit', hourCycle: 'h23' })`.
  - **Weekdays** come from a fixed folded table, `NIEDZ PON WT SR CZW PT SOB`,
    not from ICU, so the separator and its test don't depend on the machine.
- **Deck coverage:**
  - `graphRows` takes `showPct` and emits a `pct` role. Probability is kept
    on the phone, while mm is dropped there.
  - The no-precipitation header names the window actually shown: `brak w
    ciagu 24 h` when presenting, `72 h` when maximized. The component
    supplies the number; `hasPrecipitation` runs on the shown slice.
  - When presenting, the stale `[!]` line sits under the hero.
- **F7 (Phase 4): maximized styling never keys on `.k7-fullscreen-active`
  alone, which presenting also sets.**
  - It uses a `manual` class set from `manualElIdStore`.
  - Maximized rows are `--text-base`.
  - Before the first ResizeObserver measurement, the graph renders with the
    phone cell counts (10), so a fallback is always painted.
- **F8 (Phase 5): `(max-height: 500px)` is not added without the user.**
  7f4027ac rules that width alone picks the size step. If 844×390 overflows,
  the screenshot goes to the user with a proposal, not into the code.
