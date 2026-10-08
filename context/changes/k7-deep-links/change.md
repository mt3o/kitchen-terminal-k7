# k7-deep-links

status: open
created: 2026-10-08
tracker: github #103 (first slice only)
branch: claude/k7-deep-links

memory_goal: a61d23a2-594c-4bf3-8513-74952ef86b05
change_anchor: 99a85019-f436-45d1-9048-99bf532fd62a
parent: 59472cdc-4531-4206-a9fc-968166c52250   # foundation

## Goal
Push dashboard state (page, manual fullscreen card, open recipe) to a hash URL
so a link reopens the same view and Back undoes the last human navigation,
without the Slideshow ever touching history.

## Scope (owner-settled)
- Routes: `#/p/<pageId>`, `#/p/<pageId>/card/<cardId>?fs=1`, `#/recipe/<recipeId>`.
- Unknown ids fall back silently (replaceState to what is actually shown).
- The Slideshow never writes history.
- Out of scope (follow-ups): calendar event links + detail view, a share /
  "copy link" affordance, layout.local.yaml mismatch handling beyond the
  silent fallback.

## Where it lives
- `src/client/lib/deep-link.ts` — parse/serialize, reducer, DOM-free router.
- `src/client/main.ts` — wiring to pager / fullscreen-lock / k7-events.
- `src/client/lib/k7-events.ts` — RECIPE_OPEN / RECIPE_CLOSE / RECIPE_SHOWN.
- `src/client/lib/K7Recipes.svelte` — announce + obey, no mode restructuring.
- `src/client/lib/pager.ts` — additive `onChange` option.
