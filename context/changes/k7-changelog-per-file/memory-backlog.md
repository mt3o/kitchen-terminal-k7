# Memory backlog — k7-changelog-per-file

Degraded mode per CLAUDE.md: `agentic-memory-mcp` ENOENT and the
`agentic-memory` CLI is not on PATH, so the store is unreachable by both
transports. No recall ran this session. Queued for replay.

## Would-be create_change
- change_id: k7-changelog-per-file; parent: foundation goal
  59472cdc-4531-4206-a9fc-968166c52250; related: k7-refresh-changelog
  (goal 720f132e-d35a-4f3c-aa4d-d3a81a6c0ac4), which set the
  entry-per-change rule this change keeps.

## Would-be captures

No domain entity covers the changelog (`domain_model()` unreachable; the
extracted corpus in `context/changes/domain-model/` does not name it), so no
ABOUT edge. Not proposing one: the term is not new, only its storage.

1. **Decision** — The user-facing changelog is one YAML file per entry in
   `changelog/`, named `YYYY-MM-DD-NN-slug.yaml`, and the file name alone orders
   the popup. This replaces one newest-first `changelog.yaml`, where every
   same-day entry was inserted under `entries:` and so conflicted in git.
   Rejected: single file + `merge=union` (keeps both sides of an edited line,
   giving a silent duplicate item; per-clone setting that GitHub's merge
   ignores). Rejected: append-at-bottom (two appends after the same last line
   still conflict). Facets: tooling, workflow. DERIVED_FROM: the k7-refresh-changelog
   rule that every user-facing change adds a dated entry in the same change.

## Would-be journal events
- NOTED: k7-refresh-changelog's rule is unchanged in substance; only where an
  entry is written moved (CLAUDE.md updated in this change).
