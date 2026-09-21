# changelog/ — the user-facing changelog, one file per entry

CLAUDE.md's standing constraints require every user-facing change to add an
entry here, with a date, in the same change that makes it. The dashboard's
changelog popup in the header ("DZIENNIK ZMIAN") reads this directory (served
via `GET /api/changelog`), so an entry that lands later than the change it
describes is one the household never actually saw associated with what changed.

## Adding an entry

Add **one new file**. Never edit another entry to make room, and never renumber
existing files.

```
changelog/2026-09-21-07-short-slug.yaml
          └ date ──┘ NN └ slug ──┘
```

- **date:** the day the change lands, `YYYY-MM-DD`. It must equal the `date:`
  inside the file.
- **NN:** two digits, that day's sequence number. Take the highest number
  already used for that date and add one, or `01` for the first entry of the day.
- **slug:** lowercase ASCII words joined by `-`, e.g. the title with Polish
  letters folded (`ł` → `l`, `ó` → `o`).

```yaml
date: "2026-09-21"
title: "Krótki tytuł zmiany, po polsku"
items:
  - "Co domownik zobaczy inaczej — jedno zdanie na punkt."
```

The popup shows entries newest first: by date, then by `NN` descending. The
file name alone decides the order.

## Why one file per entry

Entries used to live in a single `changelog.yaml`, newest first. Every change
inserted its entry at the same spot, right under `entries:`. Two branches
adding an entry on the same day therefore changed the same lines, and git
reported a conflict on every such merge.

Separate files cannot conflict: two branches add two different paths. If both
branches happen to pick the same `NN` for a day, both entries still show, with
the slug breaking the tie. Renumber one only if the order matters.

A malformed file fails `npm test` (`test/changelog.test.ts` loads this
directory). It also makes `/api/changelog` return 500, which shows as an error
in the popup, so CI catches it before the household would. The same test also
fails if a root `changelog.yaml` reappears, for example from resolving a merge
conflict with a branch cut before this move.
