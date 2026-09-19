# Plan — k7-chat-harness

memory_goal: pending (see change.md / memory-backlog.md)

## Grounding

- `ConversationService` stays decoupled from HTTP (CLAUDE.md standing rule):
  every new *server* capability (context report, recipe extraction) is a plain
  service function a route adapts, never logic inside `routes/chat.ts`.
- Recipe import is review-before-save at the HTTP layer
  (`k7-recipes-shopping`): `/przepis` returns an **unsaved** draft; only the
  recipes card's ZAPISZ persists it.
- The hexagonal port (`ports/repositories.ts`) already anticipates swapping an
  adapter: the file store is a second `RecipeRepository`, not a core change.
- Tokens only, one solid amber control per card (DESIGN.md §2), bracket glyphs
  for state, Polish terse voice (§13), Safari 15 floor.
- No `crypto.randomUUID` on the client (15.4+); `localStorage` access wrapped.

## Non-goals
- No dockerization. No change to how `deploy.sh` works.
- No new domain entity: "harness command" is UI vocabulary, not domain.
- No removal of the SQLite `recipes` table — it stays as the migration source
  and rollback path.
- Model switching mid-thread is allowed (`PATCH` model); the per-turn budget
  already recomputes from the current model's context length.

## Phases

### Phase 1 — Recipe file store (server, self-contained)
- `src/server/recipes/markdown-format.ts` — pure `parseRecipeMarkdown` /
  `serializeRecipe` / `slugify` (YAML frontmatter + `## Składniki` / `## Kroki`
  lists; tolerant of hand-written files).
- `src/server/adapters/files/recipes.ts` — `createFileRecipeRepository(dir)`
  implementing `RecipeRepository`; atomic writes; path-safe ids;
  `migrateRecipesToFiles(source, dir)` guarded by a marker file.
- `config.ts` `recipesDir` (`K7_RECIPES_DIR`), `.env.schema`, boot wiring in
  `index.ts`.
- Tests: `test/recipe-files.test.ts`.

### Phase 2 — Chat server surface
- `ConversationRepository.update(id, {title?, model?})` (+ Drizzle adapter).
- `ConversationService.describeContext(...)` sharing the budget math with
  `streamTurn` (one `computeBudget`, so `/context` can never disagree with
  what a turn actually sends).
- `src/server/ai/recipe-drafter.ts` — LLM extraction of a recipe from an
  assistant message → unsaved draft; logs an `AiCall` (`recipe-extraction`).
- Routes: `PATCH`/`DELETE /api/chat/conversations/:id`,
  `GET /api/chat/context`, `POST /api/chat/conversations/:id/recipe-draft`;
  titles truncated at creation.
- Tests: conversation-service + chat-routes additions.

### Phase 3 — Client harness
- `src/client/lib/chat-commands.ts` — pure registry, parser, prompt builders,
  duration parsing/linking, context-bar formatting (tested in node).
- `src/client/lib/k7-events.ts` — the cross-card event contract in one place:
  `k7-timer-start`, `k7-recipe-draft`, `k7-shopping-list-changed`,
  `k7-reveal`, `k7-menu-select`.
- `K7Chat.svelte` — header (picker, ARCHIWUM, NOWA), archive view, command
  chips, local (never-sent) lines, `/zakupy` tick-list, tappable durations,
  resume-last-conversation.
- `K7Timer`, `K7Recipes`, `K7ShoppingList`, `K7Menu`, `main.ts` — listeners
  for the events above; `main.ts` passes the weather card's location to chat.

### Phase 4 — Docs, changelog, stories, full check
- `changelog.yaml` entry (2026-09-18), README recipe-dir note,
  `layout.schema.yaml` note if params change, K7Chat stories for archive +
  commands, `npm run check`.

## Risks
- LLM JSON extraction is fuzzy → the review form is the safety net; the
  parser is tolerant of fenced/prose-wrapped JSON and fails honestly.
- Hand-edited recipe files can be malformed → skipped with a warning, never
  failing the list.
- Chat card vertical space on a half-width iPad cell → chip row is one
  horizontally scrolling line; archive replaces the log rather than stacking.
