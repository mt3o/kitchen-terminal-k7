# k7-calendar-presenting-reanchor

status: implemented
created: 2026-10-03
mode: bug (/gw-fix)
memory_goal: 80f9e4e3-4206-4ef5-8d94-18553c9c4e85
change_anchor: 55c9fe00-eb76-4606-bf87-bb6d49b98379
design_surface: k7-calendar-card

## Goal
When a touch ends the Slideshow presenting the calendar, the card is back at
today's row immediately, not showing past days until the 2-minute snap-back.

Found by /gw-review of k7-slideshow-weather-calendar (PR #84), `[node:da3dff86]`.

## Outcome

- **Red:** `test/calendar-presenting-reanchor.test.ts`. The fresh-look reset
  effect must depend on `presenting`. It failed on the shipped code.
- **Green:** `void presenting` added to that effect in `K7Calendar.svelte`. One
  line plus a comment, with no refactor.
- **Chromium (1024×768, real rotation, touch exit):**
  - Before the fix, `scrollTop` was 0 with today's row at 374px.
  - After the fix, `scrollTop` is 371, the same as the grid view before the
    presentation.
- `npm run check` green (722 tests).
- The rule already captured as the review lesson `[node:da3dff86]` is now
  CONFIRMED by the test. No new capture.
- Changelog: `2026-10-03-02-pokaz-kalendarz-wraca-do-dzis.yaml`.
