# Kitchen Terminal K7 — package guide

## Read order

1. **`DESIGN.md`** — intent, the amber/teal rule, contrast derivation, the
   Safari 15 budget. Read it before writing any component.
2. **`tokens.css`** — paste into the app shell (or `<style>` of any artifact)
   *before* component CSS. Nothing else defines a colour.
3. **`kitchen-terminal-k7-kit.html`** — the normative component spec. When
   the prose and the kit disagree, the kit wins.
4. **`theme.schema.v2.yaml`** — the contract the theme loader validates against.
5. **`themes/retro-scifi.yaml`** — the canonical theme, with per-role
   provenance (`KEPT` / `FIXED` / `NEW`) and measured contrast ratios.
6. **`design-tokens.json`** — for the theme loader and Storybook controls.
7. **`tailwind-v4.css`** — `@theme` bindings plus the `k7-*` component mixins.

## Highlights

- **Amber is the ink, teal is the signal.** Amber (`--fg`/`--accent`) is body
  text and chrome. Teal (`--signal`) means good-and-settled and appears at most
  twice per card. Warn and fail are *not* amber.
- **One solid amber control per card.** Everything else is ghost or text.
- **Three modes:** `dark` (default), `light`, `night`. Set via `data-mode` on
  `<html>`. `night` is 8.8× dimmer than `dark` and still clears WCAG AA.
- **`--text-base` is 20px,** not 16. The kiosk is read at 1 m; see `DESIGN.md`
  §4.2 for the arcminute table.
- **Radius 0, no drop shadows.** Elevation is a 1px border plus one step on the
  surface ramp.

## Do

- Reference `var(--*)` and nothing else from a component.
- Derive new colours in OKLCH at fixed hue/chroma, then ship the hex.
- Pair every state's foreground and background, and check the ratio.
- Give every focusable control a visible ring; ship the `:focus` fallback for
  Safari 15.0.
- Add a bracket glyph (`[OK]` `[!]` `[X]` `[--]`) beside every colour-coded
  state.
- Animate `opacity` and `transform` only.

## Avoid

- Any hex, `rgb()`, `font-family`, or `px` radius inside a component. Lint for
  it: `grep -rE '#[0-9a-fA-F]{3,6}' src/ --include=*.svelte --include=*.css`
  should return nothing.
- `color-mix()`, `oklch()`, `@container`, `:has()`, `subgrid`, `dvh`,
  `text-wrap: balance` — all past the Safari 15.0 baseline.
- Amber as a warning colour. On an amber screen it says nothing.
- Lowering text contrast on hover — including the `--fg-muted`-on-hover habit.
- Body text below `--text-base`. `--text-xs` is for true meta only.
- Per-card `backdrop-filter`, translucent card surfaces, soft shadows, or
  scanlines by default. Each costs a full-screen composite on the A8X.
- Emoji as functional icons. Use Tabler outline SVGs — `layout.schema.yaml`
  already names Tabler.

## Applying a theme

```
layout.yaml
  theme: "design-system/themes/retro-scifi.yaml"   # or daylight-lab.yaml
```

`daylight-lab.yaml` is a deliberate stress test: light, rounded, cool blue, no
HUD frame, no cursor. Swap to it and nothing should still render amber or
square. Anything that does is a component breaking the token contract.
