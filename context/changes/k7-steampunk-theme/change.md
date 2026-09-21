# k7-steampunk-theme

status: implemented
created: 2026-09-21
branch: claude/steampunk-k7-theme-0c408c
memory_goal: UNAVAILABLE — agentic-memory unreachable this session (MCP server
  ENOENT on `agentic-memory-mcp`, `agentic-memory` CLI not on PATH). The store
  itself could not be reached by either transport; see memory-backlog.md.
design_surface: n/a — a theme instance plus optional token slots. No screen's
  structure, order or copy changes; under the default theme every surface is
  pixel-identical to before (screenshot-diffed, see "Verified").

## Goal

A third theme, heavily steampunk: a cursive title face, pictures in the
backgrounds, decorative borders. Asked for directly by the household.

It could not be written as a theme file alone. The contract had no slot for a
second face, for self-hosted fonts at all (`fontSourceWoff2` was declared and
never emitted), for background pictures (the v1 `background` block is not
mode-aware and was never wired), or for decorative borders. So the change is
two halves: optional slots in the contract, then the theme that fills them.

## What changed

- **Contract (optional, defaults = as before):** `typography.fontFaces`,
  `typography.monoFontFamily`, `typography.display`, `colors.display`,
  `ornament.{pageBackground, cardBackground, cardFrame, rule}`. New tokens:
  `--font-display`, `--display-{size,weight,case,tracking}`, `--fg-display`,
  `--page-bg`, `--card-bg`, `--card-frame`, `--rule`.
- **Components** read them in exactly the places the old values were read:
  card shells (Card.svelte, K7Card.svelte), body background, the shell header
  rule and title, the changelog dialog.
- **Server:** `/theme-assets/*` serves only the files the active theme names,
  versioned by content hash; `/theme.css` points at them.
- **Theme:** `design-system/themes/steampunk-brass.yaml` + `steampunk-brass/`
  (13 Unsplash photos, 3 OFL font families, 5 hand-drawn SVG ornaments).
  Credits in `steampunk-brass/CREDITS.md`.
- **Rotating backdrops** (second round, same day, asked for after the first
  review: "more variants for the background picture"). `pageBackground` may be
  a list per mode, with `pageOverlay` and `backdropEveryMinutes` alongside. The
  generator emits one `[data-backdrop="n"]` rule per extra backdrop and mode;
  `src/client/lib/backdrop.ts` picks the index from the local clock, decodes
  the next picture before swapping, and keeps the current one if it cannot
  load. 6 dark/night + 6 light backdrops, hourly.

## Non-goals

- Not the default. `layout.yaml` still names retro; the household switches with
  one line, or tries it via the gitignored `layout.local.yaml`.
- No change to the retro or daylight designs.
- `effects.blinkingCursor` / `boxShadow` / v1 `background` remain unwired — they
  were unwired before this change too.

## Verified

- Retro, dark/light/night, three pages: before/after screenshots differ only in
  the clock digits and a "min temu" string (time passing between shots).
- Steampunk: every non-disabled text element on six pages x three modes (255)
  clears 4.5:1 against its *rendered* background — text hidden, worst pixel
  sampled — not only against the `surface` token. Header/footer too, after
  strengthening the light-mode band (STATUS was 4.44).
- Every backdrop x mode (18): header/footer text worst pixel >= 4.55:1.
- Rotation, in Chromium with a fake clock: at 10:59:30 backdrop 4 shown; on
  crossing 11:00 backdrop 5's picture was fetched and decoded, then the
  attribute flipped (25 ms later) — no frame without a picture.
- `npm run check`: lint, token contract, tokens drift, all tests, typecheck,
  svelte-check, build — green.
- Not verified: the real iPad (Safari 15). `border-image` with SVG, `calc`-free
  px gradient stops and `::first-letter` on flex items are all within Safari
  15's support, but nobody has looked at it on the device yet.

## Found along the way (not fixed here)

- Every card is taller than its grid cell by padding + border (content-box
  inside shadow roots), so its bottom edge is clipped — in every theme. Spun off
  as its own task; the brass frame's bottom brackets will appear once fixed.
- daylight-lab's `borderStrong` is below 3:1 in dark (2.26) and night (1.90).
  Recorded as a named known exception in test/theme.test.ts.
