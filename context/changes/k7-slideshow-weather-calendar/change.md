# k7-slideshow-weather-calendar

status: implemented
created: 2026-10-03
memory_goal: 57cd4c29-22b8-41d4-bd8f-dc2b817171c1
change_anchor: 608339b2-fc29-462a-b962-4b3013bf6e0e
design_surface: dashboard

## Goal
When the idle Slideshow presents the weather and calendar cards, they read from
the doorway like the clock does: centred, glance-tier sizes, no touch-only
controls, weather showing every forecast day the server returns, calendar
showing the merged main tab from today forward.

Builds on k7-slideshow-presentation-mode (`[node:8b25dd73]`) and is the first
consumer of the deferred content seam `presentingElIdStore` (`[node:1d6acf4f]`).

## Outcome

Small enough to skip the separate plan and plan-review gates: two widgets,
and each change is CSS plus one store subscription. Implemented directly after a
screenshot audit of every widget promoted at 1024×768.

- **Weather** (`K7Weather.svelte`): presenting it centres the whole readout,
  sets the temperature to `--glance-lg`, sets the details and forecast to
  `--text-xl`, and shows every day `/api/weather` returned rather than 3.
- **Calendar** (`K7Calendar.svelte`): presenting it shows the merged GŁÓWNY
  tab and only today onward (derived, `selectedTab` untouched), hides the tab
  strip, turns scrolling off, sets the dates to `--glance-sm` and the titles to
  `--text-xl`.
- `test/calendar-vertical-week.test.ts`: the source-text regex now allows an
  extra condition on the tabs `{#if}`. It still guards the structure it was
  written for.

Captured: `[node:2120bc65]` (decision), `[node:0a1201ce]` (`forecastDays` is
read by nothing), `[node:883015f1]` (remaining widgets triage).

Verified: `npm run check` green (716 tests). The real Slideshow rotation was
driven in Chromium with a fake clock, in landscape 1024×768 and portrait
768×1024. Weather shows 3 days in the grid and 4 while presenting (5-day
canned data). The calendar's selected Google tab survived a presentation.
**Not verified on the iPad.**
