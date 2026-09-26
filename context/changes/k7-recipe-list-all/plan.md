# Plan — k7-recipe-list-all

memory_goal: e1febe2d-6274-476e-a75e-834508b52241
epic: k7-recipe-widget-upgrade (slice 5 of 8)

## Contract decision (the one that matters for slices 6-8)

`GET /api/recipes` (array of full recipes, `limit` default 50) **stays as it
is**. The chat card consumes it: `/plan` reads `?limit=40` titles, and the
ingredient chips read `?limit=1` ingredients (`K7Chat.svelte`). Changing its
shape would pull the chat into a recipes-widget epic.

The widget gets its own view of the same route: `GET /api/recipes?view=summary`
returns an envelope, `{ items: RecipeSummary[], total: number }`, where
`RecipeSummary = { id, title, tags, importedAt }`. The envelope is the one
contract break of this epic. Slice 6 adds `nextCursor`/`cursor`/`limit` to it,
slice 7 adds `q`, and slice 8 adds tag facets. Each of those is additive, which
is the "don't redo the endpoint contract twice" concern [node:f4be78b5] ordered
the slices around.

The alternative, a new path such as `/api/recipes/catalog`, was rejected. A
static segment under `/api/recipes/` shadows `GET /api/recipes/:id` for a recipe
whose slug equals that segment. `rejections` already has this problem (slice 3),
and adding more such names only makes it worse.

The listing logic lives in a new pure module `src/server/recipes/catalog.ts`
(`summarize`, `listCatalog(all, query)`), the same "pure, testable without
Fastify" convention as `rejection-log.ts`. Recipe routes have no `app.inject()`
coverage ([node:925056b0]), so the module is where the tests go.

## Phase 1 — server

- `RecipeRepository.list`: `limit: Infinity` means "all" in both adapters
  ([node:bf1d9409]). The file adapter already handles it via `slice`, and the
  Drizzle one skips `.limit()` when the value is not finite. The default stays
  50, so existing callers do not change.
- `catalog.ts`: `RecipeSummary`, `summarize(recipe)`,
  `listCatalog(recipes, { tag })` → `{ items, total }`, using the sort order
  `list` already uses (newest first, then id).
- Route: when `view === 'summary'`, call `recipes.list({ tag, limit: Infinity })`
  and pass the result to `listCatalog`.

Verify: `test/recipe-catalog.test.ts`; a persistence test that
`list({ limit: Infinity })` returns more than 50.

## Phase 2 — client (`K7Recipes.svelte`)

- The list is loaded from `?view=summary`. `items` are summaries, and the card
  meta shows `total`.
- `openDetail(summary)` switches to detail mode with a `wczytywanie` line and
  fetches `GET /api/recipes/:id`. A 404 or a network failure shows `[!]` with
  WSTECZ, never a stale partial.
- After ZAPISZ, the saved full recipe is still used as the detail (unchanged).
- `maxVisible` no longer caps anything. `layout.schema.yaml` keeps the key,
  because `additionalProperties: false` would reject existing layouts that set
  it, and marks it as unused (in Polish). The component still accepts the
  prop.
- Changelog entry.

Verify: `npm run typecheck`, `npm run lint`, `npm test`; manual run against
the dev server.
