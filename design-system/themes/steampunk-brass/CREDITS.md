# Steampunk Brass — credits

Everything under this directory ships with the `steampunk-brass` theme and is
served by `/theme-assets/` only while `layout.yaml` names that theme.

## Photographs — Unsplash License (free to use, no attribution required; given anyway)

| File | Photo | Photographer | Changes |
|---|---|---|---|
| `images/clockwork.jpg` | [a close up of a clock with gears attached to it](https://unsplash.com/photos/KORGgJI1odA) | Peter Bryan | cropped 4:3, desaturated 15 %, darkened to 55 %, vignetted |
| `images/gauges.jpg` | [black and white analog gauge](https://unsplash.com/photos/8JSkpssuPxk) | ahmet hamdi | dark set¹ |
| `images/locomotive.jpg` | [a close up of the wheels of a train](https://unsplash.com/photos/dkt3FhN3utQ) | ダモ リ (darmau) | dark set¹ |
| `images/gold-gears.jpg` | [brown and black round decor](https://unsplash.com/photos/MiSPnHknw4w) | Lucas Santos | dark set¹ |
| `images/brass-gears.jpg` | [gold and silver round accessory](https://unsplash.com/photos/UQ2Fw_9oApU) | Laura Ockel | dark set¹ |
| `images/lone-gear.jpg` | [brown sprocket with bearing and metal rod](https://unsplash.com/photos/2nZDK0_73EY) | Tim Mossholder | dark set¹ |
| `images/parchment.jpg` | [a piece of paper with a brown background](https://unsplash.com/photos/Ng5onpi5iRQ) | Pixelbuddha Studio | cropped 4:3, resized |
| `images/map-1880.jpg` | ["The World", 1880](https://unsplash.com/photos/spd6JPAhLR4) | The New York Public Library | light set² |
| `images/map-hemispheres.jpg` | ["Map of the world", 1701](https://unsplash.com/photos/ZePawKjBisA) | The New York Public Library | light set² |
| `images/map-old-world.jpg` | ["The Old World", 1798–1804](https://unsplash.com/photos/w01lVL0VU-Q) | The New York Public Library | light set² |
| `images/map-mountains.jpg` | [antique map of a mountainous landscape with a river](https://unsplash.com/photos/b9xBaA4ZDbs) | Valleluce | light set² |
| `images/compass-paper.jpg` | [aged paper with stains and circular scribbles](https://unsplash.com/photos/fGuoiKlHJHs) (Romanino, *Concentric Circles*, verso) | The Cleveland Museum of Art | light set² |
| `images/paper.jpg` | [an old piece of paper with torn edges](https://unsplash.com/photos/ICLgWINOp_A) | Plufow Le Studio | cropped inside the torn edges, contrast lowered, lifted toward cream so every light-mode foreground keeps AA on its darkest 0.5 % |

¹ Dark set: cropped 4:3 at 1600×1200, desaturated 15 %, warmed toward brass,
brightness bisected until the 95th-percentile luminance is 0.17 (the level of
`clockwork.jpg`), vignetted.
² Light set: cropped 4:3 at 1280×960 inside the scan margins, converted to
greyscale and re-inked on one sepia ramp (`#684e32` → `#cdb48c`), softened
0.6 px, so differently printed maps read as one family.

License: <https://unsplash.com/license>

## Fonts — SIL Open Font License 1.1

The latin and latin-ext subsets as served by Google Fonts, unmodified beyond
that subsetting. Licence texts are alongside the files in `fonts/`.

| Family | Files | Copyright |
|---|---|---|
| Old Standard TT | `fonts/old-standard-tt-*` | The Old Standard Project Authors |
| Petit Formal Script | `fonts/petit-formal-script-*` | Pablo Impallari, Brenda Gallo, Rodrigo Fuenzalida (Reserved Font Name "Petit Formal Script") |
| Courier Prime | `fonts/courier-prime-*` | The Courier Prime Project Authors |

## Ornaments — this project

`ornaments/frame.svg`, `frame-night.svg`, `rule.svg`, `rule-night.svg` and
`gear.svg` were drawn for this theme and carry the project's own licence.
