# Memory backlog — k7-card-box-sizing

The store was unreachable for this whole session: the `agentic-memory` MCP
server failed to connect (`ENOENT: Executable not found in $PATH:
agentic-memory-mcp`) and `agentic-memory` is not on PATH, so the CLI
transport was not available as a fallback. The `/gw-fix` skill was not
installed in this session either; its lifecycle was followed by hand (red
test → minimal fix → green → verification). Per the standing rule, memory
operations are queued here rather than skipped, and replayed when the
surface returns. Facet names below come from the `facet_value` nodes in the
committed `context/memory-graph.dump`; node ids were read from it too.

## 1. create_change (outstanding)

`change.md` has no `memory_goal`. Mint the Goal (`k7-card-box-sizing`) before
replaying any capture below — goal-mandatory writes. No seed recall was
possible; the dump was grepped instead (ids in §2 and §4).

## 2. Captures

**a. constraint — app.css's box-sizing reset does not reach inside a widget.**
`*, *::before, *::after { box-sizing: border-box }` in app.css stops at every
shadow boundary, and every widget is a Svelte custom element with its own
shadow root, so inside a widget everything is content-box unless the
component declares otherwise. A shadow-root rule that sizes an element to
`100%` of its container (width/height/min-/max-) and also gives it padding
or a border must declare `box-sizing: border-box` itself;
`test/shadow-box-sizing.test.ts` enforces this for every `src/client/lib/*.svelte`.
Found because `.card { height: 100% }` plus 20px padding and a 2px border
made every card 44px taller than its grid cell, and `.page > *`'s
`overflow: hidden` hid the bottom border and footer badge on every card
since the shells were written.
Facets: frontend, css, layout. `ABOUT` → `Card` `[node:49ba726c]`.
Parent: `[node:240ae1c0]` (the shared-shell decision — the shell is where
the fix had to land).

**b. decision — targeted per-rule border-box, not a blanket per-shadow-root
reset.** Only rules that size to a container and add padding/border get
`box-sizing: border-box` (the card shells; `.frame`/`.comic`/`.pic` in
K7Comic, K7Image, K7Unsplash). A blanket `*, *::before, *::after` rule in
each shadow root was measured and rejected for this change: the UA stylesheet
already makes `<button>` border-box, so it changes only text inputs
(46→44px and 58→56px), calendar events (54→53px) and K7Timer's custom-time
fields (88→70px wide). That is cheap, and it would bring those controls to
the kit's exact `--control-h*`, but it resizes controls, which the reported
bug did not call for. The contract test covers the class of defect that
actually clips.
Facets: frontend, css, design. Parent: capture 2a.

**c. issue — non-button controls in widgets are content-box, unlike the
kit.** `design-system/kitchen-terminal-k7-kit.html` is authored under
`*{box-sizing:border-box}`; widget text inputs, calendar `.event` and
list `.row` elements are content-box, so a field specified as
`min-height: var(--control-h-sm)` (44px) renders 46px. Small, but it is a
standing divergence from the normative spec. Adopting 2b's blanket rule is
the known fix.
Facets: frontend, css, design. Parent: capture 2b.

**d. constraint — a card-body child sized `height: 100%` must be the body's
only child.** `.card-body` is `display: block`; a `height: 100%` element
beside a sibling (K7Calendar's `.week` under `.tabs`) overruns the body by
that sibling's height and lands on the footer row. Multi-child bodies wrap
their children in a `height: 100%` flex column and give the scroll region
`flex: 1 1 auto; min-height: 0` — the pattern K7ShoppingList and K7Timer
already use. K7Calendar's overrun was 48px; it was invisible until the
shell fix exposed the footer, and the last ~35px of the scrolled week had
always been cut off by the cell's clip.
Facets: frontend, css, layout, calendar. Parent: `[node:14679772]`.

## 3. CONTRADICTS — none

Nothing captured here contradicts an existing node.

## 4. Events (append_events)

- `USED` — `[node:240ae1c0]` (shared card shell: Card.svelte is the one
  file to fix), `[node:49912e9d]` (the shadow-root `:host` gotcha family),
  `[node:14679772]` (flex-column card body pattern, reused for K7Calendar).
- `CONFIRMED` — `[node:14679772]`: the same wrapper pattern was the fix for
  K7Calendar's `.tabs` + `.week`.
- `NOTED` — `[node:3ea28fac]`, `[node:97d0c4ba]`: k7-mobile-responsive's
  phone-width height budgets were measured while every card shell overflowed
  its cell by 2×(padding + border) (20px at phone width, 44px at ≥768px), so
  the footer row sat below the clip in those measurements. Their conclusions
  about content overflow stand; any pixel budget taken from them is off by
  that amount.

## 5. Not for the graph

The per-page measurement numbers (card sizes, the ~7px of slack left in
SYS.POGODA at 1024×768) are verification evidence for this change's review,
recorded in `change.md`. They fail the three-part test: easy to re-measure,
unsurprising, and no trade-off behind them.
