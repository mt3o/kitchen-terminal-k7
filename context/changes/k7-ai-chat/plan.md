# plan.md — k7-ai-chat (Faza 4: AI chat via Kilo Gateway)

Goal node: `93ee78af-543c-4a73-b50b-a52755ce33fb`. See `research.md` for the full
ground-truth survey. Summary: persistence (schema/domain types/ports/drizzle
adapter/migrations for `conversations`/`messages`/`ai_calls`) is **already
built**. This plan covers only the gateway integration, the decoupled
`ConversationService`, the SSE route, the UI card, and cost visibility.

Live-verified against the real Kilo Gateway (no API key required for `/models`
or the free-tier model) on 2026-09-09:
- `GET https://api.kilo.ai/api/gateway/models` → `{ data: [...] }`, each entry
  carrying `id`, `context_length`, `top_provider.max_completion_tokens`, and
  `pricing.{prompt,completion}` as **decimal-string USD-per-token** (e.g.
  `"0.000002"`), or `"-1"` for unpriced auto-router entries, or `"0"` for free.
- `POST https://api.kilo.ai/api/gateway/chat/completions` is a byte-for-byte
  OpenAI-compatible chat-completions endpoint: non-streaming returns
  `choices[0].message.content` + `usage.{prompt_tokens,completion_tokens}`;
  `stream: true` (+ `stream_options.include_usage: true`) returns SSE frames
  `data: {"choices":[{"delta":{"content":"..."}}]}`, a keepalive comment line
  `: KILO PROCESSING` (must be skipped, not parsed as JSON), a final chunk
  carrying `usage`, then `data: [DONE]`.

## Non-goals

- Microphone / audio transcription ("Mikrofon w czacie", HANDOFF.md:50) — the
  `voiceInput` param and `ai_calls.purpose = 'transcription'` are already
  provisioned for it, but it is out of scope here per the task brief. The mic
  button renders as a visible, clearly-disabled affordance so the card is
  honest about what exists (per the "no placeholder-as-real" constraint
  `[node:4a749051]`), not wired to a live transcription call.
- Changing `docs/handoff/layout.schema.yaml` or `layout.yaml` — the `chat`
  card's param contract is already exactly what this plan needs.
- Any change to `src/server/db/schema.ts`, `drizzle/*.sql`, or the
  `ConversationRepository`/`AiCallRepository` *port* shape — those already
  cover everything this plan needs except one additive method (see Phase 3).
- Real token counting via a tokenizer library — an approximate `length/4`
  heuristic is used for budgeting (documented, tested at its boundaries). A
  real tokenizer is a future refinement, not required for a kitchen kiosk's
  rolling-window budget to be safe (the hard drop-oldest fallback in Phase 2
  guarantees the gateway is never handed more than its context window
  regardless of estimator error).

## Phase 1 — Kilo Gateway client + model catalog

Files: `src/server/upstream/kilo.ts` (new), `test/kilo.test.ts` (new).

- `fetchModels(baseUrl?): Promise<GatewayModel[]>` — `GET {base}/models`, no
  auth (matches `[node:279d73e0]`). Maps the raw catalog entry to:
  ```ts
  interface GatewayModel {
    id: string                 // "provider/model-name"
    name: string
    contextLength: number
    maxCompletionTokens: number
    pricing: { promptUsdPerToken: number; completionUsdPerToken: number } | null // null when unpriced ("-1")
  }
  ```
  Pricing `"0"` → `{0, 0}` (free); `"-1"` → `null` (auto-router models report
  no fixed price — cost math for these can't be computed from the catalog and
  falls back to the gateway's own reported `usage.cost` if present, else 0
  with a `[!]`-worthy note — handled in Phase 2/3, not here).
- `chatCompletion(request, opts): AsyncGenerator<GatewayChunk>` — always calls
  with `stream: true` + `stream_options.include_usage: true`. Hand-rolled SSE
  parse over the `Response.body` reader (no library — matches the "no
  unnecessary dependency" precedent in `upstream/open-meteo.ts`): split on
  `\n\n`, skip lines starting with `:` (comments/keepalives) and blank lines,
  strip the `data: ` prefix, stop the generator on the literal `[DONE]`,
  `JSON.parse` everything else and yield it typed as `GatewayChunk`.
- Base URL overridable via `K7_KILO_GATEWAY_URL` (default
  `https://api.kilo.ai/api/gateway`), same override pattern as
  `K7_OPEN_METEO_URL` — lets tests run against a local stub server instead of
  the real gateway.
- Auth: `Authorization: Bearer ${apiKey}` attached whenever
  `config.kiloGatewayKey` is set; omitted otherwise (the free tier answers
  without one, verified above, but paid/rate-limited models need it).
- `fetchWithTimeout`-style deadline reused/adapted for the non-streaming call;
  the streaming call gets a longer, caller-supplied timeout since a chat
  response is not bounded like a weather poll.

**Model catalog caching**: a thin `createModelCatalog(cache: UpstreamCacheRepository, client)`
in the same file, using `upstream: 'kilo-gateway'` (already a valid enum
value in `schema.ts:120`) via the existing `createFreshnessService` —
`freshForSeconds: 3600` (model list and pricing change rarely; the household
does not need per-request freshness here the way weather does).

**Verification**: `node --test test/kilo.test.ts` — SSE parser fed canned
frames (including a keepalive comment line and `[DONE]`) reproduces the exact
delta/usage sequence observed live; model-mapping test covers `"-1"`/`"0"`/
real-decimal pricing.

## Phase 2 — ConversationService (the architecturally sensitive piece)

Files: `src/server/ai/tokens.ts` (new), `src/server/ai/conversation-service.ts`
(new), `test/conversation-service.test.ts` (new).

This is what `[node:4730c1bc]` (CONVSERVICE, lifetime constraint) requires:
decoupled from the HTTP route, so a future MCP tool or skill can drive a
conversation turn without knowing Fastify exists. The interface is a plain
async generator over domain-shaped events — no `Request`/`Reply` anywhere in
this file.

```ts
// tokens.ts
export function estimateTokens(text: string): number // Math.ceil(text.length / 4), floors at 0/empty

// conversation-service.ts
export interface ChatTurnInput { conversationId: string; model: string; userContent: string }

export type ChatEvent =
  | { type: 'compacting'; summarisedMessageCount: number }
  | { type: 'delta'; content: string }
  | { type: 'done'; message: Message; usage: { promptTokens: number; completionTokens: number; costUsd: number } }
  | { type: 'error'; error: string }

export interface ConversationService {
  streamTurn(input: ChatTurnInput, signal?: AbortSignal): AsyncGenerator<ChatEvent>
}

export function createConversationService(deps: {
  conversations: ConversationRepository
  aiCalls: AiCallRepository
  modelCatalog: { get(modelId: string): Promise<GatewayModel | undefined> }
  gateway: Pick<KiloGatewayClient, 'chatCompletion'>
  compactingModel?: string        // default 'kilo-auto/efficient' — a real, live model id
  now?: () => Date
}): ConversationService
```

**Budgeting** (per-model, from `[node:f29aa338]` Model's `contextWindow`):
- `historyBudgetTokens = floor(contextLength * (1 - contextWindowMarginPercent/100))`
- `compactingTriggerTokens = floor(historyBudgetTokens * compactingThresholdPercent/100)`
  (both params come from the `chat` card's params, passed through by the
  route — the service takes them as plain numbers, never reads layout.yaml
  itself).

**Turn algorithm** (`streamTurn`):
1. Persist the incoming user `Message` immediately (so a mid-stream failure
   still leaves the user's own text in history — matches the shopping-list
   precedent of "server-confirmed" writes, applied to the one write that
   cannot be retried invisibly).
2. Load `conversations.messages(conversationId)`, oldest-first (already the
   port's contract).
3. If any message has `role === 'system'` and a `content` starting with the
   sentinel `[COMPACT]`, treat only messages **from the most recent such
   message onward** as the working window (older ones stay in the DB,
   untouched, for the transcript view — they're just excluded from what's
   sent to the model).
4. Sum `estimateTokens(content)` over the working window. If it exceeds
   `compactingTriggerTokens`:
   - Split the window into "head" (all but the last 4 messages) and "tail"
     (last 4, kept verbatim — recent turns are what coherence most depends
     on).
   - Call `gateway.chatCompletion` **non-streaming**, `model: compactingModel`,
     a system prompt asking for a compact factual summary of the head
     messages.
   - Persist the summary as a new `Message` with `role: 'system'`,
     `content: '[COMPACT] ' + summary`.
   - Record an `ai_calls` row: `purpose: 'compacting'`, the compacting
     model's id, real `usage` from that call, cost computed from its
     catalog price (or 0 if the catalog has no price for it — see Phase 1).
   - Yield `{ type: 'compacting', summarisedMessageCount: head.length }`.
   - Recompute the working window as `[summary, ...tail]`.
5. **Hard safety net, independent of compacting**: if the working window
   (post-compaction) still exceeds `historyBudgetTokens` (a pathological
   single huge message, or compacting itself producing a long summary), drop
   the oldest non-summary messages from the window one at a time until it
   fits. This is the literal "rolling window" — it never fails open by
   sending an over-budget request to the gateway.
6. Call `gateway.chatCompletion` streaming, `model: input.model`, messages =
   the working window + the new user message. For each `GatewayChunk`, yield
   `{ type: 'delta', content }` for non-empty `delta.content`.
7. On the final chunk carrying `usage`, persist the assistant `Message`,
   record an `ai_calls` row (`purpose: 'chat'`, `messageId` set to the new
   assistant message, cost from the catalog price for `input.model` — 0 with
   the event still carrying real token counts if the model is unpriced),
   and yield `{ type: 'done', message, usage: {...costUsd} }`.
8. Any thrown error (network, gateway 4xx/5xx, abort) is caught, yielded as
   `{ type: 'error', error }`, and does **not** record a spent `ai_calls` row
   unless a `usage` was actually received first (a failed call before any
   token was billed logs nothing — matches "estimated, not billed" honesty
   already established for `estimatedCostUsd`).

**Verification**: `test/conversation-service.test.ts` against fakes (no real
gateway/model-catalog calls) — asserts (a) a small `contextLength` triggers
compacting at the documented threshold, not before/after by one message;
(b) the tail is always preserved verbatim; (c) `ai_calls` rows are recorded
with the right `purpose`/`model`/cost for both a chat turn and a compaction;
(d) the hard-drop safety net engages when a fake compaction still leaves the
window oversized; (e) an unpriced model still produces a `usage`-carrying
`done` event with `costUsd: 0` rather than throwing; (f) `estimateTokens`
edge cases (empty string, very long string, unicode).

## Phase 3 — Chat routes (SSE) + cost history

Files: `src/server/routes/chat.ts` (new — kept out of `index.ts` on purpose,
see the captured constraint on that file being shared with sibling
worktrees), `src/server/ports/repositories.ts` (additive: one new method),
`src/server/adapters/drizzle/index.ts` (additive: implement it),
`src/server/index.ts` (~4-line additive diff), `test/chat-routes.test.ts` (new,
using Fastify's `.inject()`).

- `AiCallRepository.listRecent(limit?: number): Promise<AiCall[]>` — added to
  the port and implemented in the Drizzle adapter (`orderBy(desc(createdAt))`,
  mirrors the `conversations.list` shape already there). Additive only; no
  existing method's signature changes.
- `registerChatRoutes(app, { repos, modelCatalog, gateway, config })` exported
  from the new module; `index.ts` gains one import and one
  `await registerChatRoutes(app, { repos, ... })` call, inserted right after
  the shopping-list routes and before the shared error handler — a small,
  clearly-bounded block per `[node:5c914a38]`/`[node:ff9ca87f]` (the
  "index.ts is shared, keep additions minimal" finding captured independently
  twice during research — see Rules note below).
- Routes:
  - `GET /api/gateway/models` — cached catalog from Phase 1, mapped to the
    slim client-facing shape (id, name, contextLength, pricing-or-null).
  - `GET /api/chat/conversations?limit=` / `POST /api/chat/conversations`
    (`{ model, title? }`) — thin wrappers over the existing repo.
  - `GET /api/chat/conversations/:id/messages` — thin wrapper (used by the
    card to hydrate history on mount/reopen).
  - `POST /api/chat/conversations/:id/messages` — the SSE endpoint. Body
    `{ content: string }`. Sets
    `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache`,
    `connection: keep-alive`, calls `reply.hijack()`, iterates
    `conversationService.streamTurn(...)`, writes each `ChatEvent` as
    `event: <type>\ndata: <json>\n\n`, ends the raw response on generator
    completion or client abort (`req.raw.on('close', ...)` → `AbortController`).
  - `GET /api/chat/cost-history?days=` — `{ recent: AiCall[], totals: { calls, costUsd } }`
    using `listRecent` + the existing `totalCostSince`. This is the "simple
    cost-history view" the task asks for; exposed as JSON and surfaced
    minimally in the card footer (Phase 4) rather than as a new card type
    (no `cost-history` entry exists in `layout.schema.yaml`'s card enum, and
    adding one is out of this plan's scope per Non-goals).
- Every route sits behind the existing `onRequest` private-network/host-allowlist
  hook already registered in `index.ts` — nothing new to add there.
- Errors from the gateway/service reach `Sentry.captureException` scrubbed the
  same way every other route's errors do (`[node:ac006a24]`,
  `[node:62d2072b]`) — chat message *content* is deliberately not added to the
  scrubber's sensitive-key patterns (it is not a secret), only the existing
  `KILO_GATEWAY_KEY` exact-value + pattern layers apply, which already cover
  it via `secretValues(config)`.

**Verification**: `test/chat-routes.test.ts` using `app.inject()` against a
fake gateway/model-catalog wired into `registerChatRoutes` (no live network),
asserting conversation CRUD, that the SSE body contains the expected
`event:`/`data:` frames in order, and that `/api/chat/cost-history` reflects
recorded `ai_calls` rows.

## Phase 4 — K7Chat.svelte + Storybook story

Files: `src/client/lib/K7Chat.svelte` (new), `src/client/lib/K7Chat.stories.ts`
(new).

- `<svelte:options customElement={{ tag: 'k7-chat', props: {...} }} />`,
  following the `K7Weather`/`K7ShoppingList` convention exactly: string-typed
  attrs with sane defaults (`defaultModel`, `availableModels` as a
  JSON-encoded string attr parsed with a guarded `JSON.parse`,
  `contextWindowMarginPercent`, `compactingThresholdPercent`, `voiceInput` as
  `'true'|'false'` strings).
- Model picker: if `availableModels` is non-empty, use it directly; else fetch
  `/api/gateway/models` once on mount and populate the `<select>` from that
  (per the schema's documented "empty ⇒ fetch dynamically" rule).
- On first send with no conversation yet: `POST /api/chat/conversations`
  lazily, then proceed. Message list renders user/assistant turns
  top-to-bottom scrolled to bottom; streaming assistant text appended
  token-by-token as `delta` events arrive (via hand-rolled SSE reading:
  `fetch(url, { method: 'POST', body, signal }).body.getReader()`, decoded
  with `TextDecoder`, split on blank lines — mirrors the parser written for
  the server in Phase 1 but client-side, since `EventSource` cannot POST a
  body).
  - This introduces **the same SSE-frame-parsing logic twice** (server → gateway,
    browser → server) by necessity — genuinely different environments (`fetch`
    reader vs. Node stream), not a copy-paste that should be deduplicated into
    a shared module across the client/server boundary. Noted rather than
    silently duplicated.
- `cardState`: `'fail'` on a failed send/stream error, `'idle'` while a
  response is streaming, `'ok'` once a turn completes, matching the
  `K7Weather`/`K7ShoppingList` state-derivation pattern.
- Mic affordance (`voiceInput === 'true'`): a visible button, disabled,
  `title="transkrypcja audio — wkrótce"` — present because the feature is
  decided (HANDOFF.md), honest that it does not work yet (per
  `[node:4a749051]`'s no-placeholder-as-real rule, applied here to a disabled
  affordance rather than fabricated data).
- Footer/meta line: pulls `/api/chat/cost-history` totals once on mount (and
  after each completed turn) to show something like `koszt dziś: $0.0031` in
  the card's `meta` slot — the minimal cost-visibility surface from the task
  brief, without a dedicated card type.
- CSS: tokens only, matching `K7ShoppingList.svelte`'s `.wrap`/scroll pattern
  for the message list, ghost-button styling for send/mic (at most one solid
  amber control — the send button — per `[node:a827e6ec]`).
- Story: `K7Weather.stories.ts` (on the unmerged sibling branch
  `change/k7-faza1-rest`, commit `0c06c4a` — not yet on `main`, read directly
  via `git show` rather than assumed) already establishes the house pattern
  for a fetching card's stories: a `withFetch(stub): Decorator` helper that
  swaps `window.fetch` for the story's duration and restores it via
  `queueMicrotask` after the component's own `$effect` has dispatched its
  request, with `Loaded`/`Stale`-or-equivalent/`Empty` (a fetch that never
  resolves, for the pre-first-paint state)/`Failed` stories. `K7Chat.svelte`'s
  story reuses this exact `withFetch` shape rather than inventing a new one,
  extended so the stub can return a streaming `Response` (a real
  `ReadableStream` body emitting SSE frames) for the send-message stories —
  the one genuinely new piece, since no existing story streams. If
  `change/k7-faza1-rest` merges before this change, import `withFetch` from
  wherever it lands (check for a shared test-helper extraction first); if it
  merges after, keep a local copy here and flag the duplication for
  `/gw-consolidate` rather than blocking on merge order.

**Verification**: `npm run storybook` renders all four states without a real
backend; `npm run typecheck` (svelte-check) passes.

## Phase 5 — wrap-up

- `npm run check` (lint, token contract, `node --test`, build) green.
- `context/changes/k7-ai-chat/change.md` status → `implemented` (or whatever
  the convention is at PR time — check a prior change's change.md for the
  exact terminal status word before writing it).
- Memory: capture the phase-boundary decisions below; journal `USED`/
  `CONFIRMED` for every recalled node this plan leaned on.
- Open a PR against `main`, flagging in the description:
  1. The chat-completions/model-catalog contract was verified against the
     **live** Kilo Gateway during planning (no key required for `/models` or
     the free tier) — a human should re-verify paid-model behaviour (auth
     header, rate limits, non-free pricing) once a real `KILO_GATEWAY_KEY` is
     available in the deployment environment, since none was available in
     this worktree.
  2. The `contextWindowMarginPercent`/`compactingThresholdPercent` semantics
     (percent of the *whole* context window reserved for response vs.
     percent of the *history budget* that triggers compacting) are this
     plan's reading of a one-line schema description each — worth a human
     sanity check against actual usage before tuning defaults.
  3. Cost history ships as a JSON endpoint + a one-line card footer, not a
     dedicated view/card type, per the task's "keep it minimal" instruction —
     flag if a fuller dashboard is wanted later (would need a
     `layout.schema.yaml` card-type addition, out of this plan's scope).
  4. Microphone/transcription is deferred in full (UI affordance only, no
     wiring) — `purpose: 'transcription'` and `voiceInput` are already
     provisioned in the schema for whoever picks it up.
  5. Two independent research passes both captured a near-duplicate
     "`index.ts` is a shared flat file" constraint to the graph
     (`[node:5c914a38]` and `[node:ff9ca87f]`) because a research subagent
     forked mid-session and duplicated the finding — worth a human
     `/gw-consolidate` pass later; not resolved here per the "never merge
     graph nodes without a human" rule.
  6. **Duplicate Kilo Gateway client across sibling branches.** The Faza 5
     branch (`change/k7-image-widgets`) independently built its own client
     at `src/server/upstream/kilo-gateway.ts` for `ascii-art-of-the-day`
     (`[node:6645438f]`, `[node:6a05648a]`) — inferred from HANDOFF.md,
     never verified live, because Faza 4 hadn't landed in that worktree yet
     when Faza 5 started. This plan's client (`src/server/upstream/kilo.ts`,
     Phase 1) *is* live-verified against the real gateway (`[node:b30b1c95]`)
     and should be treated as the canonical one; a human should diff the two
     at merge time and have Faza 5 adopt this one rather than shipping two
     independent wire-format guesses for the same upstream. Not resolved
     here — cross-branch code, not something this change can safely touch.

## Risks

- **Token estimator inaccuracy** — mitigated by the hard rolling-window
  safety net in Phase 2 step 5, which is estimator-independent (it re-checks
  actual `estimateTokens` sums after every drop, not a one-shot guess).
- **Gateway contract drift** (Kilo Gateway changes its response shape) — the
  client in Phase 1 is the single seam; a live-format change breaks tests
  there first rather than surfacing as a silent UI failure.
- **SSE through Fastify's `hijack()`** is less common than a normal handler —
  mitigated by testing the exact frame sequence via `.inject()` in Phase 3
  rather than only eyeballing it in the browser.
- **Shared-file merge risk** (`index.ts`) — mitigated by keeping the whole
  chat-route surface in its own module and touching `index.ts` for only the
  import + one registration call.

## Captured decisions

See the `capture_artifact` calls made alongside this plan (node ids reported
in the hand-off message) — the `ConversationService` interface shape, the
compacting-summary sentinel-message design, and the routes-in-their-own-module
convention for shared-file additions.
