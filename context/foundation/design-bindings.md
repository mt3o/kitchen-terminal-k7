# Design-system bindings

Which graph node carries which rule of the design system, and a fingerprint of the
source text so a drift finding can name the drifted thing instead of saying
"something in DESIGN.md moved".

This table lives **here and not in DESIGN.md**: a footer inside a file a design
tool regenerates is guaranteed to be destroyed eventually.

`fingerprint` = first 12 hex of `sha256` of that section's body text, taken
2026-09-08, refreshed the same day after the Source Code Pro settlement moved §4.1, §4.2 and the open-questions list. The rule *text* is fingerprinted, never the token values, so a
repalette does not read as a changed rule.

## Where the package lives

`design-system/` in this repository is the source of truth:

```
design-system/
  DESIGN.md  USAGE.md  manifest.json
  tokens.css  design-tokens.json  tailwind-v4.css
  theme.schema.v2.yaml
  themes/retro-scifi.yaml  themes/daylight-lab.yaml
  kitchen-terminal-k7-kit.html   index.html
```

The OpenDesign project `kitchen-terminal-k7-design-system` is a **byte-identical
mirror**, flat at its project root, kept as the working and preview surface:

```
~/Applications/opendesign/open-design/.od/projects/kitchen-terminal-k7-design-system/
```

Syncing is a plain copy in either direction — `cp -r design-system/. <od-dir>/`
to push, the reverse to pull — and `diff -r` between them is the check. Edit in
whichever surface suits the task, then sync and commit; a divergence that is not
reconciled before a commit is what puts the graph out of step with the files.

Fingerprints below are taken from the **repository** copy.

> Whether the v2 theme schema is *adopted* — replacing `docs/handoff/theme.schema.yaml`
> and `docs/handoff/themes/retro-scifi.yaml` as the contract the Faza 1 loader
> validates against — is still open (`SCHEMAV2ADOPT`). Giving the package a home
> did not decide it; both versions are tracked and neither has been retired.

## Bindings

| DESIGN.md section | fingerprint | Node | Key |
|---|---|---|---|
| 2. The rule that governs everything else | `2a1045ad2f7a` | `dffe0843` | `AMBERINK` |
| 2. The rule that governs everything else | `2a1045ad2f7a` | `a827e6ec` | `ONESOLID` |
| 2. The rule that governs everything else | `2a1045ad2f7a` | `ff852de4` | `WARNNOTAMBER` |
| 2. The rule that governs everything else | `2a1045ad2f7a` | `9b0e63ee` | `BRACKETGLYPH` |
| 3.1 How the palette was built | `c368d2bc2a7f` | `cabf56d2` | `OKLCHHEX` |
| 3.4 Night mode — new | `5522ead4e8f4` | `6eef8943` | `NIGHTSCHED` |
| 3.5 Contrast floors | `21f237313c6b` | `6d6046fc` | `CONTRASTFLOORS` |
| 4.1 One family | `a778cec78bb7` | `75d638bb` | `SOURCECODE` |
| 4.1 One family — superseded | `d8616421f20b` | `ee768ade` | `PLEXMONO` ⚠ CONTRADICTED |
| 4.2 Two tiers, set by viewing distance | `276ee73e9665` | `7108856c` | `DISTANCES` |
| 5. Spacing, shape, elevation | `7b7dd45117a6` | `61c0030d` | `RADIUSZERO` |
| 7. Interaction states | `854fa91481c2` | `aef51033` | `HOVERCONTRAST` |
| 9. Motion + 11. Safari 15 budget | `782e011eb415` / `eafccdb0fec1` | `716987ce` | `A8X` |
| 10. Theming contract | `8a884c2a9b09` | `79662ce5` | `TOKENCONTRACT` |
| 10. Theming contract | `8a884c2a9b09` | `012f356c` | `SCHEMAV2` |
| 11. Safari 15 budget | `eafccdb0fec1` | `0bc7e618` | `SAFARI15` |
| Open questions | `579b1e1a90c4` | `f42da1a9` | `SCHEMAV2ADOPT` |
| Open questions | `579b1e1a90c4` | `156d8b7d` | `DENSITY` |

## Not distilled, deliberately

`§3.2`/`§3.3` (per-role hex tables), `§4.3`/`§4.4` (label and figure
conventions), `§6` (breakpoint table), `§8` (component roster), `§13` (voice).
These are values and rosters, not claims you can disagree with — they belong in the
files and in the component kit, which `USAGE.md` names as normative when prose and
kit disagree. Capturing them would fill recall with restated obviousness.

<!--   design-system home + OD mirror ........ a1d42a8e-6fb1-493c-b5ef-003288aa28f2 -->
