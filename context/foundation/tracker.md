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

## Status

The repository does not exist on GitHub yet — see `git-workflow.md`. Until it is
created and pushed, `/gw-track` has a binding but no board, and the lifecycle runs
files-only for work state.
