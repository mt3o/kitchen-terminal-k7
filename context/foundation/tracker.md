# Tracker binding

Consumed by `/gw-track`. Settled 2026-09-08.

```yaml
tracker: github
account: mt3o                    # personal account
repo: mt3o/kitchen-terminal-k7
issues: github-issues
states: [open, closed]           # plain Issues, no Projects board yet
close_authority: human
```

## What this means for the lifecycle

- `/gw-new` adopts an existing issue into the change, or opens one for it, and
  writes the issue number into `context/changes/<change-id>/change.md`.
- Phase progress and status are pushed at the lifecycle gates; acceptance criteria
  are pulled back from the issue.
- **Only a human closes an issue.** The workflow may move it, comment on it and
  report divergence, but the close is a human act.
- Divergence between the issue and the change folder is reported as a finding, not
  silently overwritten in either direction.

## Where knowledge does *not* go

A decision recorded only in an issue comment is a decision no future recall will
serve. Knowledge goes in the graph; the issue gets a pointer at most.

## Status — live

`https://github.com/mt3o/kitchen-terminal-k7` — public, created 2026-09-08.

Enforced on the forge, not by memory:

- *Allow merge commits* on; *squash* and *rebase merging* off.
- Ruleset **`main: branch-per-change via PR`** (active) on the default branch:
  pull request required, `merge` the only permitted method, no force-push, no
  deletion. Required approvals: 0 — the gate is that work arrives through a PR
  where `/gw-review` runs, not that a second person exists to approve it.
- Head branches are deleted on merge; the change folder and the graph scope
  outlive them.

`/gw-track` has a board to bind to. Issues are plain GitHub Issues; there is no
Projects board, so `states:` is just `open` / `closed`.

<!-- graph-workflow: captured 2026-09-08 into memory_goal 59472cdc.
       GitHub Issues on mt3o/kitchen-terminal-k7 ... d44ca6f2-aba3-4b52-99ba-cebf2695b4de
       depends on the branch/PR/merge policy ....... a17b142e-850e-4cdb-8d84-2689e75428a7
-->
