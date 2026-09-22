# Memory backlog — k7-hellforge-theme

Degraded mode per CLAUDE.md. `.mcp.json` starts the memory server through
`sh -c`, and this session runs on Windows (PowerShell); the `agentic-memory`
CLI is not on PATH here either, so neither transport reaches the store. Queued
for replay from a machine that has it.

## Would-be create_change
- change_id: k7-hellforge-theme; parent: foundation goal
  59472cdc-4531-4206-a9fc-968166c52250; siblings: k7-steampunk-theme,
  k7-punktomat-theme.

## Would-be captures (ABOUT the `Theme` entity)

1. **Invariant (confirmed, not new)** — A new theme now costs no component
   change: hellforge fills `fontFaces`, `display`, `colors.cardBorder`,
   `header` and `ornament` and touched no `.svelte`/`.css` file. The two
   earlier decorated themes each had to extend the contract; this one did not,
   which is the first evidence the slots generalise rather than fit their
   original theme. Facets: theming, architecture.

2. **Issue (fixed here)** — `header.background` did not pass through
   `resolveAssets`, so `asset("…")` in a band reached the browser raw and the
   file was missing from `themeAssetPaths`' allowlist. Every other raw-CSS slot
   resolved it; the band was added later and missed both. Fixed in
   theme/generate.ts. Lesson worth keeping: any new raw-CSS slot must be added
   to *both* the resolver and the allowlist collector, or it fails only for
   themes that use a file there. Facets: theming, bug, contract.

3. **Decision** — Text contrast for decorated themes is measured on the pixels
   the glyphs cover (render, re-render with all colour transparent, diff), not
   on the element's bounding box. The box method produced false failures
   wherever a coloured bar, border or event tick sat inside the box (1.5:1
   readings for text that is plainly legible), and would have hidden the two
   real failures among them. Facets: accessibility, tooling, theming.

4. **Constraint** — A `border-image` rule under a card title needs its outset
   set so the image's top edge clears the glyphs: at outset 9px the blood bar's
   bevel line ran through the descenders and dropped the title to 1.9-2.9:1.
   16px clears it. Applies to any theme that puts an image under that divider.
   Facets: theming, accessibility.

## Would-be journal events
- USED: the backdrop rotation, header band, cardBorder and ornament slots from
  k7-steampunk-theme and k7-punktomat-theme — all three reused unchanged.
- CONFIRMED: TOKENCONTRACT — a fifth theme, no component naming a value.
- NOTED: `scripts/build-tokens.mjs --check` cannot run on Windows (it imports a
  bare absolute path; ESM needs a file:// URL) and reports drift for a
  CRLF checkout even when the content matches. Not fixed here.
- NOTED: `better-sqlite3` builds on neither Windows (no MSVC) nor this WSL (no
  `make`, sudo needs a password), so `npm run check` cannot run on this
  machine; theme work was verified against a scratchpad mock backend instead.
