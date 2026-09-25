# themes/ — how to build one

A theme is **one YAML file plus its own folder of files**. Four exist:
`retro-scifi` (the default), `daylight-lab` (a deliberate stress test),
`steampunk-brass`, `punktomat` and `hellforge`. The last three are "decorated":
self-hosted fonts, background pictures, `border-image` ornaments.

Read `../DESIGN.md` first for *why* the system is the way it is. This file is
the *how*, and the list of things that have already gone wrong.

## The rule that governs everything

Components read `var(--*)` and nothing else. A theme may not need a component
change — `hellforge` needed none — and if you find yourself editing a
`.svelte` file to make a theme look right, stop: either a slot already covers
it, or you are adding a slot to the contract, which is a separate change with
its own tests. `scripts/check-token-contract.py` fails the build if a component
names a colour, face or radius itself.

## Where things live, and how a theme is found

```
design-system/themes/
  my-theme.yaml          ← the theme. Its basename is its id.
  my-theme/              ← everything it ships
    fonts/*.woff2 + OFL-*.txt
    images/*.jpg
    decor/*.svg
    CREDITS.md           ← required if you ship anyone else's work
```

- The **id** is the YAML's basename (`server/theme/catalogue.ts`). Drop the
  file in and it appears in the header menu; nothing registers it.
- **Files are served only if the theme names them.** `/theme-assets/<path>`
  checks the active theme's declared paths (`themeAssetPaths`), so a file that
  is in the folder but not referenced is a 404, and `../` never escapes.
- Reference a file as `asset("my-theme/decor/x.svg")` inside any raw-CSS slot.
  The generator rewrites it to a hashed URL. **If you add a new raw-CSS slot to
  the contract, wire it into `resolveAssets` *and* `themeAssetPaths`** — the
  header band was added to one and not the other, and the bug only showed for a
  theme that used a file there.

## Switching to it

```yaml
# layout.yaml — the wall
theme: "design-system/themes/my-theme.yaml"
# layout.local.yaml — this machine only, gitignored
theme: "design-system/themes/my-theme.yaml"
```

…or the header menu, which is per browser tab (sessionStorage) and never
changes what the kitchen shows.

## The slots

Everything below is optional and defaults to "what an undecorated theme
renders", which is how retro stays pixel-identical when a slot is added.

| Slot | Token(s) | Default |
|---|---|---|
| `typography.fontFamily` / `weights` / `scale` | `--font-ui`, `--weight-*`, `--text-*`, `--glance-*` | required |
| `typography.monoFontFamily` | `--font-mono` | `var(--font-ui)` |
| `typography.fontFaces[]` | `@font-face` | none |
| `typography.display.{fontFamily,sizePx,weight,case,letterSpacingPx,lineHeight}` | `--font-display`, `--display-*` | the HUD label's own values |
| `colors.*` (+ `display`, `cardBorder`) | `--fg`, `--accent`, `--fg-display`, `--card-border`, … | `display`→textMuted, `cardBorder`→borderStrong |
| `header.{background,padding,colors}` | `--shell-head-bg/-pad/-radius`, ink on `[data-region="header"]` | no band |
| `ornament.pageBackground` (string or **list per mode**) | `--page-bg` | the mode's `--bg` |
| `ornament.pageOverlay` | layered over every backdrop | none |
| `ornament.backdropEveryMinutes` | `--backdrop-count`, `--backdrop-every` | 60 |
| `ornament.cardBackground` | `--card-bg` | the mode's `--surface` |
| `ornament.cardFrame` / `rule` | `--card-frame`, `--rule` (`border-image`) | `none` |

Schema with descriptions: `../theme.schema.v2.yaml`. Worked examples, heavily
commented, in `steampunk-brass.yaml` (rotation, brass frames) and
`hellforge.yaml` (band watermark, blood-drip rule).

## Recipe

1. **Palette, in OKLCH, delivered as hex.** Every text role must reach 4.5:1 on
   that mode's `surface`, `surfaceRaised` *and* `surfaceSunken`; `borderStrong`
   and `focus` 3:1; `accentFg` 4.5:1 on accent, accentHover and accentActive;
   `warn` at least 25° of hue from `accent` or it reads as the same colour.
   `textDisabled` is the only role allowed below AA. `test/theme.test.ts`
   enforces all of this for every theme in this directory automatically.
2. **Three modes.** `dark`, `light`, `night` — night falls back to dark if
   omitted, which is usually wrong for a decorated theme: dim the *pictures*
   too, via a night overlay or a darker variant. Light mode is not optional
   thinking: the kitchen is sunlit at 14:00.
3. **Fonts.** Self-host woff2 (`fontFaces`), latin **and latin-ext** — Polish
   needs it — with each subset's `unicode-range` copied from Google's CSS. The
   clock wants **tabular figures**: check with fontkit that all ten digits have
   one advance width, or the time jitters every minute. Keep the x-height near
   Source Code Pro's 0.486 em or DESIGN.md §4.2's reading-distance table stops
   holding. A variable face declares `weight: "400 900"`.
4. **A display face** is titles only. Card titles are written in capitals
   (`LOG.WYDARZENIA`), and script or uncial capitals are unreadable, so set
   `case: lowercase` — the first letter is capitalised back by the components.
   Set `lineHeight` (≈1.05) for anything larger than the label, or every card
   body loses the difference (see pitfalls).
5. **Pictures.** Normalise them so the set reads as one: for dark sets, scale
   brightness until the 95th-percentile luminance is ~0.17 (what the existing
   themes use); for light sets, re-ink through one ramp. Rotation is a list per
   mode; each mode's list is independent and a shorter one wraps.
6. **Ornaments** are `border-image`. Nine-slice for frames
   (`asset(…) 32 / 20px / 0 stretch`), bottom-edge only for rules
   (`asset(…) 0 0 30 0 / 0 0 20px 0 / 0 0 16px 0 round`). `round` tiles without
   distorting; `stretch` is for plain bars only.
7. **Credits.** Anything you did not draw gets a row in `CREDITS.md`: source,
   author, licence, and what you changed.

## Verify — this is the part that matters

```bash
npx vite build                       # the client the preview serves
node scripts/theme-preview.mjs       # http://127.0.0.1:8791, no backend needed
npm i --no-save playwright-core
node scripts/theme-contrast.mjs my-theme        # every mode, page and backdrop
node --test test/theme.test.ts                  # palette, slots, asset allowlist
node scripts/build-tokens.mjs --check           # the default theme is untouched
```

`theme-contrast.mjs` measures **the pixels the glyphs actually cover**, not
each string's bounding box. That distinction is not academic: the box method
reads coloured bars and borders that merely sit inside a box, reports 1.5:1 for
text that is plainly legible, and hides the real failures in the noise.

Then **look at it**: every page (`--pages`), all three modes, and the changelog
and issue-log dialogs, which are easy to forget and easy to leave unthemed.

## Pitfalls, each of which has already happened

- **A `border-image` rule under a title eats the descenders.** At `outset 9px`
  the divider's bright edge ran through the glyph bottoms and dropped titles to
  1.9:1. Give the image enough outset (16px worked) to clear the text.
- **A card watermark sits under the status badge.** `[OK]` lives in the card's
  bottom-right, which is exactly where a corner watermark is densest. Keep the
  watermark faint (≤8% stroke) or move it.
- **Header band height comes out of every card.** Cards fit their grid cells
  exactly, so a tall band, a tall title or extra card padding all shorten the
  card body — the weather card's forecast row is the canary, and
  `.wrap { overflow-y: auto }` hides the loss silently rather than clipping
  visibly. 6px of band padding ≈ the plain header.
- **ASCII art needs `monoFontFamily`.** The weather glyph and the ascii-art card
  are drawn in character cells; a proportional UI face turns them to soup.
- **Keep cards opaque and backgrounds static.** The pager slides one composited
  layer; translucency and animated backgrounds cost paint on every frame on an
  A8X. No soft shadows (DESIGN.md §5) — depth comes from the frame image.
- **Safari 15 floor.** No `color-mix()`, `oklch()` in output, `:has()`,
  `@container`, `dvh`. Derive in OKLCH, ship hex.
- **Night is not "dark, but darker".** Dim the pictures and the ornaments too,
  or a theme that is calm in dark mode glows at 03:00.
- **Budget.** A decorated theme runs ~2 MB, nearly all pictures. The service
  worker caches them by hashed URL, so they cost once.
