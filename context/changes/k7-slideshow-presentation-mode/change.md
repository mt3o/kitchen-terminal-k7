# k7-slideshow-presentation-mode

status: implemented
created: 2026-09-25
memory_goal: 65f9b13b-40b7-44d2-8769-d4df7e8d8004
change_anchor: 133eee1a-cec7-4f49-8232-a6dd7b20eb2a

## Goal
Let a Card look different — and later show different content — when the
Slideshow is presenting it than when somebody opened it fullscreen by hand,
with the clock as the first consumer.

## Outcome

Implemented directly on a branch rather than through the full
`/gw-new → /gw-plan → /gw-plan-review → /gw-implement` lifecycle; there is no
`plan.md` and there were no per-phase memory gates. The scope node and the
captures below were opened after the code was written, for traceability
(`[node:8b25dd73]`, `[node:465e38f0]`, `[node:1c30a45a]`, `[node:1d6acf4f]`).

`presentingElId(state)` derives "the Slideshow is showing this on its own" as
*manual suppresses slideshow*, the mirror of `promotedElId`'s *manual wins
over slideshow*. The DOM half carries `k7-slideshow-presenting` on the host
alongside `k7-fullscreen-active`, which is what lets a component style its own
presentation look with `:host(...)` from inside its shadow root. First
consumer: `K7Card.svelte` centres the clock's readout and takes it to
`--glance-lg`.

`npm run check` green (669 tests, 7 new covering every `presentingElId`
transition; eslint, token contract, `tsc`, `svelte-check` 0/1695, Vite build).

**Not verified on the iPad.** The compiled selector was checked in the bundle
and Safari 15 supports everything used, but nobody has looked at the wall
display.

### Caught by recall, not by review

The obvious name for the new class was `k7-slideshow-active`. Recall surfaced
`[node:009b7439]`, which documents that string as the *old* name of the
promotion class — renamed to `k7-fullscreen-active` by `[node:2733b7b2]` when
it stopped being Slideshow-exclusive. Reusing it would have left the graph and
the code disagreeing about what the selector denotes. Renamed to
`k7-slideshow-presenting`; the hazard is captured as `[node:1c30a45a]`, which
carries a CONTRADICTS edge to `009b7439` and has flagged it `needs_review` for
a human to rule on.

### Deferred

The content half of presentation is a seam with no consumer:
`presentingElIdStore` is exported and nothing subscribes. The motivating case
is a weather card that uses the whole screen for seven days, a temperature
graph and hourly precipitation — blocked on server work, since
`open-meteo.ts` requests no `hourly` variables and defaults `forecast_days` to
5. Captured as `[node:1d6acf4f]`.
