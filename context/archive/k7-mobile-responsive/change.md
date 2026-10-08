# k7-mobile-responsive

status: archived
archived: 2026-10-08
merged: 2026-09-17, PR #56
created: 2026-09-15
memory_goal: ac7165c9-3d52-47bd-817b-da698678783c
design_surface: k7-shell-mobile
pr: https://github.com/mt3o/kitchen-terminal-k7/pull/56

## Goal
Make the Kitchen Terminal K7 dashboard usable at phone width, not just the
iPad-landscape target it was designed for (`targetViewportPx: 1024`). Real
problems seen live on a phone: the "TERMINAL K7" header title wraps to two
lines and squeezes the header controls; individual cards (MINUTNIK/timer,
ASCII.DNIA) get their content cut off vertically instead of fitting or
scrolling; the tablet-oriented fixed-height grid doesn't reflow well to a
narrow, short portrait viewport.

## Archive (2026-10-08)

PR #56 merged 2026-09-17; the /gw-review gate ran then (lesson 4b94d744),
and the change stayed `in-review` until today.

Promoted by the human to long-term at the archive gate: summary f7db89bf;
constraints e24899db (K7Card.svelte duplicates Card.svelte — fix both),
25827824, 14679772, 4b94d744; decisions c5e8c11c, db145886, 538d1960 (cited
by k7-clock-date-phone-fit's a2717fde); open issue 611bc3d8 (theme
breakpoints dropped by generate.ts — still true on 2026-10-08). The summary
gained DEPENDS_ON edges to all nine.

`memory_lifecycle.py deactivate k7-mobile-responsive --sweep`: 13 swept
dormant — the goal, phase/plan narration (0cadf65f, e37a024b, 6b6857da,
409630ca, 2ee73f47, 015d07b2, c77c25d1, 97d0c4ba), the fixed root cause
3ea28fac, and the nodes superseded by the human's 2026-09-25 ruling that
phone pages scroll (97c338d8): 1580e5d3, 3218cf7b, d8ef0463.

Archiving this change was also the workaround for 1580e5d3: the human
archived it as superseded in guided review, and the k7-card-foot-badge sweep
reactivated it because this change kept it reachable
(mt3o-dev/agentic-memory-system#22).

`context/design/k7-shell-mobile/` stays in place (its deck cites no nodes).
