# Plan — k7-recipe-auto-tags

memory_goal: 61f32cec-4390-4f4b-8f53-485a1ff28ce2
epic: k7-recipe-widget-upgrade (slice 4 of 8, headless)

## Tension this slice has to settle first

Two settled nodes pull against "a model writes tags at save time":

- [node:a0e8d46f] — the server has no path that persists an unreviewed
  extraction; import returns a draft, only `POST /api/recipes` saves.
- [node:0e15e38d] — `description` is deliberately *not* model-guessed,
  because a guess stored as authored data is placeholder-as-real.

This slice does not contradict either. `POST /api/recipes` is still the only
write path and is still only reached through ZAPISZ, so the household has
reviewed everything it typed. Tags are the one field the household explicitly
left empty. The response carries the generated tags, the card shows them at
once (detail view after an edit, the list on reload), and EDYTUJ changes them.
Tags are a lookup aid, not a claim about the dish the household relies on the
way it relies on ingredients. The chat `/przepis` drafter already asks the model
for tags ([EXTRACTION_PROMPT]); this is the same trust level, applied after the
review instead of before it.

The slice is headless on purpose (roadmap): no UI change, no suggestion step
in the review form.

## Decisions

- **Synchronous with a short timeout, failure never blocks the save.** One
  gateway call inside `POST /api/recipes` when `tags` is empty, with a 15 s
  `timeoutMs` (the gateway default is 45 s, too long for someone standing
  at the counter watching ZAPISZ). A thrown call, an unparsable reply or an empty
  tag list saves the recipe untagged and writes a `warn` to the issue log
  (`kilo-gateway` source). Alternative rejected: a background job that saves
  first and re-saves with tags. It races an EDYTUJ opened right after
  ZAPISZ, and the file store has no compare-and-set.
- **Model: `kilo-auto/free`**, the same default `/api/ascii-art` uses. No
  conversation exists to borrow a model from (unlike the drafter), and a free
  model keeps a background-ish chore from costing money. A constant in the
  tagger module, not a config key. Nobody has asked to change it.
- **No key configured → no tagging at all**, same as ascii-art's absent-key
  rule: the tagger is not constructed and the route saves untagged silently.
- **Every save with empty tags**, including an EDYTUJ where the household
  cleared them. The roadmap names "empty tags at save time" as the trigger,
  and an intentionally tag-less recipe has no use in a widget whose search
  (slices 7-8) filters on tags.
- **New `AiCallPurpose` value `recipe-tagging`**. The `purpose` column is a
  TypeScript-only enum (no CHECK constraint in `drizzle/0000`), so there is no
  migration. The call is recorded before parsing, the same way the drafter
  records its call.

## Phase 1 — `src/server/ai/recipe-tagger.ts` (new) + test

- `TAGGING_PROMPT` (Polish, same register as `EXTRACTION_PROMPT`): answer
  only with `{"tags": string[]}`, 1-4 short lowercase tags (dish type, main
  ingredient, cuisine), in the language of the recipe.
- `buildTaggingInput(recipe)`: the user message, holding the title, the
  description (if any), and the ingredients and steps as lists.
- `parseRecipeTags(content)`: the same outermost-`{...}` tolerance as
  `parseRecipeDraft`. It strips `#`, lowercases, dedupes and caps at 4.
  It returns `[]` on anything unusable and never throws (the caller treats
  empty as a failure anyway).
- `createRecipeTagger({ aiCalls, modelCatalog, gateway })` →
  `{ suggestTags(recipe, signal?) }`. It records an `AiCall` (`purpose:
  'recipe-tagging'`, `conversationId: null`). Cost lookup is best-effort, as
  in ascii-art.
- `fillMissingTags(recipe, tagger | undefined, onError)`: a pure helper
  returning the recipe with tags filled in, or unchanged. This keeps the
  route's only new logic testable ([node:925056b0]: recipe routes have no
  `app.inject()` coverage).
- `AiCallPurpose` and `schema.ts`'s enum list gain `recipe-tagging`.

Verify: `test/recipe-tagger.test.ts`:
- the parser tolerates fences and prose, and caps and dedupes the tags;
- the prompt carries all four fields;
- the AiCall is recorded;
- `fillMissingTags` leaves non-empty tags alone and never calls the tagger;
- it falls back to untagged when the tagger throws.

## Phase 2 — wire into `POST /api/recipes`

- Construct the tagger only when `config.kiloGatewayKey` is set.
- In the route, after validation and before `recipes.save`:
  `const tags = await fillMissingTags(...)`, with `onError` calling
  `logIssue('warn', 'kilo-gateway', 'recipe auto-tagging failed', err)`.
- Changelog entry `2026-09-25-01-przepisy-automatyczne-tagi.yaml`.

Verify: `npm test`, `npm run typecheck`.
