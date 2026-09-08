# Git workflow

Settled 2026-09-08. This is the binding `/gw-foundation` requires before any
change lifecycle can run: every worktree, headless run and archive commit acts on
these rules.

```yaml
host: github
account: mt3o                      # personal account
repo: mt3o/kitchen-terminal-k7
default_branch: main
model: branch-per-change
merge_strategy: merge-commit       # squash and rebase merging are OFF
```

## Branches

`main` is the only long-lived branch. Nothing is committed to it directly once the
repository is published; it moves only through merge commits from a PR.

One branch per unit of work, named after the thing it implements so the branch,
the folder and the graph scope all carry the same id:

| Branch | For | Pairs with |
|---|---|---|
| `change/<change-id>` | a change opened by `/gw-new` | `context/changes/<change-id>/` |
| `foundation/<slug>` | a foundation-document amendment | `context/foundation/` |
| `fix/<slug>` | a bug or regression under `/gw-fix` | its own change folder |

`/gw-new` opens the folder and the memory scope; the branch takes the same id.
Worktrees created by `EnterWorktree` land under `.claude/worktrees/` and are
gitignored.

## Pull requests

Every branch reaches `main` through a PR — including one-line changes, including
work done headlessly. The PR is where `/gw-review` runs: code review against the
plan, plus the memory human gate (disputed nodes, staleness queue, promotion
candidates).

The PR description names the change-id and links the plan. `/gw-track` keeps the
GitHub issue and the change folder in step.

## Merging

**Merge commit. No squash, no rebase merge.**

A change is a sequence of phases with a memory capture at each boundary, and the
per-phase commits are the readable record of that sequence. Squashing throws it
away and leaves a single commit whose message cannot honestly describe what the
phase boundaries decided; rebasing rewrites hashes that captured nodes and PR
comments already point at.

Configure the GitHub repository to match — *Allow merge commits* on, *Allow squash
merging* off, *Allow rebase merging* off — so the policy is enforced by the forge
and not by everyone remembering it.

Locally this is already set:

```
merge.ff = false     # integrating a branch always writes a merge commit
pull.ff  = only      # pulling main fast-forwards, never spuriously merges
```

## Commit messages

English, imperative, one concern per commit. A commit that closes a phase says
which phase. Agent-authored commits carry their `Co-Authored-By` trailer.

## The memory dump is protected from git's line merge

`context/memory-graph.dump` is marked `-merge` in `.gitattributes`. Git aligns
similar blocks and shows only their differing lines, so a three-way merge of the
dump can splice half of one node's entry onto half of another and produce a graph
that parses but is wrong. With `-merge`, a conflicting dump is left whole and
resolved deliberately.

> ⚠️ `CLAUDE.md` tells you to run `agentic-memory sync resolve` here. **That
> subcommand does not exist** in the installed CLI (`sync` accepts only `status`,
> `dump`, `restore`). Until it does: keep one side of the dump whole, run
> `agentic-memory sync restore` to rebuild the database from it, and re-capture
> whatever the discarded side held.

## Repository visibility

`HANDOFF.md` settles the repository as **public**. Nothing in the tree carries a
secret — Varlock keeps values out of the schema agents see, and the LAN topology
notes name no addresses — but publication is still a one-way door, so it is a
human's explicit act and never an agent's.

<!-- graph-workflow: captured 2026-09-08 into memory_goal 59472cdc.
       branch-per-change, PR, merge commit, no squash .. a17b142e-850e-4cdb-8d84-2689e75428a7
       the dump is -merge protected ................... 36e6377e-7d18-4de2-b827-8644f15bf56a
       supersedes the open-workflow issue ............. 8a963777-1d94-42ad-ae4b-8a2b08d0a686 (CONTRADICTED)
-->
