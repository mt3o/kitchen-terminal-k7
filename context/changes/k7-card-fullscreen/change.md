# k7-card-fullscreen

status: implemented
created: 2026-09-14
memory_goal: 4de33010-13b5-4766-bd90-cffd5f58a7c8
change_anchor: 80a9bccc-fb67-4ab5-9481-c051f4fe1548

## Goal
Add a reusable fullscreen affordance for K7 dashboard cards, implemented as an
injectable trait/composable rather than per-widget code, with the calendar
card (K7Calendar) as its first consumer.

## Outcome

All 3 plan phases implemented and verified. `npm run check` green (240
tests). Real-browser verification (headless Chrome via a transiently
installed `playwright-core`, never committed) confirmed all 5 coordination
scenarios with real wall-clock timers — 20/20 checks passed.

Two real bugs surfaced only by that real-browser testing, invisible to
typecheck/lint/unit tests, both fixed and captured (`[node:2b7b465d]`,
`[node:120b8fee]`):
- A reactively-swapped `onclick` handler raced its own `mousedown` and undid
  its own acquire on every real tap.
- The button conflated "is this card fullscreen at all" with "does manual
  specifically own it," causing an acquiring tap on a Slideshow-shown card to
  wrongly exit the Slideshow instead of taking control of it.

Five independent `/gw-plan-review` passes had already found and fixed six
design-level gaps before implementation started (see `plan.md`'s Risk
section) — the two found here were implementation-level (DOM event timing),
a different layer than what planning review could have caught by reading
code alone.
