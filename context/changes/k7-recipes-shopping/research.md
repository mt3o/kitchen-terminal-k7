# Research — k7-recipes-shopping

## Questions and answers

**1. Shopping-list backend — is DELETE really missing?**
Yes. `src/server/index.ts:199-222` has GET `/api/shopping-list`, POST
`/api/shopping-list`, PATCH `/api/shopping-list/:id`. No DELETE route. The port
(`src/server/ports/repositories.ts` `ShoppingListRepository.delete`) and the
Drizzle adapter (`src/server/adapters/drizzle/index.ts:117-119`) already
implement `delete(id)` — it's just never wired to HTTP. Not covered by
`test/persistence.test.ts`'s `ShoppingListRepository` block either (only the
recipes delete path is tested there).

**2. K7ShoppingList.svelte conventions** (`src/client/lib/K7ShoppingList.svelte`)
- Custom element `k7-shopping-list`, props `groupByCategory`/`showCheckedItems` (string-reflected booleans).
- Server-confirmed only: `toggle()` PATCHes then replaces the item from the server response (`items = items.map(...)`), never flips local state first.
- `add`/`toggle` both use `fetch` + try/catch, set a `failed` flag rather than throwing to the UI; card `state` derives from `failed`/`loading`.
- Row click toggles; there is no delete affordance at all yet.
- Styling is 100% `var(--*)` tokens, Polish copy (`LISTA.ZAKUPY`, `nowa pozycja`, `kategoria`, `+ DODAJ`, `wczytywanie`, `lista pusta`).
- No `.stories.ts` sibling exists yet for this component (see item 5).

**3. Recipes domain/schema/port/adapter — already fully built.**
- `src/server/domain/types.ts:10-18` — `Recipe { id, title, sourceUrl, ingredients: string[], steps: string[], tags: string[], importedAt: Date }`.
- `src/server/db/schema.ts:19-29` — `recipes` table, JSON columns for `ingredients`/`steps`/`tags`.
- `src/server/ports/repositories.ts` — `RecipeRepository { list(tag?/limit?), get(id), save(recipe), delete(id) }`.
- `src/server/adapters/drizzle/index.ts` — full implementation of all four, including `onConflictDoUpdate` on `save`.
- `test/persistence.test.ts:31-53` already exercises save/get/list-by-tag/delete, round-tripping JSON columns and Polish diacritics.
- **Nothing missing at the storage layer.** Faza 3's real gap is HTTP + extraction + UI. Captured as `[node:2135f0a4]`.

**4. layout.yaml `recipes` card / schema**
`layout.yaml:67-71`:
```yaml
- id: przepisy
  type: recipes
  params:
    maxVisible: 6
    allowUrlImport: true
```
`docs/handoff/layout.schema.yaml:271-283` (`params.recipes`): `maxVisible: integer default 6`, `allowUrlImport: boolean default true`, `tags: string[]` (optional filter, empty = all).

**5. Reference component pattern — K7Weather.svelte**
No `.stories.ts` exists yet for K7Weather or K7ShoppingList — the only existing story is `src/client/lib/K7Card.stories.ts` (the generic shell, web-components renderer, imports the `.svelte` module solely to register the custom element). K7Weather shows the idle/ok/warn/fail derivation, an `ageLabel`/staleness banner, `$effect` for polling with `AbortController` cleanup, and a "no placeholder data" idle message (`odczyt`) rather than fake numbers. K7Recipes.svelte and its `.stories.ts` will follow the `K7Card.stories.ts` pattern (web-components renderer, explicit `import './K7Recipes.svelte'` to register the element) since there is no more specific precedent.

**6. Route registration structure**
`src/server/index.ts` is one flat file: config → observability → DB/migrations/repos → freshness service → TLS → Fastify instance → `loadLayout` helper → `/theme.css` → `/api/health` → `/api/layout` → private-network/Host guard hook → `/api/weather` → shopping-list routes (197-222) → error handler → static/,notFound → listen. All routes just call `repos.*` methods inline in the handler; **no exported `buildApp`/`createServer` factory** — the whole module is side-effecting at import time (captured as `[node:2c5e94f2]`). New recipe routes should be added additively right after the shopping-list block (~line 222), same shape (`app.get/post/patch/delete('/api/recipes...', async (req, reply) => {...})`), to keep the diff a clean insertion for sibling Faza 4/5 branches that also touch this file.

**7. package.json**
No `jsdom`, `@mozilla/readability`, `cheerio`, `node-fetch`, or `undici` present. `engines.node: ">=24"`; global `fetch`/`AbortController` already used (`freshness.ts`, `open-meteo.ts`). Confirmed `@mozilla/readability@0.6.0` and `jsdom@30.0.1` resolve on the npm registry — both needed as new backend-only `dependencies` (never bundled to the client/iPad, so the Safari 15 floor doesn't apply to them).

**8. .env.schema**
No existing var relevant to recipe import (no timeout/user-agent knob). No new secret is needed — recipe import is an outbound fetch of a public page, not an authenticated API. Decided not to add new env vars; a fetch timeout is hardcoded via the existing `fetchWithTimeout` helper (`src/server/upstream/freshness.ts`), same as weather.

**9. Tests**
`node --test test/*.test.ts`. Two established patterns: (a) repository-level tests spin up `openDatabase(':memory:')` + `runMigrations` + `createRepositories`, assert against the port (`persistence.test.ts`); (b) pure-logic modules are tested directly with an injected fetcher/clock, no HTTP involved (`freshness.test.ts` against `createFreshnessService`). There is **no Fastify `app.inject` test anywhere** — captured as `[node:2c5e94f2]`. The recipe extraction logic (JSON-LD parse + Readability fallback) will be built as its own pure, directly-testable module under `src/server/recipes/`, following pattern (b); the HTTP route handlers stay thin and untested, consistent with the rest of the file.

**10. Migrations**
`drizzle/0000_nebulous_lizard.sql` and `drizzle/0001_productive_spencer_smythe.sql` already exist and the `recipes` table is already part of the migrated schema (confirmed via `test/persistence.test.ts`'s `migrations` describe block asserting `repos.recipes.list()` works against a fresh in-memory DB). **No new migration needed** for this change — no schema changes at all.

**11. PLAN.md `### Faza 3` verbatim** (`docs/handoff/PLAN.md:104-109`):
```
### Faza 3 — przepisy i lista zakupów
- [ ] Parser `schema.org/Recipe` (JSON-LD) z URL — Sonnet
- [ ] Fallback heurystyczny (Readability.js + wykrywanie listy składników) — Opus
- [ ] Endpoint `POST /recipes/import` + ekran potwierdzenia importu — Sonnet
- [ ] CRUD listy zakupów (backend + prosty UI) — Haiku
```
Mismatches found: (a) the bare `/recipes/import` path doesn't match the project's `/api/*` convention — resolved as a deliberate deviation from the literal doc, captured `[node:faf594c8]`; (b) "CRUD listy zakupów" reads as if shopping-list CRUD were entirely unbuilt, but 3 of 4 verbs (list/add/toggle) already ship — only DELETE is missing; (c) recipes storage (list/get/save/delete + schema + migration) is **already done**, which PLAN.md's checkboxes don't reflect at all — none of the four boxes name it. This matches the outer task's own warning that PLAN.md's checkboxes are stale.

**12. HANDOFF.md**
`docs/handoff/HANDOFF.md:39`: `| Przepisy | zdecydowane | import przez URL, ekstrakcja (schema.org/Recipe + fallback) |` — confirms the decision but names no library or endpoint shape beyond what PLAN.md already said. No mention of shopping-list DELETE or a review-UI design.

## Captured nodes
- `[node:2135f0a4-e132-48e6-917f-2284e5a88662]` concept — recipe storage stack already fully built and tested.
- `[node:faf594c8-d42b-4068-96f6-bd211eecee0a]` decision — new recipe routes live under `/api/*`, not the bare path PLAN.md wrote.
- `[node:2c5e94f2-dcab-4edc-a5b3-a2a5ee098c51]` constraint — no Fastify test harness / buildApp factory exists; testable logic goes in its own pure module.

## Not otherwise answered by recall
Recall surfaced the `Recipe` entity, `ShoppingListItem` entity, the zakupy-api-out-of-scope issue, theming/token-contract constraints, Safari 15 floor, and the "no placeholder data as real" constraint — all directly relevant and used below. It did not (and could not) answer anything about current file contents; that's exactly the gap this session's direct exploration filled.
