# k7-page-model

```yaml
change_id: k7-page-model
memory_goal: 54cce183-229d-4f45-8d15-ff1f0696b66c
branch: change/k7-page-model
```

## What this delivers

The layout has **pages**: ordered screenfuls, swiped between, each with its own
grid. Adding a card now costs a page rather than shrinking the cards already on
the wall.

`layout.yaml` ships two: `GLOWNA` (clock, weather, shopping list, timer) and
`DOM` (calendar, chat, recipes, comic). Eight cards, two pages, nothing scrolls.

## Not `subgrid`, and the reason matters

CSS `subgrid` is Safari 16 — past the floor, and the token-contract check fails a
build that ships it. But the deeper point is that it solves a different problem:
it exists so a child's tracks can align with its **parent's**, and across
independently paged screenfuls they must not. Each page sizes its own rows from
its own card count.

Asking for a subgrid here is almost always asking for a nested grid.

## Not a `Slideshow`, and the domain model says so

`Slideshow` was already ratified as *"the full-screen idle rotation controller"*.
A `Page` is always visible and changes on a deliberate gesture. Both can exist in
one layout, so keeping the words apart is not pedantry — it is the `grid` homonym
lesson applied before it costs anything.

`Page` is captured and **`proposed`**. It needs ratification before it is settled
vocabulary.

## v1 layouts still work

A file with a bare `cards` list normalises to exactly one page. That happens once
on the **server**, so the renderer has a single shape to draw — two code paths
through a layout is how the single-page case quietly stops being exercised, and
the single-page case is every layout written before today.

## Gesture

`transform` only, per the frame budget. The track drops its transition while a
finger is down, so the drag tracks the finger rather than lagging behind it, and
the ends resist instead of wrapping — a wall display that loops surprises anyone
counting pages and nothing on screen says it will. Arrow keys work for the
desktop preview. `prefers-reduced-motion` removes the animation.

## Verified

| | |
|---|---|
| `npm run check` | **64/64** |
| Real touch flick via CDP | track `0 → -992px`, indicator advanced |
| 1024×768 and 375×667 | zero overflow, footer visible, 2 pages |

## Not done

- **Page overflow is unhandled.** A page with more cards than fit still shrinks
  them; nothing yet refuses to validate or spills to a new page. That was one of
  the two open questions in the plan and it is still open.
- No swipe affordance beyond the dots — a first-time viewer is not told the
  screen pages.
