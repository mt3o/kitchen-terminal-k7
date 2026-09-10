# Plan — k7-recipes-shopping

memory_goal: 7aa1c37e-f2a8-44ad-9331-4e9029002f70

## Grounding

- Recipe storage (domain type, schema, port, Drizzle adapter, migration, tests)
  is already complete — `[node:2135f0a4]`. This plan builds HTTP + extraction +
  UI only.
- Shopping-list storage is complete including `delete`; only the DELETE route
  and its UI affordance are missing.
- New routes go under `/api/*`, not the bare `/recipes/import` PLAN.md wrote —
  `[node:faf594c8]`.
- No Fastify test harness exists (`index.ts` is a side-effecting bootstrap, no
  `buildApp`) — `[node:2c5e94f2]`. Extraction logic is built as its own pure,
  directly-testable module; route handlers stay thin, additive insertions right
  after the existing shopping-list block, to minimise merge risk against the
  Faza 4/5 sibling branches editing the same file.
- Theming is tokens-only (`[node:79662ce5]`), no placeholder-as-real data
  (`[node:4a749051]`), Safari 15 floor applies to `K7Recipes.svelte` and its
  bundle only — the new backend deps (`jsdom`, `@mozilla/readability`) never
  reach the client (`[node:0bc7e618]`).
- Zakupy-api shopping-list mode stays out of scope (`[node:6d5ae12d]`).

## Non-goals

- `shoppingList.dataSource.mode: 'zakupy-api'` — explicitly blocked, local mode
  only.
- No new database migration — the `recipes` and `shopping_list` tables already
  support everything this change needs.
- No dedicated modal/dialog primitive — the review-before-save flow is an
  in-card expanded state (Card shell reused), not a new design-system
  component. This is a scope call made without a `/gw-wireframe` pass since
  this change runs unattended; flagged in the PR for a human to revisit if the
  in-card pattern doesn't read well on the device.
- No SSRF-hardening beyond a basic scheme + private-address check on the
  import URL — full DNS-rebinding protection for outbound fetches is a bigger
  security piece flagged for human follow-up, not built here.

## Phases

### Phase 1 — Recipe extraction module (pure, tested)

Files:
- `src/server/recipes/extract.ts` (new) — `extractJsonLd(html, sourceUrl): Recipe | undefined`
  (parses `<script type="application/ld+json">` via `jsdom`, walks `@graph`/array
  shapes, maps schema.org `Recipe` fields — `name`→title, `recipeIngredient`→ingredients,
  `recipeInstructions` (string[] or `HowToStep[]`)→steps, `keywords`/`recipeCategory`→tags)
  and `extractFallback(html, sourceUrl): Recipe | undefined` (Readability via
  `@mozilla/readability` + `jsdom` for the article body, then a heuristic pass
  over the extracted text/lists to find an ingredients block and a steps block —
  kept as a genuinely distinct strategy from the JSON-LD path per the task's
  explicit "don't silently guess-mix them" instruction, not a shared helper that
  blurs the two).
- `src/server/recipes/import.ts` (new) — `importRecipeFromUrl(url, { fetcher? }): Promise<Recipe>`
  orchestrates: validate URL (http/https only, reject private/loopback hosts per
  `isPrivateAddress` reused from `security/network.ts` — the address the *server*
  is about to fetch, not the client's), fetch via `fetchWithTimeout` (reuse from
  `upstream/freshness.ts`), try `extractJsonLd` first, fall back to
  `extractFallback`, throw a typed error if neither yields at least a title.
  Returns a `Recipe`-shaped object with `id: ''` (unsaved) so the route/UI can
  review before persisting.
- `package.json` — add `jsdom` and `@mozilla/readability` to `dependencies`
  (backend-only; additive, one-line diff to minimise sibling-branch conflicts).
- `test/recipes-extract.test.ts` (new) — fixtures: one HTML string with a
  schema.org `Recipe` JSON-LD block (including a `HowToStep[]` instructions
  shape, since that's common and different from a bare string array), one HTML
  string with no JSON-LD but an article body and a plausible ingredients list,
  one HTML string with neither (asserts `undefined`/throw). Tests call
  `extractJsonLd`/`extractFallback` directly — no network.

Verify: `node --test test/recipes-extract.test.ts` green.

### Phase 2 — Recipe HTTP routes

Files:
- `src/server/index.ts` — insert after the shopping-list block (~line 222):
  - `GET /api/recipes` — `repos.recipes.list({ tag, limit })` from query params.
  - `GET /api/recipes/:id` — `repos.recipes.get(id)`, 404 if missing.
  - `POST /api/recipes/import` — body `{ url: string }`, calls
    `importRecipeFromUrl`, returns the **unsaved** extracted `Recipe` (200) or a
    400/502 with a plain-language reason on failure (extraction failed, both
    strategies came up empty, fetch timed out, URL rejected). Does **not**
    write to the database — this is the "review before save" contract from the
    task: the import step only extracts.
  - `POST /api/recipes` — body is the (possibly user-edited) `Recipe` fields,
    calls `repos.recipes.save(...)`. This is the confirm step the review UI
    calls after the household edits/approves what was extracted. Also the
    manual "type a recipe in by hand" path (`sourceUrl: null`), which the
    domain entity already allows.
  - `DELETE /api/recipes/:id` — `repos.recipes.delete(id)`, 204/404.
- `test/persistence.test.ts` — no change needed (repo layer already covered);
  route-level behaviour is exercised through Phase 1's pure module tests plus
  manual Storybook/story-level checks per this repo's established convention
  (`[node:2c5e94f2]` — no route test harness exists, and building one is out of
  this change's scope).

Verify: `npm run typecheck` passes; manual `curl` smoke test against
`npm run dev:server` for `/api/recipes/import` with a real recipe URL and a
bogus one.

### Phase 3 — Shopping-list DELETE

Files:
- `src/server/index.ts` — add `DELETE /api/shopping-list/:id` right after the
  existing PATCH route (~line 222): `repos.shoppingList.delete(id)`, 204/404.
- `test/persistence.test.ts` — add one `it` to the existing `ShoppingListRepository`
  describe block asserting `delete` returns `true` once and `false` on a repeat
  (mirrors the recipes delete test already there at lines 47-53), since that
  repo method exists but was never actually asserted.
- `src/client/lib/K7ShoppingList.svelte` — add a delete affordance per item
  (a small "×" ghost button next to each row, not a swipe gesture — no swipe
  precedent exists elsewhere in this codebase and touch-gesture affordances on
  a shared kitchen wall are easy to trigger by accident). Follows the existing
  server-confirmed pattern exactly: on click, DELETE, then remove from `items`
  only after a 2xx response; on failure, set `failed = true` and leave the row
  in place (nothing to revert, matching `toggle()`'s convention). Reuses
  `pendingIds` to disable the row's controls mid-request.

Verify: `node --test test/persistence.test.ts` green; visual check via
`npm run storybook` once Phase 4 adds a story (or ad hoc via `npm run dev` +
`npm run dev:server` for this phase alone, since K7ShoppingList has no story
yet and adding one is not in this change's scope).

### Phase 4 — K7Recipes.svelte + story

Files:
- `src/client/lib/K7Recipes.svelte` (new) — custom element `k7-recipes`, props
  `maxVisible` (default 6), `allowUrlImport` (default true, string-reflected
  bool per the `K7ShoppingList` convention), `tags` (comma-separated string,
  matching how `main.ts` already joins array params for other cards, e.g.
  `presetsMinutes`).
  - List state: fetches `/api/recipes?limit=<maxVisible>` (+`tag` if a single
    filter tag is set from `tags`), renders title + tag chips, `[OK]`/`[--]`
    idle-vs-loaded state per the Card glyph convention, delete button per
    recipe (same 2xx-confirmed-then-remove pattern as shopping-list).
  - Import flow (only rendered when `allowUrlImport`): a URL input + "IMPORTUJ"
    button (ghost, since a solid amber "+DODAJ" already exists per-card
    elsewhere and the "one solid control per card" budget — `[node:a827e6ec]`
    — is spent by whichever action is primary; import is secondary to the
    list). On submit, POSTs to `/api/recipes/import`; on success, the card
    switches to a **review state**: an editable form (title, ingredients as a
    textarea — one per line, steps as a textarea — one per line, tags as a
    comma field) pre-filled from the extracted `Recipe`, with "ZAPISZ" (POSTs
    the edited fields to `/api/recipes`, then returns to list state and
    refetches) and "ANULUJ" (discards, returns to list state, nothing was
    persisted). This is the "review before save" UI the task requires — no
    path auto-saves an unreviewed extraction.
  - Error states: import fetch failure shows the reason inline (extraction
    failed / timed out / URL rejected) rather than a generic message, since the
    task calls for a genuine review step and a silent failure defeats that.
- `src/client/lib/K7Recipes.stories.ts` (new) — follows `K7Card.stories.ts`'s
  established pattern (web-components renderer, `import './K7Recipes.svelte'`
  to register the element, `Meta`/`StoryObj` from `@storybook/web-components-vite`,
  `render` returning `lit`'s `html`). Stories: empty list, populated list,
  import-in-progress, review-state-after-import, import-failed.
- `src/client/main.ts` — add `import './lib/K7Recipes.svelte'` alongside the
  other card imports; add a `case 'recipes':` to `createWidget()`'s switch
  (currently falls through to the generic idle stub) passing `maxVisible`,
  `allowUrlImport`, and `tags` (joined) as attributes, mirroring the
  `shopping-list` case immediately above it.

Verify: `npm run build:storybook` succeeds; visual check of all
`K7Recipes.stories.ts` stories in Storybook; `npm run typecheck` passes with
the new component and the `main.ts` switch case.

### Phase 5 — layout.yaml wiring check + full check suite

- Confirm `layout.yaml`'s existing `przepisy` card (`maxVisible: 6`,
  `allowUrlImport: true`) renders `<k7-recipes>` correctly end to end against a
  running `npm run dev:server` + `npm run dev` — no `layout.yaml` edit is
  needed since the card was already declared ahead of the implementation.
- Run `npm run check` (lint + token contract + tests + build) and fix
  everything it flags.
- Update `docs/handoff/PLAN.md`'s Faza 3 checkboxes to reflect what actually
  shipped (tick the boxes; the "CRUD listy zakupów" box was misleading about
  what remained — note that in the tick, per PLAN.md's own established style
  of short parenthetical notes on checked items elsewhere in the file).

Verify: `npm run check` exits 0.

## Risks

- **HTML extraction heuristics are inherently fuzzy.** Real recipe sites vary
  widely. Mitigation: Phase 1's tests use realistic fixture shapes (including
  `HowToStep[]` instructions, which trips up naive `join()`-based extraction),
  and the review-before-save UI is the actual safety net — a wrong extraction
  is corrected by a human before it's ever persisted, not silently accepted.
- **jsdom is a heavier dependency** (parses full HTML documents) — acceptable
  here since it's backend-only, runs on the LAN machine (not the iPad), and is
  only invoked on-demand per import click, not on a polling interval.
- **Shared-file diff risk** (`src/server/index.ts`, `package.json`): kept
  strictly additive — new route blocks appended after existing ones, one new
  `dependencies` entry pair — to minimise conflicts with the parallel Faza 4/5
  branches also touching these files.
- **No dedicated review-UI wireframe pass.** Flagged as a human-decision note
  in the PR per the task's own instruction to surface checkpoints there when
  unattended.

## Files touched (summary)

- New: `src/server/recipes/extract.ts`, `src/server/recipes/import.ts`,
  `test/recipes-extract.test.ts`, `src/client/lib/K7Recipes.svelte`,
  `src/client/lib/K7Recipes.stories.ts`.
- Edited (additive): `src/server/index.ts`, `package.json`,
  `test/persistence.test.ts`, `src/client/lib/K7ShoppingList.svelte`,
  `src/client/main.ts`, `docs/handoff/PLAN.md`.
