# k7-ai-chat — research

## Recall summary

Seed recall through `93ee78af` (goal) surfaced the domain entities (Model,
Conversation, Message, AiCall), the `CONVSERVICE` lifetime constraint
(`4730c1bc`), the Kilo Gateway addressing decision (`279d73e0`), the AiCall
nullable-FK/set-null constraint (`8d6eee18`), the secrets constraint
(`ac006a24`), and the two-layer redaction constraint (`62d2072b`) — all
directly load-bearing for this change and confirmed against the code below.

## Gap the recall didn't answer (this change's actual research agenda)

Exact current shape of the persistence layer, whether it's wired up, exact
route-registration convention, exact chat-card param schema, and Svelte
component/story conventions to copy. Answered by reading the repo directly
(the research fork spawned for this got stuck in a self-referential
message loop and never executed — abandoned; read the files directly instead).

## Findings

1. **Persistence is fully built, chat is not wired to anything.**
   `src/server/db/schema.ts:53-103` — `conversations` (id, title, model,
   createdAt, updatedAt), `messages` (id, conversationId → cascade, role enum
   user/assistant/system, content, createdAt, indexed on
   (conversationId, createdAt)), `aiCalls` (id, conversationId → set null,
   messageId → set null, purpose enum `chat|compacting|ascii-art|transcription`,
   model, promptTokens, completionTokens, estimatedCostUsd, createdAt, indexed
   on createdAt). Matching domain types at `src/server/domain/types.ts:29-63`.
   `ConversationRepository`/`AiCallRepository` ports fully declared
   (`src/server/ports/repositories.ts:41-58`) and fully implemented in the
   Drizzle adapter (`src/server/adapters/drizzle/index.ts:130-186`), including
   `totalCostSince` for the cost view. Migrations for these tables are already
   committed (`drizzle/0000_nebulous_lizard.sql`). **Nothing** references Kilo,
   ConversationService, or any chat route anywhere in `src/` — confirmed by
   grep. Faza 4 is a green field on top of a finished foundation.

2. **`src/server/index.ts` is one flat file, shared with sibling agents.**
   No `routes/` directory; every route (health, layout, theme.css, weather,
   shopping-list, error handler, static) is registered inline in this one
   module (`src/server/index.ts:1-206`). Faza 3 and Faza 5 agents touch the
   same file. New routes must be a minimal additive block, not a refactor.
   Captured as `[node:ff9ca87f]`.

3. **Chat card param contract is already pinned** in
   `docs/handoff/layout.schema.yaml:243-269` (`params.chat`): `defaultModel`
   (required), `availableModels` (empty ⇒ fetch from `/api/gateway/models`),
   `contextWindowMarginPercent` (5-50, default 20 — reserved for the
   response), `compactingThresholdPercent` (50-95, default 80 — triggers
   compacting), `voiceInput` (boolean, default false). `layout.yaml:62-65`
   already declares the `czat` card with `defaultModel: "kilo-auto/free"` and
   no other params set (all others take their schema defaults). Captured as
   `[node:c83ab909]`.

4. **No SSE precedent, no AI/HTTP-client dependency.** `package.json` has no
   `eventsource`/SSE helper and no AI SDK. Outbound HTTP so far is plain
   `fetch` wrapped in a timeout helper, `fetchWithTimeout` in
   `src/server/upstream/freshness.ts:70-80`, used by `fetchWeather`
   (`src/server/upstream/open-meteo.ts`). The Kilo Gateway client should
   follow the same shape. SSE will be the first streaming endpoint in this
   codebase — implement by hand via Fastify's raw response
   (`reply.hijack()` + `reply.raw.write(...)`), no library to reach for.

5. **`K7Weather.svelte` + `K7Weather.stories.ts` — resolved after both
   sides disagreed.** `K7Weather.stories.ts` does **not** exist on this
   branch's own history (`git log --oneline -5` here bottoms out at
   `8b493d5`, the theme-loader merge). It exists only on the unmerged sibling
   branch `change/k7-faza1-rest` (commit `0c06c4a`, "Faza 1 slices 2-3:
   calendar week view, component stories, generated tokens") — visible via
   `git log --all` because worktrees share one object database, and readable
   without merging via `git show change/k7-faza1-rest:src/client/lib/K7Weather.stories.ts`.
   Both "it exists" and "it doesn't exist" were true for different trees; the
   earlier flat denial was the error. Content below is read from that branch,
   not copied from memory.

   **Component convention**, `K7Weather.svelte`: `<svelte:options
   customElement={{ tag: 'k7-x', props: {...} }} />`, a `Props` interface
   with string-typed attrs (custom-element attrs are always strings) and
   defaults, `$state`/`$derived`/`$effect` runes, a local var named
   `cardState` (never `state` — shadows Svelte's rune) derived as
   `'ok'|'warn'|'fail'|'idle'` fed into the shared `Card.svelte` shell
   (`state`/`meta`/`label` props), an `$effect` that fetches with an
   `AbortController` and a `setInterval` (both cleared on teardown), Polish
   copy in the markup, and CSS using only `var(--*)` tokens.

   **Story convention**, `K7Weather.stories.ts`: `@storybook/web-components-vite`
   renderer, `lit`'s `html` tag, `import './K7Weather.svelte'` purely for its
   custom-element registration side effect (a dropped `customElement`
   compiler option renders nothing, and the import is what catches that), a
   `Meta` with `argTypes` and a `render(args)` function producing the tag.
   Because Storybook has no backend, every story installs a `withFetch`
   decorator that stubs `window.fetch` for the duration of that story and
   restores it via `queueMicrotask` after the story's own effect has already
   dispatched its request — `Loaded`/`Stale`/`Empty` (a fetch that never
   resolves, for the pre-first-paint idle state)/`Failed` (502 response).
   `K7Chat.svelte`'s story follows this exact pattern, extended to stub a
   streaming `Response` (a real `ReadableStream` body) for the send-message
   stories.

6. **Test convention**: `node:test`, `describe`/`it`, `beforeEach` opens
   `openDatabase(':memory:')` + `runMigrations(db)` + `createRepositories(db)`,
   assertions against the *ports* not the adapter internals
   (`test/persistence.test.ts:1-20`, `test/freshness.test.ts`). Time is always
   injected (`now: () => T0`) rather than read from the wall clock — the
   budgeting/compacting tests should follow this.

7. **Secrets**: `KILO_GATEWAY_KEY` already declared `@sensitive @required` in
   `.env.schema`, read via `config.ts:kiloGatewayKey`, already included in
   `secretValues()` so `redact.ts`'s scrubber already covers it by exact-value
   match. No extension needed there, but chat transcripts themselves (message
   content) are not secrets and should NOT be scrubbed as if they were — only
   verify the key itself never appears in a GlitchTip payload, which the
   existing exact-value layer already guarantees as long as errors flow
   through `Sentry.captureException`.

8. **HANDOFF.md confirms 'Mikrofon w czacie'** (`docs/handoff/HANDOFF.md:50`):
   decided — mic icon + audio transcription before sending. Matches
   `params.chat.voiceInput`. Deferred to end of implementation per the task
   brief; `purpose: 'transcription'` already exists in the `aiCalls` enum for
   when it lands.

## Artifacts captured

- `[node:c83ab909]` constraint — chat card param contract
- `[node:ff9ca87f]` constraint — index.ts is a flat shared file

## Contradictions

None — recalled nodes all confirmed against current code, no drift found.
