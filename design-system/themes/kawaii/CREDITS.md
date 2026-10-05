# Kawaii — credits

Everything under this directory ships with the `kawaii` theme and is served
by `/theme-assets/` only while that theme is the active one.

## Illustrations — generated for this theme

The four scenic backdrops were generated with Google Gemini (image
generation) on 2026-10-05, from prompts written for this theme: flat, pastel,
kawaii, "no text, no border". They depict no real person, brand or existing
character.

| File | Scene | Changes |
|---|---|---|
| `images/meadow-light.jpg` | a baby unicorn and the caticorn on a hill under a rainbow | light set¹ |
| `images/catnap-light.jpg` | a tabby asleep on a cloud, the caticorn peeking from another | light set¹ |
| `images/moon-dark.jpg` | the caticorn asleep on a crescent moon | dark set² |
| `images/hill-dark.jpg` | a unicorn and a cat asleep on a blanket under a night rainbow | dark set² |

¹ Light set: cover-cropped to 4:3 at 1280×960, JPEG q0.80. Colours untouched.
² Dark set: the same crop, then brightness scaled (×0.54 and ×0.59) until the
95th-percentile luminance is 0.17 — the level the other decorated themes'
dark backdrops use — so the bedtime sky does not glow. Night mode dims them
further with its overlay.

## Vector art — drawn for this theme

Everything in `decor/` — the pattern backdrops, the rainbow card ribbon, the
title rule, the caticorn in the header and the paw-print watermark — is drawn
by `scripts/draw-kawaii-decor.mjs` in this repository. Redraw it there rather
than editing the SVGs.

## Fonts — SIL Open Font License 1.1

| Files | Family | Licence |
|---|---|---|
| `fonts/nunito-*.woff2` | Nunito (The Nunito Project Authors), variable 400–900 | `fonts/OFL-Nunito.txt` |
| `fonts/baloo2-*.woff2` | Baloo 2 (The Baloo 2 Project Authors), variable 400–800 | `fonts/OFL-Baloo2.txt` |

Latin and latin-ext subsets as served by Google Fonts, unmodified; the
`unicode-range` of each is copied from Google's CSS into `../kawaii.yaml`.
