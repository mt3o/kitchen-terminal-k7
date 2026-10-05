# k7-weather-hourly

status: open
created: 2026-10-03
memory_goal: 7f63f396-9eb4-45f7-ac01-7c072df71923
change_anchor: 408ed48c-3935-45fa-bd5d-029816361149
tracker: github#86
tracker_url: https://github.com/mt3o/kitchen-terminal-k7/issues/86
design_surface: k7-weather-card

## Goal
The weather card shows an hourly forecast from Open-Meteo (temperature,
precipitation, precipitation probability, weather code): a compact hourly strip
on the standard card, and separate ASCII graphs for temperature and for
rain/snowfall when the card is maximized or presented by the Slideshow, with the
data refreshing periodically.

## Scope (from the request, 2026-10-03)

- **Server:** add an `hourly` block to `weatherUrl()` in
  `src/server/upstream/open-meteo.ts` (`temperature_2m`, `precipitation`,
  `precipitation_probability`, `weather_code`, plus `rain`/`showers`/`snowfall`
  as the snow graph needs them) and a `WeatherHour[]` on the `Weather` type,
  every timestamp resolved through `resolveInstant()`.
- **Standard card:** a compact hourly readout.
- **Maximized card and Slideshow presentation:** two ASCII graphs, one for
  temperature and one for rainfall/snowfall.
- **Open-Meteo only.** No backup provider (MET Norway was considered and
  declined). ICON-D2 does not cover Warsaw — do not pin `models=icon_d2`.
- **Refresh:** make sure the card's data refreshes on a timer. If it already
  does, leave the interval alone. **It already does** (checked at open): the
  card polls on `setInterval` every `refresh` seconds, defaulting to 900
  (`K7Weather.svelte:76`), and the server serves Open-Meteo through
  `fetchThrough` with `freshForSeconds: 900` (`src/server/index.ts`). Hourly
  data rides the same request, so it refreshes with it. Nothing to do.
- Changelog entry in `changelog/`, same change.

## Base

Branched from `k7-slideshow-presenting-fixes` (PR #85), which merged into
`main` on 2026-10-03. The card PR targets `main`. The server half is PR #87
(`k7-weather-hourly-server`, built by a parallel session), and the card work
rebases onto it (plan.md Phase 1).

Parents: `[node:81c7ca54]` (slideshow weather/calendar summary),
`[node:eede0e36]` (phone-fit summary), `[node:1d6acf4f]` (the
`presentingElIdStore` content seam — weather is its motivating case),
`[node:0a1201ce]` (`forecastDays` read by nothing), `[node:8f453152]`
(freshness is the backend's job).

## Wireframe (2026-10-05)

`/gw-wireframe` agreed four screens in `context/design/k7-weather-card/deck.json`:
standard card (6 × 1 h strip, % third line, 4 columns on a phone), maximized
(ASCII graphs, time running down, one finger scroller to +72 h), Slideshow
(landscape two columns, ~22 h at `--text-lg`, no scroll) and the phone
presentation (graphs compressed side by side). Captured: `[node:f1290406]`
(graphs as ASCII rows, the design-system gap ruling), `[node:97369103]`
(vertical time axis, shared scroller), `[node:0ea3bd46]` (point vs bar, fixed
0–4 mm/h scale), `[node:3f599ef1]` (Slideshow two-column layout),
`[node:7f4027ac]` (orientation picks arrangement, width picks size).

Planning inputs: the standard card is at its height limit on the 4-card
*glowna* Page (measure with `light` + `density: large`); the server must
request `forecast_days` covering 72 h from now (4 days) plus `rain`,
`showers`, `snowfall`.
