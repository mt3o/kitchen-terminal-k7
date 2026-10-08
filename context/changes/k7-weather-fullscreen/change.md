# k7-weather-fullscreen

status: open
created: 2026-10-08
tracker: github#101

## Goal
Give the weather card the manual fullscreen [ + ] button, and in manual
fullscreen show the full forecast and the hourly graphs instead of the
stretched grid-cell layout (GitHub issue #101).

## Why
Every other large card (calendar, recipes, timer, image) can be opened by hand;
the weather card could only be seen big while the Slideshow presented it. The
k7-weather-hourly ruling [node:d1f56964] had refused the button because the
ghost [ + ] grows the card head by 21px and cuts the 3-day row at 1024x768.
This change brings the button back in a `text` rank that keeps the 44px touch
target as a hit area without adding head height, so that trade no longer has
to be made.

## Scope
- `Card.svelte`: additive `fullscreenRank?: 'ghost' | 'text'` prop (default
  `ghost`, every existing card unchanged); the acquiring touchstart listener is
  attached non-passive (Svelte 5's `ontouchstart` is passive, so its
  preventDefault was a no-op and the trailing click could release what the
  tap had just acquired).
- `K7Weather.svelte`: `fullscreen fullscreenRank="text"`; content keyed on the
  promoted store (both causes of fullscreen); big look keyed on
  `:host(.k7-fullscreen-active)`; only `overflow: hidden` stays
  presentation-only.
- `fullscreen-lock.ts`: untouched.

design_surface: k7-weather-card

memory_goal: 7dfbcf12-be19-4ecf-8879-106ef9e129e6
