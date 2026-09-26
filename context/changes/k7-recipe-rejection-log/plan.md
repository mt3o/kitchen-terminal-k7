# Plan — k7-recipe-rejection-log

memory_goal: 0f65e225-90a5-49a9-849c-a5552f6b4477
epic: k7-recipe-widget-upgrade (slice 3 of 8)

## Existing infrastructure this reuses the *shape* of, not the *instance* of

This codebase already has a household-visible "what went wrong" log —
`IssueLogEntry`/`IssueLogRepository` (`src/server/domain/types.ts`,
`ports/repositories.ts`, `adapters/drizzle/index.ts`, `db/schema.ts`'s
`issue_log` table), surfaced by a header popup (`src/client/lib/issue-log.ts`,
`GET /api/issues`). It is generic, read-only, and deliberately thin
(severity/source/message/detail) — exactly right for "the calendar fell
back to stale data," wrong for this slice's actual ask. The user's own
words were "review the attempts and **bring them back** by fixing broken
imports" — that needs enough structured data to *replay* an attempt
(the exact title/ingredients/steps/tags/sourceUrl that got rejected, or the
URL an import failed on), which `IssueLogEntry`'s four string fields cannot
hold. This slice therefore adds a **new**, recipe-scoped repository
following the same pattern (SQLite table, Drizzle adapter, boot-time sweep)
rather than overloading the existing one — but it is a genuinely new store,
not a rename of the old one.

**Domain vocabulary:** proposing `RecipeRejection` as a `proposed` domain
entity via `capture_entity` in Phase 1, not running a full `/gw-domain`
ceremony for it — `IssueLogEntry`, the closest existing precedent (an
audit/log record, same category as the already-ratified `AiCall`), was
itself never put through `/gw-domain` and the project has been fine with
that. Low-ceremony, but not silently coined either: it enters the
domain-review backlog for a human to eventually rule on.

## Non-goals

- Not folding rejections into the existing `IssueLogEntry`/`GET /api/issues`
  popup — different shape, different audience-intent (ambient "something's
  wrong somewhere" vs. deliberate "let me go fix that recipe I tried to
  add").
- Not logging generic 500s here — those already reach the existing issue
  log via `app.setErrorHandler`. This slice covers only the recipe routes'
  own validation/import-rejection paths, which already carry a clear
  human-readable reason string.
- Not auto-dismissing a rejection when its retry succeeds. Simpler and
  consistent with the existing manual-delete UX this card already has for
  saved recipes (the row "×" button) — the household dismisses a rejection
  explicitly, the same gesture they already know.

## Phase 1 — Domain type and storage

Files: `src/server/domain/types.ts`, `src/server/db/schema.ts`,
`src/server/ports/repositories.ts`, `src/server/adapters/drizzle/index.ts`

- `RecipeRejection` type: `{ id: string; kind: 'save' | 'import'; reason:
  string; attemptedInput: Record<string, unknown>; createdAt: Date }`.
  `attemptedInput` is the raw submitted body (`POST /api/recipes`'s JSON
  body for `kind: 'save'`, `{ url }` for `kind: 'import'`) stored as JSON —
  same "shapes vary too much for columns" reasoning `schema.ts` already
  gives `ingredients`/`steps`/`tags`, and it sidesteps duplicating the full
  `Recipe` shape as a pile of nullable columns for two different kinds.
- `recipe_rejections` SQLite table, mirroring `issue_log`'s shape exactly:
  `id`, `kind` (text enum), `reason` (text), `attempted_input` (json),
  `created_at` (indexed, default now). New drizzle-kit migration.
- `RecipeRejectionRepository` port: `record(entry, createdAt?)`,
  `listRecent(limit?)`, `delete(id)`, `prune(olderThan)`. **Differs from
  `IssueLogRepository` by having `delete(id)`** — issue-log entries are
  purely ambient and only ever leave via the sweep; rejections need an
  explicit per-row dismiss for the retry-then-delete UX (Phase 3).
- Drizzle adapter implementation, added to `Repositories`.
- `capture_entity` proposing `RecipeRejection` (see above), `ABOUT`-linkable
  to it from this slice's own captures.

Verify: a unit test exercising `record`/`listRecent`/`delete`/`prune`
against the Drizzle adapter (mirror `test/persistence.test.ts`'s
`IssueLogRepository` block).

## Phase 2 — HTTP: log on rejection, list, dismiss

Files: `src/server/recipes/rejection-log.ts` (new), `src/server/index.ts`

- **`src/server/recipes/rejection-log.ts`** — a pure function, deliberately
  pulled out of `index.ts` and into `src/server/recipes/` (matching
  `extract.ts`/`import.ts`/`markdown-format.ts`'s own "pure, no
  filesystem/network, testable in isolation" convention in that directory).
  Second `/gw-plan-review` pass made this a blocking finding: the first
  draft's scrub/bound logic lived only as prose inside the `index.ts`
  route, untestable without spinning up Fastify — and per
  [node:0cd8aca5] ("redaction is proven on the wire, not in a unit test...
  a scrubber that works but is never called is worse than no scrubber"),
  the exact fix this plan makes needs its own test, the same way
  `test/redact.test.ts` already tests `createScrubber` itself as a pure
  function.

  ```ts
  export function sanitizeRejectionInput(
    raw: Record<string, unknown>,
    scrub: (input: unknown) => unknown,
  ): Record<string, unknown>
  ```

  1. `scrub(raw)` **first, on the raw object** — `createScrubber`
     (`src/server/redact.ts`) already recurses through objects/arrays and
     redacts both known secret values and pattern-shaped ones (Bearer
     tokens, JWTs, credentialed URLs); it is designed to take `unknown`,
     not a pre-stringified string.
  2. Bound size **per field, after scrubbing, before any serialization** —
     never by slicing an already-serialized JSON string. Truncating a JSON
     string at a fixed character count can (a) cut a secret-shaped pattern
     in half at the boundary, so the surviving fragment no longer matches
     `PATTERNS`'s length-gated regexes and stores in plaintext — a direct
     risk against [node:ac006a24] ("secrets... must not leak... alongside
     errors", generalized here to any storage path, not just GlitchTip) —
     and (b) frequently produces syntactically invalid JSON, which either
     throws on write into the `json`-mode column (Phase 1) or silently
     breaks Phase 3's `attemptedInput.title`/`.url` reads. Since `raw` is
     always `req.body` from an already-parsed JSON request, every field is
     already JSON-safe (string, number, boolean, null, array, or nested
     object — never a function or symbol) — so there is **no need to drop
     a malformed field** (second `/gw-plan-review` pass's other finding:
     the first draft's "drop any field that isn't a string/array of
     strings" rule would have silently discarded exactly the malformed
     `ingredients`/`steps`/`tags` value that caused a rejection in the
     first place, making it unrecoverable on retry — the same class of
     "silently lose the data retry needs" bug as the id-drop from round
     one). Instead: a string value is capped at a **local constant**
     defined inside `rejection-log.ts` itself (e.g.
     `ATTEMPTED_INPUT_FIELD_MAX = 4000`, same value as `index.ts`'s
     `ISSUE_DETAIL_MAX` but **not imported from there** — fourth
     `/gw-plan-review` pass flagged that `ISSUE_DETAIL_MAX` is an
     unexported `const` inside `index.ts`, which is a top-level script
     whose import side-effects include opening the database and starting
     migrations; importing anything from it into this deliberately pure
     module would transitively boot the server on `test/rejection-log.test.ts`'s
     own import, silently reintroducing the exact untestability defect
     this module was extracted to fix — [node:3a2df9aa], [node:0cd8aca5])
     characters; an array is capped to 200 elements, each element capped
     the same way if it's a string; anything else (number, boolean, null,
     an unexpectedly-nested object) passes through unchanged — it's
     already small and JSON-safe, and preserving it is what lets Phase 3
     show the household exactly what they submitted, malformed value
     included.
  3. `reason` is handled separately by the caller (below), **not** by this
     function — it's always a plain string, never `attemptedInput`.

  Verify: `test/rejection-log.test.ts` (new, pure — no Fastify/filesystem)
  — asserts (a) a secret-shaped string anywhere in a nested `attemptedInput`
  is redacted before the bound is applied (construct a scrubber via
  `createScrubber` with a fake known secret, same pattern
  `test/redact.test.ts` uses); (b) an over-length string field is capped
  without producing invalid JSON (`JSON.parse(JSON.stringify(result))`
  round-trips); (c) a malformed field (e.g. `ingredients: 'not an array'`,
  or `ingredients: 123`) survives, bounded, rather than being dropped —
  closing both findings with one test module.

- **`index.ts`**: a thin `logRejection(kind, reason, attemptedInput)`
  wrapper calling `sanitizeRejectionInput(attemptedInput, scrubIssueText)`
  then `repos.recipeRejections.record({ kind, reason:
  (scrubIssueText(reason) as string).slice(0, ISSUE_MESSAGE_MAX),
  attemptedInput: sanitized })` — **scrub the raw `reason` first, bound
  second** (third `/gw-plan-review` pass caught that this bullet's own code
  sample previously wrote the scrub and slice calls in the opposite order
  from what its prose claimed — a direct self-contradiction, now fixed to
  match the prose). This is **not "the same order as `logIssue`"**: the
  live `logIssue` actually does `scrubIssueText(message.slice(0,
  ISSUE_MESSAGE_MAX))` — slice, then scrub. That reversed order is not
  merely lower-risk-but-acceptable here, as an earlier draft of this plan
  claimed — it is **actively wrong for one of this very plan's own call
  sites**: `POST /api/recipes`'s `InvalidRecipeIdError` catch branch (one
  of the four places `logRejection('save', ...)` gets wired in, below)
  produces a `reason` of `` `not a valid recipe id: ${JSON.stringify(id)}` ``
  (`adapters/files/recipes.ts`'s `InvalidRecipeIdError`), where `id` is
  raw, unbounded, client-supplied text (`body.id`) embedded verbatim —
  exactly the kind of attacker-influenced content the "reason is always a
  short developer-authored constant" assumption does not hold for.
  Slicing that before scrubbing could cut a secret-shaped pattern at the
  500-char boundary so it survives in plaintext — the identical
  vulnerability class already fixed for `attemptedInput` above, now
  closed for `reason` too, at every call site, not just the routine ones.
  Fire-and-forget with the same `.catch(() => stderr)` pattern as
  `logIssue` — a logging failure must never compound into losing the
  original 400/502 response.
- `POST /api/recipes`: call `logRejection('save', reason, body)` on each of
  its three `400` branches (missing title, ingredients/steps/tags not
  string arrays, invalid `sourceUrl` from slice 2) and the
  `InvalidRecipeIdError` catch branch — same reason string already sent to
  the client, no new copy to maintain.
- `POST /api/recipes/import`: call `logRejection('import', reason, { url })`
  on the empty-url `400` and every `RecipeImportError` branch (`400`
  invalid-url, `502` fetch-failed/extraction-failed).
- `GET /api/recipes/rejections?limit=` — list recent, same query-param
  convention `GET /api/recipes` already uses.
- `DELETE /api/recipes/rejections/:id` — dismiss; `204`/`404` pattern
  matching `DELETE /api/recipes/:id`.
- Boot-time + interval sweep mirroring `sweepIssueLog` exactly (same
  `ISSUE_LOG_MAX_AGE_MS`/`ISSUE_LOG_SWEEP_INTERVAL_MS` constants — no reason
  to invent different retention for this log).

Verify: extend the Drizzle-adapter test from Phase 1 isn't enough on its
own — this phase needs the route-level behavior tested. Per the standing
issue [node:925056b0] (this codebase has zero automated HTTP-level test
coverage for any recipe route, `index.ts` isn't structured for
`app.inject()`), this phase's routes get the same treatment slices 1-2
got: manual smoke-test verification (live server, curl), not a new test
file — extracting `registerRecipeRoutes` to close that gap stays out of
scope for this slice, per that issue's own recommendation.

## Phase 3 — Client: rejections list + retry

File: `src/client/lib/K7Recipes.svelte`

- Fetch `GET /api/recipes/rejections` alongside the main recipe list load;
  keep the count in state.
- List view gains a ghost-button affordance, **shown only when the count is
  > 0** (no placeholder/empty affordance — [node:4a749051]'s "no
  placeholder data as real" spirit, applied to visibility rather than
  content): `NIEUDANE PROBY (N)`, switching to a new `mode: 'rejections'`.
- Rejections view: each row shows kind, `reason`, and a kind-appropriate
  label (`attemptedInput.title` for `kind: 'save'`, `attemptedInput.url`
  for `kind: 'import'`) with age (reuse `ageLabel` from `lib/wmo.ts`, same
  helper `issue-log.ts` already uses), a `PONOW` (retry) ghost button, and
  a delete `×` reusing `.row-delete`'s existing styling.
- Retry, kind-dependent:
  - `kind: 'save'` — coerce `attemptedInput` into a `RecipeDraft`-shaped
    object defensively (the rejected field is, by definition, not
    guaranteed to be the right type — e.g. a rejected `sourceUrl` might not
    even be a string if the client sent something malformed; fall back to
    `''`/`[]` per field rather than throwing) and call the existing
    `openReview()` with it, landing the household back in the familiar
    review form, pre-filled, ready to fix the one field that failed.
    **Must also extract `attemptedInput.id`** (when present and a string)
    and pass it as `openReview(coercedDraft, { id })`
    (`/gw-plan-review` caught that the plan's first draft omitted this): a
    `kind: 'save'` rejection can originate from **editing an existing
    recipe**, not only from a fresh import/manual entry —
    `editDetail()` already calls `openReview(detail, { id: detail.id })`,
    and `saveReview()` includes `id` in the POST body whenever `reviewId`
    is set, so a rejected edit's `attemptedInput` does carry the original
    id. `RecipeDraft` itself has no `id` field (it's the hand-duplicated
    client type slice 2's plan-review already flagged —
    [node:aa18e4c8]), so "coerce into `RecipeDraft` shape" silently drops
    it unless the id is threaded through `options` separately. Without
    this, retrying a rejected edit doesn't fix the original recipe — the
    file adapter's `save()` treats an empty id as a new recipe
    (`const id = recipe.id || (await freeId(dir, recipe.title))`), so the
    household would silently get a **duplicate** under a new id while the
    original stays broken, undercutting this slice's entire point.
  - `kind: 'import'` — no review form to reopen (nothing was ever
    extracted); instead set `importUrl = typeof attemptedInput.url ===
    'string' ? attemptedInput.url : ''` and return to list mode so the
    existing IMPORTUJ button is ready to press again. The type guard is
    not optional here (third `/gw-plan-review` pass caught its absence):
    `POST /api/recipes/import`'s "empty url" `400` fires whenever `url` is
    `typeof body.url !== 'string' || body.url.trim() === ''` — reachable
    with `url` as a non-string (number, object, array) — and Phase 2's
    "preserve, don't drop" rule (above) means that non-string value
    survives unchanged into `attemptedInput`. Without the guard,
    `importUrl` (a `string`-typed field bound to a text input) could be
    assigned a non-string value directly, matching the defensive coercion
    the `kind: 'save'` path a few lines above already gets — this path
    was missing it in an earlier draft.
  - Neither path auto-dismisses the rejection (see Non-goals) — the
    household deletes it via `×` once satisfied, same gesture as removing a
    saved recipe.
- New CSS only via existing tokens (`var(--fg-muted)`, `.btn-ghost`,
  `.row-delete`), no new hardcoded values — [node:79662ce5].

Verify: manually exercise in the dev server — submit a title-less save,
confirm it's listed under NIEUDANE PROBY with the right reason; retry it,
confirm the review form opens pre-filled with whatever was submitted;
attempt an import against an unreachable URL, confirm it's listed with
`kind: 'import'`, retry re-fills the URL field; delete a rejection and
confirm it's gone from both the list and (after a page reload) the
database.

**Changelog entry** (CLAUDE.md standing constraint — every prior slice in
this epic has needed one; add it here too): user-facing (a new list of
failed attempts, retry, dismiss). Added as the last step of implementation,
dated the day this change actually lands.

## Risk

Low-medium. The one real design risk is scope: a rejection log that tries
to be too clever (auto-linking retries to their origin, diffing what
changed) turns into its own mini-feature. This plan deliberately keeps
retry as "pre-fill and let the household finish the job," matching how
EDYTUJ already works for saved recipes — no new interaction pattern, only
a new entry point into the one the card already has.
