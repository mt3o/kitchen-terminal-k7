# k7-punktomat-theme

status: implemented
created: 2026-09-21
branch: claude/punktomat-theme
memory_goal: UNAVAILABLE — agentic-memory unreachable this session (MCP server
  ENOENT on `agentic-memory-mcp`, `agentic-memory` CLI not on PATH); see
  memory-backlog.md.
design_surface: n/a — a theme instance plus two optional token slots. Under
  every existing theme each surface is pixel-identical (screenshot-diffed).

## Goal

A theme inspired by the Punktomat design system — the household's other app,
which the layout schema already describes as sharing a design system with K7.
Its tokens (colours, type, radii) and three decorative assets (cork texture,
cobweb, coffee stain) are reused. Punktomat's repository is private; the
household explicitly approved publishing those decorative files and values in
this public repository (2026-09-21).

## What changed

- **Contract (optional, defaults = as before):**
  - `colors.cardBorder` → `--card-border` (default: borderStrong). Punktomat
    cards have a soft hairline, but borderStrong also outlines buttons, active
    tabs and focused inputs and must stay at 3:1.
  - `header.{background, padding, colors}` → `--shell-head-bg`,
    `--shell-head-pad`, `--shell-head-radius`, plus the header's own ink
    scoped to `data-region="header"` on the shell header.
  - `typography.fontFaces[].weight` may be a range ("400 900") for a
    variable face.
  - `body` now reads `--weight-regular` (400 everywhere but here: 600).
- **Theme:** `design-system/themes/punktomat.yaml` + `punktomat/` — Nunito
  (variable, self-hosted), the cork texture, cobweb and coffee stain, with
  dark/night recolours. Credits in `punktomat/CREDITS.md`.

## Deliberate departures from Punktomat

- K7's 20px reading scale, not the 14px phone scale (Nunito's x-height
  0.484 em ≈ Source Code Pro's 0.486, so DESIGN.md §4.2 holds).
- No soft shadows (DESIGN.md §5).
- Green / orange / red darkened to AA as text colours (2.9, 2.9 and 3.8:1 on
  white as shipped in Punktomat).
- Header gradient ends at purple-dark, not purple: at `#7c5cbf` lavender text
  at the right-hand end would fall under 4.5:1.
- One radius (14px) where Punktomat has 10/16/99.
- Dark and night modes are new — Punktomat is light-only.

## Verified

- Retro, three modes x three pages: identical to the original baseline except
  the clock and live weather values.
- Punktomat: header/footer text worst rendered pixel >= 4.69:1 in all modes;
  252 card text elements on six pages x three modes all >= 4.5:1.
- New test: header ink >= 4.5:1 against every colour stop of the band, for
  every theme that has one.
- `npm run check` green.
- Not verified on the iPad.
