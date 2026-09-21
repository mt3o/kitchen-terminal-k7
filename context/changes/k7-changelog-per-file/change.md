# k7-changelog-per-file

status: implemented
created: 2026-09-21
branch: claude/changelog-yaml-refactor-aa780b
memory_goal: UNAVAILABLE — agentic-memory unreachable this session (MCP server
  ENOENT on `agentic-memory-mcp`, `agentic-memory` CLI not on PATH); see
  memory-backlog.md.
design_surface: n/a — the popup's output is byte-identical (same JSON from
  `/api/changelog`, same rendered HTML).

## Goal

Stop same-day changelog entries from conflicting in git. `changelog.yaml` was
one newest-first list, so every change inserted its entry at the same spot,
right under `entries:`. Two branches landing on the same date therefore edited
the same lines, and every such merge conflicted.

## What changed

- `changelog.yaml` → `changelog/`, one file per entry, named
  `YYYY-MM-DD-NN-slug.yaml` (NN = that day's sequence number). The name alone
  orders the popup: newest date first, then highest NN first. Rules are in
  `changelog/README.md`.
- `src/server/changelog.ts` reads the directory. `shared/changelog.ts`'s
  `assembleChangelog` validates each file (name shape, fields, and the `date:`
  inside must match the date in the name) and sorts. The API shape and the
  client are unchanged.
- The 33 existing entries were split out verbatim. The migration asserted each
  file parses to the original entry. The loaded result deep-equals the old
  `/api/changelog` body, and the popup HTML is identical.
- CLAUDE.md's standing rule now names the directory.
- No changelog entry for this change: nothing the household sees changed.

## Rejected

- **Single file + `merge=union`**: pure same-spot insertions merge, but union
  keeps *both* sides of any edited line. Two branches rewording the same
  existing entry would silently yield a duplicated, still-parseable item. It is
  also a per-clone git setting that GitHub's merge button ignores.
- **Single file, append at the bottom (oldest first)**: two appends after the
  same last line still conflict.

## Verified

- Simulated two branches each adding a 2026-09-22 entry: old format →
  conflict; new format → clean merge, both entries shown (even with the same NN).
- `test/changelog.test.ts`: ordering, same-NN tie, name/date/field validation,
  a real-directory load, and a guard against `changelog.yaml` reappearing.
- `npm run check`.

## Heads-up for in-flight branches

A branch cut before this move that adds to `changelog.yaml` gets a
modify/delete conflict when it merges main. Resolve it by moving the new entry
into `changelog/` as its own file and deleting `changelog.yaml`. Keeping the
file fails `npm test`.
