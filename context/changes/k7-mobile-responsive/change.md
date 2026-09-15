# k7-mobile-responsive

status: open
created: 2026-09-15
memory_goal: ac7165c9-3d52-47bd-817b-da698678783c
design_surface: k7-shell-mobile

## Goal
Make the Kitchen Terminal K7 dashboard usable at phone width, not just the
iPad-landscape target it was designed for (`targetViewportPx: 1024`). Real
problems seen live on a phone: the "TERMINAL K7" header title wraps to two
lines and squeezes the header controls; individual cards (MINUTNIK/timer,
ASCII.DNIA) get their content cut off vertically instead of fitting or
scrolling; the tablet-oriented fixed-height grid doesn't reflow well to a
narrow, short portrait viewport.
