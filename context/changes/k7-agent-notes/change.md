# k7-agent-notes

status: implemented
created: 2026-09-22
branch: claude/hellforge-theme (landed with the theme it is drawn from)
memory_goal: UNAVAILABLE — store unreachable from this machine, see
  ../k7-hellforge-theme/memory-backlog.md (same session).
design_surface: n/a — documentation and two dev scripts.

## Goal

Write down what three theme-building sessions learned, so the next agent does
not re-learn it: environment traps, logic that does not read the way it
behaves, reusable tooling, and an honest list of the parts that are hard.

## What landed

- `docs/agent-notes.md` — what runs where (Node 24, the native SQLite build,
  `python3`, `grep`), shadow-DOM traps, the "cards fit their cells" rule and
  its silent failure mode, things that behave unlike they read, the tools, the
  verification habits that paid off, and the four areas that are genuinely hard
  to read.
- `design-system/themes/README.md` — how to build a theme: slot table, recipe,
  verification commands, and every pitfall already hit.
- `scripts/theme-preview.mjs` — the real built client with canned data and no
  backend. Promoted from a scratchpad file used in the last three theme
  changes; its `CANNED` map doubles as the list of endpoints the cards call.
- `scripts/theme-contrast.mjs` — contrast on the pixels glyphs cover, per mode
  / page / backdrop, non-zero exit below 4.5:1.
- `scripts/build-tokens.mjs` — two cross-platform fixes: import via
  `pathToFileURL` (ESM rejects a bare Windows absolute path, so the script
  could not run there at all) and compare ignoring line endings (a CRLF
  checkout reported drift for byte-identical content).
- `CLAUDE.md` — two rows pointing at the notes.

## Deliberately not done

- No changelog entry: nothing here changes what the household sees.
- The scripts are dev tools, not part of `npm run check`: `theme-contrast.mjs`
  needs a browser and `playwright-core`, which is not a project dependency.
  They print how to install it rather than adding weight to CI.

## Verified

- `node scripts/build-tokens.mjs --check` now passes on Windows (it previously
  could not start) and still detects real drift.
- `node scripts/theme-preview.mjs` serves the catalogue and the generated sheet;
  `node scripts/theme-contrast.mjs hellforge --modes dark --backdrops 1
  --pages 0` reports and exits 0.
- Every factual claim in the notes was checked against the code before writing
  it (file existence, the `.page [hidden]` rule, line counts, which widgets
  scroll internally, the PR number for the clipping fix).
