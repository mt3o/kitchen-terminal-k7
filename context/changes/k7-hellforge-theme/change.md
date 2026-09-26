# k7-hellforge-theme

status: implemented
created: 2026-09-22
branch: claude/hellforge-theme
memory_goal: UNAVAILABLE — agentic-memory unreachable this session (the MCP
  server is configured for a POSIX shell and this session runs on Windows; the
  `agentic-memory` CLI is not on PATH here either). See memory-backlog.md.
design_surface: n/a — a theme instance. No component changed.

## Goal

A Diablo-inspired theme, asked for as "hell-related decorations, demons, fire
and blood, pentagrams and such stuff".

## What it is

`design-system/themes/hellforge.yaml` + `hellforge/`:

- **Dark (home):** iron plates over a forge. Cards are framed by a nine-sliced
  iron `border-image` with clawed corners and an ember stud; every card carries
  a pentagram branded into its corner; blood runs off the divider under the
  shell header and every card title; the header is a blood-gradient band with a
  horned sigil watermark and an ember for the cursor.
- **Light:** the other half of the fiction — a scorched Horadric codex (burnt
  vellum, rubric red, iron-gall ink). Not a concession: a wall display that is
  only legible after dark is a worse one to live with (DESIGN.md §1's three
  distances, at 14:00).
- **Night:** the forge banked.
- **Backdrops:** six hellfire photographs (dark/night) and four burnt papers
  (light), rotating hourly through the existing backdrop mechanism.
- **Type:** Uncial Antiqua for titles — picked over Pirata One, Grenze Gotisch,
  Cinzel Decorative, MedievalSharp and Metamorphous on legibility at 23px —
  and Spectral for text, whose figures are tabular by default.

## The contract held, with one gap

This theme needed **no component change**: `fontFaces`, `display`,
`colors.cardBorder`, `header` and `ornament` (backdrop list, overlay, card
background, frame, rule) already existed for steampunk-brass and punktomat.

The one gap found: `header.background` was emitted raw, so `asset("…")` inside
it reached the browser unresolved, and the named file was not in the served
allowlist. Both fixed in `theme/generate.ts` (three lines), with tests. That is
the whole code change in this branch.

## Verified

- Contrast measured on the pixels the glyphs actually cover (render, then
  render again with every colour transparent, diff the two): header and footer
  on all six backdrops x three modes — worst 4.72; every card string on six
  pages x three modes — worst 4.57. Both above 4.5.
- Two real problems were found that way and fixed: card titles sat on the blood
  bar's ember bevel (1.92-2.86) — the rule's outset moved from 9 to 16px; and
  in light mode the `[OK]` badge sat on the pentagram watermark over the card's
  scorch gradient (3.73) — watermark faded to 7 %, the gradient eased, and the
  light jade darkened to #17573a.
- `node --test` on the theme suites: 105 pass, including the repo's own
  "every theme meets WCAG AA in every mode", which picks this theme up from the
  directory.
- Token contract lint clean; `design-system/tokens.css` byte-identical
  (content) — the default theme is untouched.

## Not verified

- **The iPad.** Nothing here has been seen on Safari 15.
- **`npm run check` as a whole, on this machine.** `better-sqlite3` cannot be
  built here (no MSVC on Windows, no `make` in WSL and sudo needs a password),
  so the DB-backed tests and the real server do not run. The screenshots and
  the audit above used the real built client and the real generated token sheet
  against a scratchpad mock backend; CI runs the full suite.
