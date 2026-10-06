# Kawaii — credits

Everything under this directory ships with the `kawaii` theme and is served
by `/theme-assets/` only while that theme is the active one.

## Illustrations — generated for this theme

The four scenic page backdrops were generated with Google Gemini (image
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

### Card pictures

Fifteen more files, `images/card-*-{light,dark,night}.jpg`: five daytime
scenes (cat asleep on a cloud, unicorn in a meadow, kittens' cupcake picnic,
cat with heart balloons, kitten on a windowsill) and five bedtime ones, the
latter used for both dark and night. Same generator, same date, prompts
asking for the scene in the bottom 40% and plain sky above.

`scripts/kawaii-card-pictures.mjs` made them from the originals: cover-crop
to 1024×768, blend toward the mode's `surface`, then clamp every pixel so
each of the seven text roles keeps ≥ 4.5:1 on it — measured on the decoded
JPEG, with the target raised until JPEG ringing could not break it. Light
pictures stay pastel; dark ones are dusky; night ones are barely there.

## Vector art — drawn for this theme

Everything in `decor/` — the pattern backdrops, the rainbow card ribbon, the
title rule and the caticorn in the header — is drawn
by `scripts/draw-kawaii-decor.mjs` in this repository. Redraw it there rather
than editing the SVGs.

## Fonts — SIL Open Font License 1.1

| Files | Family | Licence |
|---|---|---|
| `fonts/nunito-*.woff2` | Nunito (The Nunito Project Authors), variable 400–900 | `fonts/OFL-Nunito.txt` |
| `fonts/baloo2-*.woff2` | Baloo 2 (The Baloo 2 Project Authors), variable 400–800 | `fonts/OFL-Baloo2.txt` |

Latin and latin-ext subsets as served by Google Fonts, unmodified; the
`unicode-range` of each is copied from Google's CSS into `../kawaii.yaml`.
