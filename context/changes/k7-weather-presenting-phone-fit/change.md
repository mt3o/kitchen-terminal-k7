# k7-weather-presenting-phone-fit

status: implemented
created: 2026-10-03
mode: bug (/gw-fix)
memory_goal: ef3a29fd-eeda-433a-a76b-fc69db23ed4c
change_anchor: 2c3b83e1-78f8-4a27-b123-4e63c79ddfd4

## Goal
The weather card presented by the Slideshow fits a phone screen (375x667
portrait, 667x375 landscape) with nothing cut off on either edge.

Found by /gw-review of k7-slideshow-weather-calendar (PR #84), `[node:32f913e8]`.

## Outcome

- **Red:** `test/weather-presenting-fit.test.ts`, 4 cases:
  - no presented row is `nowrap`;
  - `.wrap` does not centre with `justify-content` or `align-items`;
  - the children are centred with auto margins;
  - the phone breakpoint steps the temperature down from `--glance-lg`.

  All 4 failed on the shipped code.
- **Green:** the presentation CSS in `K7Weather.svelte`:
  - centred with auto margins;
  - `.now` may wrap;
  - per-element `margin: 0` dropped so the auto margins apply;
  - a `max-width: 767px` block one step down each scale.
- **Chromium:** all content lies inside the card at 375×667, 667×375,
  1024×768 and 768×1024. Before the fix it overflowed at both phone sizes. The
  wall look is visually unchanged.
- `npm run check` green (722 tests).
- **Captured:** `[node:126b8c0b]`, the decision to step the phone presentation
  down a notch.
- **Left as is:** in phone portrait the art wraps above the temperature and is
  centred, while the temperature stays left-aligned. This is cosmetic only.
- Changelog: `2026-10-03-03-pokaz-pogoda-na-telefonie.yaml`.

## Review follow-up (2026-10-03)

The /gw-review of PR #85 approved, with one cosmetic finding. Dropping the
presented `.detail`/`.stale` `margin: 0` had brought back their base 8px
vertical margins, so the wall had 8px more space above the forecast row. The
earlier "wall look unchanged" claim was wrong by that much.

- **Red:** a new case in `test/weather-presenting-fit.test.ts`, "rows are
  spaced only by .wrap's gap".
- **Fix:** zero only the vertical margins, so the auto left/right margins and
  `.stale`'s auto bottom margin (when it is the last child) still apply.
- **Chromium:** the gaps between rows are now equal, 32px on the wall and 16px
  on phones, and the content still fits at 1024x768, 375x667 and 667x375.
- `npm run check` green (723 tests).
