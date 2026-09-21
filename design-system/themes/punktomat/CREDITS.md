# Punktomat — credits

Everything under this directory ships with the `punktomat` theme and is served
by `/theme-assets/` only while `layout.yaml` names that theme.

## From the Punktomat design system

The household's own app (`mt3o-dev/Punktomat`, `src/lib/styles/tokens/` and
`src/lib/assets/`). Same authors, same family of apps — the layout schema
already describes K7 as sharing a design system with it.

| File | Source | Changes |
|---|---|---|
| `decor/cork.svg` | `src/lib/assets/cork-texture.svg` | two unused `<filter>` definitions removed |
| `decor/cork-dark.svg`, `cork-night.svg` | the same | recoloured for the dark and night modes Punktomat does not have |
| `decor/cobweb.svg` | `src/lib/assets/cobweb.svg` | Punktomat's CSS opacity (0.12) baked into the strokes |
| `decor/cobweb-dark.svg` | the same | strokes recoloured light for dark cork |
| `decor/coffee-stain.png` | `static/coffee stain.png` | Punktomat's CSS opacity (0.7) baked into the alpha, quantised to 64 colours (470 KB → 86 KB) |

Colours, radii and weights in `../punktomat.yaml` are taken from Punktomat's
tokens (`colors.css`, `radius.css`, `typography.css`); where a value was
changed to meet WCAG AA on this display, the YAML says so beside it.

## Font — SIL Open Font License 1.1

Nunito (The Nunito Project Authors), variable weight, latin and latin-ext
subsets as served by Google Fonts. Licence text: `fonts/OFL-Nunito.txt`.
