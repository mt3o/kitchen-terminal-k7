# Memory backlog — k7-phone-horizontal-overflow

The store was unreachable for this whole session: the `agentic-memory` MCP
server failed to connect (`ENOENT: Executable not found in $PATH:
agentic-memory-mcp`) and `agentic-memory` is not on PATH, so the CLI
transport was not available as a fallback. The `/gw-fix` skill was not
installed either; its lifecycle was followed by hand (red test → fix →
green → real-browser verification). Per the standing rule, memory
operations are queued here rather than skipped, and replayed when the
surface returns. Facet names and node ids below were read from the
committed `context/memory-graph.dump`; `domain_model()` could not be called,
so entity ids are the dump's `/entity/*` nodes.

## 1. create_change (outstanding)

`change.md` has no `memory_goal`. Mint the Goal (`k7-phone-horizontal-overflow`)
before replaying any capture below — goal-mandatory writes. No seed recall
was possible; the dump was grepped instead (ids in §2 and §4).

## 2. Captures

**a. decision — the card head is two zones, and only the controls zone can
push the row onto a second line.** `Card.svelte`'s head is
`.card-head-title` (label, plus meta when the widget has no actions) and
`.card-head-right` (the widget's actions, then `[ + ]`). The head row wraps
(DESIGN.md §6.1); the controls group wraps too and has `min-width: 0`, so a
group wider than the card breaks into lines instead of overflowing. At
phone width the title has `flex-basis: 0` and a floor of
`calc(3 * var(--text-sm))`: its text never decides where the row breaks
(label and meta truncate, as k7-mobile-responsive chose for the height
budget), and controls wrap only when the title would get less than the
floor. The floor is 3, not 4, label-ems because at 4 a half-width card at
375px (≈144px of content) sent a lone `[ + ]` to a second line and cost
GLOWNA's calendar 48px of height.
Rejected: pure §6.1 at phone width (title `flex-basis: auto`) — measured, it
adds a second head line to kalendarz, kalendarz-pelny, przepisy, obraz and
the Unsplash card, heads that fit on one line today; a lower floor or none
— a running timer's `reset [ + ]` beside the title left "MI…". At ≥768px the
title keeps `flex-basis: auto` (labels do not truncate there, so a basis of
0 would let a label overlap the controls); the only visible desktop effect
is at 768–1023px, where heads that used to wrap their label into a
two-line column beside `[ + ]` (or push `[ + ]` into the card edge) now
drop `[ + ]` to its own line. 1024×768 is pixel-identical.
Facets: frontend, css, layout, design. `ABOUT` → `Card` `[node:49ba726c]`.
Parents: `[node:25827824]`, `[node:2ee73f47]`.

**b. constraint — a group of head controls must be able to wrap.** A
widget's `{#snippet actions()}` renders into Card's controls group. A
container of several controls at the top of that snippet (`.controls` in
K7Timer, `.nav` in K7Unsplash/K7Carousel) must declare `flex-wrap: wrap`:
a flex container that cannot wrap has a min-content width equal to all of
its controls together, so no wrapping around it can make it narrower, and
it overflows any card narrower than that. Alternatively, render the
controls directly (K7Chat does, so its four buttons wrap as one flow — MENU
ARCHIWUM / NOWA [ + ] — instead of the group wrapping as a block and
leaving `[ + ]` a third line). Enforced for every `src/client/lib/*.svelte`
by `test/phone-horizontal-overflow.test.ts`.
Facets: frontend, css, layout, testing. `ABOUT` → `Card` `[node:49ba726c]`.
Parent: capture 2a.

**c. issue — a wrapping column flexbox is as wide as its widest item.**
`flex-direction: column; flex-wrap: wrap` with no definite height never
makes a second column, but it does make the container multi-line, and a
multi-line flex container sizes each line's cross size to its widest item
rather than to itself. K7Menu's vertical items were therefore all as wide
as "AUDIOMETR" (135px) in a 91px card body at 390×844, and cut off. A
vertical list is a single-line column (`align-items: stretch` then sizes
items to the container); `flex-wrap: wrap` belongs to the row orientation.
Borderline on the three-part test (a CSS fact rather than a trade-off);
kept because it is invisible at the widths the component was designed at
and was shipped once already.
Facets: frontend, css, layout. `ABOUT` → `Menu` `[node:441547c8]`.

**d. decision — a menu label that does not fit breaks mid-word rather than
truncating.** In a 1-of-3 column at phone width (~70px of text), tracked
text-sm cannot fit "PRZEPISY"/"MINUTNIK"/"AUDIOMETR" on one line at any
padding. `.label` gets `min-width: 0; overflow-wrap: break-word` (not
`anywhere`: Safari 15.4, past the floor), so the label breaks inside its
item ("PRZEPI/SY"); horizontal padding drops to `--space-2` at phone width
so the break comes as late as possible; min-height stays
`--control-h-sm`. Rejected: ellipsis — it hides the word the item is named
for, and the menu column has height to spare; smaller type or no tracking —
still does not fit at 375px, and `density: large` raises the scale again.
Facets: frontend, css, design, a11y. `ABOUT` → `Menu` `[node:441547c8]`.
Parent: capture 2c.

**e. issue — at phone width, a head with label + meta + `[ + ]` is still
crushed.** On GLOWNA's half-width calendar (and przepisy's recipes card)
the title zone gets ~62–78px for label and meta together, so both truncate
to a few characters ("L… da…" at 375px). This predates this change; what
moved is only the split — label and meta now share the title's width in
proportion to their text, where before `[ + ]` counted toward meta's share
and meta was squeezed to nothing. Full §6.1 wrapping would make both
readable at the cost of a ~48px second head line on those cards: a
height-budget-versus-legibility call for a human, not taken here.
Facets: frontend, design, layout. `ABOUT` → `Card` `[node:49ba726c]`,
`Calendar` `[node:a7e45cb9]`. Parent: capture 2a.

## 3. CONTRADICTS — for human review

- capture 2a `CONTRADICTS` `[node:25827824]`. That node prescribes
  `white-space: nowrap` + `flex-shrink: 0` on a control before its container
  gets `min-width: 0`, and says the two changes "are not safe to make
  independently". Made together, as prescribed, they were still unsafe:
  the container shrank, the control did not, and the control hung out of
  it past the card edge (34px on k7-image, 139px on k7-chat at 390×844). The
  missing third leg is a way out — the row has to be able to wrap. Recorded,
  not resolved.

## 4. Events (append_events)

- `USED` — `[node:25827824]` (head-row truncation + fullscreen-button
  nowrap), `[node:f7db89bf]` (k7-mobile-responsive: phone keeps the desktop
  column count; one-line truncating head), `[node:2ee73f47]` (§6.1 wrap
  applied to `.shell-head`), `[node:c5e8c11c]` (drop decoration before
  touch targets at phone width), `[node:49ba726c]` Card, `[node:441547c8]`
  Menu.
- `CONFIRMED` — `[node:2ee73f47]`: the same §6.1 wrap rule was the fix for
  the card head. `[node:c5e8c11c]`: applied a third time — K7Unsplash hides
  its dots at phone width (up to twelve dots are wider than a half-width
  card at 375px; the footer's "3/8" makes them redundant), and K7Menu's
  items give horizontal padding, not height.
- `CONTRADICTED` — `[node:25827824]`, see §3.
- `NOTED` — `[node:f7db89bf]`: its "all pages verified overflow-free at
  375x667" did not hold for horizontal overflow once pages gained a 1-of-3
  column (PRZEPISY) and head controls (chat actions, `[ + ]` on every
  fullscreen card, a running timer, Unsplash with photos).

## 5. Not for the graph

Per-card measurements (overflow widths before and after, the 55-card pixel
diff at 1024×768, touch-target sizes) are verification evidence for this
change's review, recorded in `change.md`. They fail the three-part test:
easy to re-measure, no trade-off behind them.
