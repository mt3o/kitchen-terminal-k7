# Memory backlog — k7-card-foot-badge

The store was unreachable for this whole session: the `agentic-memory` MCP
server failed to connect (`ENOENT: Executable not found in $PATH:
agentic-memory-mcp`) and `agentic-memory` is not on PATH, so the CLI
transport was not available as a fallback. The `/gw-fix` skill was not
installed either; its lifecycle was followed by hand (red test → minimal
fix → green → browser verification). Per the standing rule, memory
operations are queued here rather than skipped. Facet names come from the
`facet_value` nodes in the committed `context/memory-graph.dump`; node ids
were read from it too.

## 1. create_change (outstanding)

`change.md` has no `memory_goal`. Mint the Goal (`k7-card-foot-badge`)
before replaying any capture below — goal-mandatory writes. No seed recall
was possible; the dump was grepped instead (ids in §2 and §4).

## 2. Captures

**a. constraint — the status badge is one unbreakable unit.** The card
footer's `[OK]` / `[!]` / `[X]` / `[--]` is the state carrier that does not
depend on colour (DESIGN.md §8), so in both card shells `.badge` is
`white-space: nowrap; flex-shrink: 0`, and a footer that pairs text with it
is `flex-wrap: wrap` — the badge drops to its own line, still bottom-right,
instead of being squeezed. Not obvious: a hyphen is a line-break
opportunity, so the idle `[--]` in a shrinkable flex item breaks as "[-"
over "-]" as soon as a sibling (K7Chat's footer meta at 390×844) presses it
to its min-content, while `[OK]`, `[!]` and `[X]` never show the defect.
`test/card-foot-badge.test.ts` enforces it for Card.svelte and K7Card.svelte.
Facets: frontend, css, layout, a11y. `ABOUT` → `Card`
`[node:49ba726c-031e-4a01-839f-11a76a8bf009]`.
Parent: `[node:240ae1c0-1cd0-40c2-974e-e5df93897bc9]` (the shared-shell
decision — one file to fix for every Card-based widget), and
k7-card-box-sizing's backlog capture 2a once replayed (that fix is what made
the footer visible and exposed this).

**b. issue — the clock card's date line is wider than a half-width card at
phone width.** K7Card's `.body` for the clock ("poniedziałek, 21 września
2026") at ≤390px: "poniedziałek," is one word wider than the content box
of a half-width GLOWNA card, and its comma paints over the right border
(0.5px past the border box at 375×667; nothing is cut, since K7Card has no
`overflow: hidden`). `overflow-wrap: break-word` would start the next line
with ", 21" and add a line of height to a card with no slack; a smaller
date size at phone width is a typography decision. Open until someone
decides which of those it is. The longest Polish weekday and month names
("poniedziałek", "października") are the cases to test.
Facets: frontend, css, layout, ui. `ABOUT` → `Card`
`[node:49ba726c-031e-4a01-839f-11a76a8bf009]`.

## 3. CONTRADICTS — none

Nothing captured here contradicts an existing node.

## 4. Events (append_events)

- `USED` — `[node:240ae1c0-1cd0-40c2-974e-e5df93897bc9]` (shared card shell:
  Card.svelte is the one footer to fix), `[node:2ee73f47-a258-479c-acf0-5e1a6fbf46b4]`
  (§6.1 "rows wrap before they crush" applied to the shell head).
- `CONFIRMED` — `[node:2ee73f47-a258-479c-acf0-5e1a6fbf46b4]`: the same rule
  was the fix for the card footer.

## 5. Not for the graph

- Footer-wrap vs one-line truncate-first (PR #69's head approach) is argued in
  `change.md`. It fails the three-part test's first leg: it is one CSS
  property on one rule to reverse.
- Pixel measurements (46px → 51px footer, the 83×11px weather-age diff at
  1024×768) are verification evidence for this change's review. Easy to
  re-measure, no trade-off behind them.
