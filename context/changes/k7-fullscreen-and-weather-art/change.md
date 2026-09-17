# k7-fullscreen-and-weather-art

status: implemented
created: 2026-09-16
memory_goal: 4fe91a3e-a41c-4e98-8874-e13a581b9da5
change_anchor: 5b3230fa-d724-430a-9ccb-70b3bf637f8d

## Goal
Make the `image` and `unsplash-carousel` cards fullscreen-able like the
calendar, and give the weather card ASCII art of the current conditions.

## Outcome

- `K7Image.svelte` and `K7Unsplash.svelte` pass `fullscreen` to `Card`, the
  same opt-in trait `K7Calendar.svelte` already uses (`fullscreen-lock.ts`).
  No new params: a photo and a QR code are both things you walk up to.
- `wmo.ts` gains `weatherArt(code)` — nine plain-ASCII drawings shared across
  the 28 documented WMO codes, beside the label table they must stay in step
  with. `test/wmo.test.ts` asserts full coverage, ASCII-only glyphs and a size
  ceiling (≤5 lines, ≤12 columns).
- `K7Weather.svelte` renders it left of the temperature (`aria-hidden`, it
  repeats the label), hidden by `showArt: false`; schema + `main.ts` wired.

`npm run check` green (316 tests).

## Open for review
- Not yet seen on the iPad: the art sits in a flex row that wraps, and the
  fullscreen buttons are new on two more cards.
