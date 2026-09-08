# k7-persistence

```yaml
change_id: k7-persistence
memory_goal: 3a29eee2-0cb0-4688-8e53-92c9a2b0c08e
change_anchor: 226722c6-5c0e-4215-b069-2dc8f7012cc4
parent:
  - 3d1ec55c-f161-4684-a999-5d485a0e6bf8   # k7-secrets-and-errors
  - 59472cdc-4531-4206-a9fc-968166c52250   # foundation
epic: faza-0
slice: 3
mode: interactive
tracker: github
branch: change/k7-persistence
```

## The decision this slice was waiting on

**Drizzle**, ruled by the owner. `PLAN.md` had held it open for Opus with three
candidates; Kysely is the one worth naming as passed over — equally good typing,
less machinery, but no migration story of its own, and migrations were half of
what this layer had to deliver.

## What this delivers

```
src/server/domain/types.ts       the records, in the project's own vocabulary
src/server/ports/repositories.ts the interfaces the core talks to
src/server/db/schema.ts          five tables, Drizzle
src/server/db/migrate.ts         migrations applied at boot, from Node
src/server/adapters/drizzle/     the only file that knows both sides
drizzle/0000_*.sql               the generated migration
```

The layering is the point: `domain/` mentions no column and no driver, `ports/`
mentions no Drizzle type, and the adapter is the single place that knows both.
The claim that SQLite is swappable stays testable rather than aspirational —
**the persistence tests are written against the ports**, so every one of them
would still hold against a different adapter.

Three shopping-list endpoints cut the slice through to HTTP, so this is a tracer
bullet rather than a layer.

## Where the domain model earned its keep

`AiCall`'s definition — *"not a Message: one Message may cost several, and
compacting spends them with no Message at all"* — is why both its foreign keys
are nullable and delete with `set null`, while `messages` cascades. Deleting a
thread must leave the cost history standing, orphaned but intact, because the
cost view answers what the household spent and not which threads still exist.
That distinction came out of `/gw-domain`, not out of writing SQL.

## Two pragmas that are not defaults

`journal_mode = WAL` — the kiosk reads on a timer while the backend writes, and
under the default rollback journal every read waits behind a write, visible on
the wall as a stutter.

`foreign_keys = ON` — off per connection unless asked, which makes a schema full
of cascades decorative. There is a test that asserts a foreign-key *violation*
specifically so a future connection helper that forgets the pragma fails the
build instead of silently discarding referential integrity.

## Verified

| | |
|---|---|
| `npm run check` | exit 0 |
| Tests | **18/18** (9 new, against the ports) |
| Migration generated | 5 tables, 3 indexes, 3 FKs |
| Live: POST / PATCH / GET / filter / 400 / 404 | all correct |
| SQLite on disk with WAL | yes; `data/` gitignored |

## Not done

- Only the shopping list is wired to HTTP. Recipes, conversations and cost
  reporting have ports and adapters but no routes — their cards are not built yet.
- **No `down` migrations.** drizzle-kit generates forward-only SQL; rolling back
  means a new migration. Worth knowing before someone needs it at 22:00.
- `zakupy-api` remains unavailable, so `dataSource.mode: local` is still the only
  working option — unchanged by this slice.
