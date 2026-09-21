# k7-card-box-sizing

status: implemented, awaiting review/commit
created: 2026-09-21
lifecycle: /gw-fix (bug — red test before the source edit)

## Goal
Fix a visual defect on every card of every page (retro theme included):
the card's bottom edge — its bottom border and the footer status badge
(`[OK]` / `[!]` / `[X]` / `[--]`) — is clipped and never shows.

Root cause: app.css's `*, *::before, *::after { box-sizing: border-box }`
does not cross shadow-DOM boundaries, and every widget is a Svelte custom
element with its own shadow root. Inside it, the card shell
(`Card.svelte`, `K7Card.svelte`) is content-box, so
`.card { height: 100%; padding: var(--card-pad); border: var(--border-w-strong) }`
comes out as cell height + 2×padding + 2×border — measured 337px in a
293px cell on GLOWNA at 1024×768 (retro: 20px padding + 2px border per
side = 44px; 20px at phone width, where padding drops to `--space-2`).
app.css's `.page > * { overflow: hidden }` then clips the excess.

Fix: `box-sizing: border-box` on the card shells, plus the other
shadow-root rules with the same defect: a `100%` width/height/max-*
alongside padding or a border (`.frame`, `.comic` in K7Comic;
`.frame`, `.pic` in K7Image; `.pic` in K7Unsplash). A contract test
(`test/shadow-box-sizing.test.ts`) catches the next widget that adds the
same combination.

Exposed by the fix, fixed here too: K7Calendar's `.week` was `height: 100%`
of a `.card-body` it shares with the 48px `.tabs` row, so once the footer
badge became visible the week drew over it. Before, that overrun sat below
the cell's clip, and so did the last ~35px of the scrolled week. `.tabs`
and `.week` now share a `.wrap` flex column (K7ShoppingList's pattern), and
`.week` takes `flex: 1 1 auto` instead.

Considered and not taken: a blanket per-shadow-root
`*, *::before, *::after { box-sizing: border-box }`. Measured in Chromium
by injecting it into every shadow root on top of this fix, it changes only
text inputs (46→44px and 58→56px, since the UA already makes `<button>`
border-box), calendar events (54→53px) and the timer's custom-time fields
(88→70px wide). It is a reasonable follow-up for kit parity, but it resizes
controls, which this bug does not call for — see memory-backlog.md §2c.

Verified in headless Chromium: every page of layout.yaml (every MENU tab
on PRZEPISY included), dark and light, 1024×768 and 390×844. Every card now
fits its cell exactly and its footer badge is visible, nothing draws over a
footer, and no content that was visible before is clipped now. Tightest
case: SYS.POGODA at 1024×768 keeps ~7px of slack (was ~37px) before its
own scroll kicks in; glyphs are intact. Pre-existing and unchanged at
phone width: MENU tab labels and some header buttons (`[ + ]`, NOWA)
overflow horizontally.

design_surface: none

tracker: github — no issue opened (creating one is outward-facing; left
for the human to open or waive)

memory_goal: (not minted — store unreachable this session; see memory-backlog.md)
