# k7-timer-presets-overflow

status: implemented, awaiting review/commit
created: 2026-09-10

## Goal
Fix a visual glitch reported from the real iPad recording: the MINUTNIK
(timer) card's preset-minutes buttons overflow their card's bottom edge
and get clipped mid-button, rather than all nine presets being reachable.

Root cause: on the GLOWNA page (2 columns; zakupy takes the whole first
column via `span.rows: 0`), minutnik shares column 2 with zegar and
pogoda, so it gets 1/3 of the page's height. `presetsMinutes` defaults
to 9 values (1,3,5,10,15,20,30,45,60 per layout.yaml), which wrap into
three button rows plus the "WLASNY CZAS" custom-time row underneath —
more vertical content than the card's allotted row. `.presets` in
K7Timer.svelte is a plain `flex-wrap: wrap` block with no scroll
affordance, so Card.svelte's `.card { overflow: hidden }` silently
clips the third row instead of making it reachable. K7ShoppingList.svelte
already established the fix pattern for exactly this situation
(`.list { flex: 1 1 auto; min-height: 0; overflow-y: auto }`) — the
layout.yaml comment on the `zakupy` card even names it explicitly:
"sharing a column with another card gives it four visible rows and a
scrollbar."

design_surface: none

memory_goal: 66aacf49-97a4-4743-a6e2-0f766a0c9301
