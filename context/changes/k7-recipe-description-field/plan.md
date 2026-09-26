# Plan — k7-recipe-description-field

memory_goal: 5689d533-a542-4ff8-8aa0-15efe8f123a4
epic: k7-recipe-widget-upgrade (slice 1 of 8)

## Non-goals

- No change to how the recipe collection is stored (still one `.md` file per
  recipe — [node:7c3c191a]).
- `extractFallback` (Readability heuristic) does **not** synthesize a
  description from the article excerpt — that would be exactly the kind of
  guess this module's own "no placeholder data as real" rule
  ([node:4a749051]) and "keep the two strategies genuinely separate"
  decision ([node:1eee1694]) forbid. It returns `description: ''`; the
  household types one by hand if they want it.
- The chat `/przepis` drafter (`recipe-drafter.ts`) is **not** prompted to
  invent a description either, for the same reason — it returns `''`.
- No auto-generation of anything (that's slice 4, `k7-recipe-auto-tags`, and
  only for tags).

## Phase 1 — Domain type and on-disk format

Files: `src/server/domain/types.ts`, `src/server/recipes/markdown-format.ts`

- Add `description: string` to the `Recipe` interface (always a string,
  `''` when absent — same convention as `ingredients`/`steps` being empty
  arrays rather than null, so callers never branch on null vs empty).
- `markdown-format.ts` file doc already states the format's own rule:
  frontmatter for fields a person rarely touches, Markdown body for the ones
  they do. Description is squarely the second kind — it becomes a **new
  `## Opis` body section**, not a frontmatter key. [node:03e6c5c0] (the
  review form reuses one field-shape for both import and manual entry)
  extends naturally: description is just another field in that shape.
- Placement: `## Opis` comes **before** `## Składniki`, so a hand-read file
  goes title → blurb → ingredients → steps, matching how the detail view
  will render it (Phase 3).
- Serialize: `recipe.description.split(/\r?\n/).map(oneLine).filter(Boolean)`
  emitted as plain lines (no bullets, no numbering — it's prose) under
  `## Opis`, **only when non-empty** (same conditional-section pattern the
  ingredients block already uses), so recipes without a description keep
  today's exact file shape.
- Parse: extend `SECTION_BY_HEADING` with `opis: 'description'` (and
  `description: 'description'` for an English-typed file) and `lists` with a
  third array. The existing per-line loop already handles unbulleted prose
  lines via its plain-line fallback branch — no loop changes needed. After
  the loop, `description: lists.description.join('\n')`.
- **Known simplifications, stated rather than silently decided (third
  `/gw-plan-review` pass added the second one):** blank lines inside a
  section are skipped by the existing loop (paragraph breaks are not
  preserved across a round-trip if someone hand-types blank lines between
  paragraphs in `## Opis`). And: the shared parse loop's `LIST_MARKER`
  regex strips a leading `-`/`*`/`1.`/`1)` from any flush-left line
  regardless of section, so a hand-typed description whose first line
  starts with a dash (e.g. "- ważne: mrozi się dobrze") loses that dash on
  read-back. Both are acceptable for a first cut — the textarea itself
  won't produce either shape unless the household types the file by hand —
  but stated here rather than discovered later, consistent with this
  module's "no placeholder/lossy data presented as real" discipline
  ([node:4a749051], [node:9bc167d9]).

Verify: extend `test/recipe-files.test.ts` (or wherever `markdown-format`'s
serialize/parse pair is exercised) with a round-trip case that includes a
description, one that omits it entirely (file shape unchanged), and one
hand-typed with an `## Opis`/`## Description` heading and no frontmatter key.

**Also touches** `src/server/db/schema.ts`: `RecipeRepository` is a
hexagonal port with **two** adapters — the file-based one (the live path)
and `adapters/drizzle/index.ts` (SQLite/Drizzle, still live as the
one-time SQLite→files migration *source* in `migrateRecipesToFiles`, and
directly exercised by `test/persistence.test.ts`'s `RecipeRepository`
block). `/gw-plan-review` caught that this plan's first draft omitted the
Drizzle side entirely, and verified live against the code that
`toRecipe()` explicitly lists fields (no `description`) and `schema.recipes`
has no `description` column — so a naive fix (just widen the `Recipe` type)
would let `save()`'s `{...recipe, ...}` spread carry a `description` key
that silently has nowhere to land once persisted through that adapter,
mirroring the exact "placeholder/lossy data presented as real" failure mode
this module is otherwise careful about ([node:4a749051], [node:9bc167d9]).

Decision: add a real column rather than document the adapter as lossy —
`description: text('description')` on `schema.recipes` (nullable, no
default, same style as `sourceUrl`), generate the migration with
`drizzle-kit generate` into the `drizzle/` folder `runMigrations` already
applies at boot (`src/server/db/migrate.ts`), so both adapters honor the
same `Recipe` shape with no silent gap.

## Phase 2 — HTTP contract and extraction paths

Files: `src/server/index.ts`, `src/server/adapters/files/recipes.ts`,
`src/server/adapters/drizzle/index.ts`, `src/server/recipes/extract.ts`,
`src/server/ai/recipe-drafter.ts`

- `POST /api/recipes` (`src/server/index.ts`): accept optional
  `description?: unknown` in the body; `typeof body.description === 'string'
  ? body.description.trim() : ''`. Not required — matches the existing rule
  that only `title` blocks a save ([node:a0e8d46f]).
- `FileRecipeRepository.save()` (`adapters/files/recipes.ts`): thread
  `description` through into the `serializeRecipe` call the same way
  `sourceUrl`/`tags` already are.
- `adapters/drizzle/index.ts`'s `toRecipe()`: add
  `description: r.description ?? ''`, mapping the now-nullable column back
  to the type's empty-string convention (Phase 1's schema change). `save()`
  needs no change — its `{...recipe, id, importedAt}` spread already carries
  `description` through to the (now real) column once the type has the
  field.
- `GET /api/recipes` and `GET /api/recipes/:id` need no code change — they
  return whatever `recipes.list()`/`recipes.get()` produce, which now
  includes `description` once Phase 1 lands.
- `extractJsonLd` (`extract.ts`): schema.org/Recipe has a `description`
  property; add `description: typeof node.description === 'string' ?
  node.description.trim() : ''`. This is free — it's already-published
  structured data, not a guess, so it doesn't trip the "no placeholder data
  as real" rule.
- `extractFallback` and `parseRecipeDraft` (`recipe-drafter.ts`): add
  `description: ''` only, per the non-goals above.
- `ExtractedRecipe = Omit<Recipe, 'id' | 'importedAt'>` picks up the new
  field automatically once `Recipe` has it — the compiler will flag every
  literal that needs updating (`extract.ts`, `recipe-drafter.ts`, and test
  fixtures in `test/recipes-extract.test.ts`, `test/recipe-drafter.test.ts`,
  `test/recipe-files.test.ts`, `test/persistence.test.ts`).

Verify: `npm run typecheck` (or equivalent) surfaces every call site the type
change touches; update each; existing extraction tests get a JSON-LD fixture
with a `description` property asserting it comes through, and a fallback
fixture asserting `description: ''`. `test/persistence.test.ts`'s
`RecipeRepository` block (runs against the Drizzle adapter directly) gets a
real save-then-get assertion that a description round-trips — not scoped
away, now that the column exists to make that assertion meaningful.

**Also touches** `test/chat-routes.test.ts` (second `/gw-plan-review` pass
caught this): its `POST /api/chat/conversations/:id/recipe-draft` test
asserts `res.json()` via `assert.deepEqual` against a literal with no
`description` key. That route has no `schema.response`, so once
`recipe-drafter.ts` returns `description: ''` the live JSON payload gains
that key — Node's `assert.deepEqual` fails on an actual object carrying an
extra own key the expected object lacks, and this is **not**
compiler-caught (`res.json()` is `unknown`), unlike every other call site in
this phase. Add `description: ''` to that test's expected object.

## Phase 3 — Review form and detail view

Files: `src/client/lib/K7Recipes.svelte`, `src/client/lib/k7-events.ts`

- **`k7-events.ts` first** (second `/gw-plan-review` pass caught that this
  was missing entirely): `RecipeDraft` is a **hand-duplicated** client type
  — "the unsaved shape `POST /api/recipes/import` and the chat's
  recipe-draft route both return" — not derived from the server `Recipe`
  type, so unlike `ExtractedRecipe` (`Omit<Recipe, ...>`, Phase 2) it does
  **not** pick up `description` automatically. Add `description: string` to
  `RecipeDraft`. This is the shape both entry points into the review form
  funnel through: URL import (`startImport()`'s inline response union type
  in `K7Recipes.svelte`, update alongside) and the chat `/przecis` drafter
  (`K7Chat.svelte`'s `draftRecipe()` casts the HTTP response `as
  RecipeDraft` and dispatches it as a `RECIPE_DRAFT` event — no code change
  needed there beyond the type gaining the field, since it passes the value
  through rather than constructing a literal).
- Add `description: string` to the local `Recipe` interface.
- Add `reviewDescription` state (plain string, no `linesOf()` transform
  needed since it's already free text, unlike ingredients/steps which are
  joined-then-split line lists).
- `openReview()` resets `reviewDescription` alongside the existing review
  fields, for both the import-then-edit and manual-entry paths
  ([node:03e6c5c0] — one form, two ways in). (Correction from third
  `/gw-plan-review` pass: `cancelReview()` today resets no fields at all —
  only `mode` and `saveError` — so there is nothing to add there;
  `openReview()` is always called again before the form reappears, which is
  why this has no visible effect either way.) `openManualEntry()`'s literal
  (`{ sourceUrl: null, title: '', ingredients: [], steps: [], tags: [] }`)
  needs `description: ''` added once `RecipeDraft` requires it.
- Submit sends `description: reviewDescription.trim()`.
- New `<textarea>` in the review form, placed to match Phase 1's read order
  (after title, before ingredients). Optional — does **not** join
  `reviewTitle.trim() === ''` in gating the ZAPISZ button; title stays the
  only required field.
- Detail view: render `detail.description` (if non-empty) between the title
  and the `## Składniki` list, matching the on-disk order.
- `K7Recipes.stories.ts` has no literal `Recipe`-shaped fixtures to update
  (third `/gw-plan-review` pass confirmed: its stories hit the real
  `/api/recipes*` endpoints and only take `maxVisible`/`allowUrlImport`/
  `tags` string args) — nothing to do here beyond what the dev-server /
  manual-exercise step below already covers.

Verify: run the component's existing test/story coverage; manually exercise
in the dev server — import a recipe from a URL that has schema.org
`description`, confirm it's pre-filled in review; save one with and without
a description; confirm the detail view and a hand-edited `.md` file with an
`## Opis` section both read back correctly.

**Changelog entry (CLAUDE.md standing constraint, second
`/gw-plan-review` pass caught this was missing from the plan entirely):**
this is a user-facing change (new textarea in the review form, new text in
the detail view), so it needs one new file in `changelog/`, named
`YYYY-MM-DD-NN-slug.yaml` (date = the day the change actually lands, NN =
next sequence number for that date — see `changelog/README.md`), added in
this same change, in Polish, per the household-facing convention every
other entry in that directory follows. Not created now since planning
predates the landing date; add it as the last step of implementation.

## Risk

`/gw-plan-review` correctly rejected this section's first draft, which
claimed `impact_of` was unnecessary because nothing recalled was being
changed or redefined — that premise was wrong: `impact_of(2135f0a4)` and
`impact_of(7c3c191a)`, run independently by the review, both surface the
Drizzle-adapter/persistence-layer subsystem as a live dependent this change
does touch (now addressed above, Phases 1-2). The type-level ripple through
every `Recipe`-literal call site (both adapters, both extraction paths, four
test files) is still mechanical and compiler-caught, not a design risk in
itself — but "mechanical" is not the same as "no dependents to trace," and
this plan should have traced them the first time rather than asserting
there was nothing to trace. Remaining risk is low once Phases 1-2 include
the schema migration and both adapters.
