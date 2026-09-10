# Research — k7-chat-voice-input

## Recall (seed)
Confirmed relevant settled knowledge: chat card's `voiceInput` param already exists
in the schema contract [node:c83ab909] (default false); microphone-never-on-mount
UX pattern from the audiometer card [node:2946e332] (explicit control, pending/off/
failure+retry states, release stream on teardown); secrets server-side only
[node:ac006a24]; chat routes never leak message content into Sentry/logs
[node:a1245ccd]; Kilo Gateway chat-completions contract verified live 2026-09-09
[node:b30b1c95] (that verification covered chat/completions only, not transcription).

## Questions and answers

1. **K7Chat.svelte mic button state** — `src/client/lib/K7Chat.svelte:26,53,61,64,278`.
   `voiceInput` is already a reflected custom-element prop, `showMic` is already
   derived (`voiceInput === 'true'`), and a disabled placeholder button already
   exists inside `{#if showMic}` at line 277-280. The integration point is: replace
   the `disabled` placeholder with a real click handler using MediaRecorder, keep
   the `{#if showMic}` gate, and add a runtime MediaRecorder/getUserMedia
   availability check so unsupported browsers don't show a broken control.

2. **`src/server/upstream/kilo.ts` shape** — read in full. Exports
   `createKiloGatewayClient` returning `{ fetchModels, chatCompletion,
   chatCompletionOnce }`, plus `estimateCostUsd`, `createModelCatalog`. This is the
   file to extend with a `transcribeAudio` method, following the same
   `buildHeaders`/`baseUrl` pattern as the existing methods.

3. **Live gateway reachability + `/audio/transcriptions` contract** — the gateway
   IS reachable from this sandbox (`GET /api/gateway/models` returned HTTP 200,
   368 models). `POST /api/gateway/audio/transcriptions` is confirmed to be a real,
   distinct serverless route via the `x-matched-path` response header (unlike a
   genuinely unknown path such as `/api/gateway/audio/speech`, which falls through
   to a catch-all "only accepts /chat/completions" error). **Its exact request
   contract could not be verified live**: every unauthenticated attempt (JSON,
   multipart/form-data, with/without a fake bearer token) returned the same
   generic `{"error":"Invalid request","error_type":"invalid_request","message":
   "Could not parse request body. Please ensure it is valid JSON."}` — this
   sandbox has no real `KILO_GATEWAY_KEY` (secrets are server-side only, by
   design). Captured as [node:2704bad5] (issue, unverified contract). No
   Whisper-named model exists in the catalogue; 33 models declare `audio` in
   `input_modalities` (multimodal chat models), 3 of them free — captured as
   [node:ee4cadd2] (concept).
   **Decision for this change**: build `transcribeAudio` against the documented
   best-effort assumption (OpenAI-Whisper-style `multipart/form-data`, fields
   `file` + `model`, response `{ text }`), matching the discipline the Faza 5
   ascii-art client used for an unverified guess [node:6645438f] — and flag this
   clearly in the PR.

4. **`src/server/index.ts` multipart/raw-body registration** — grepped: no
   `@fastify/multipart`, no `addContentTypeParser`, no raw-body handling anywhere.
   `package.json` has no multipart dependency at all. Captured as [node:16b0ad21]
   (constraint). **Decision**: avoid a new dependency — register a raw
   `addContentTypeParser` for `audio/webm` (and a couple of safe fallbacks) on the
   new route only, buffering the raw bytes, instead of adding `@fastify/multipart`
   for what is a single-file, no-other-fields upload.

5. **`layout.yaml` chat card params** — root `layout.yaml:62-65`, `id: czat`,
   `type: chat`, `params: { defaultModel: "kilo-auto/free" }` only. No
   `voiceInput` key, so the mic button will never render until this is added.
   Captured as [node:5e767aff] (issue). **Action**: set `voiceInput: true`.

6. **`AiCallRepository`/`estimateCostUsd` precedent** —
   `src/server/upstream/ascii-art.ts`'s `createAsciiArtGenerator` is the clean
   precedent: call the gateway, catch a model-catalog lookup failure without
   failing the generation, then `aiCalls.record({ conversationId: null,
   messageId: null, purpose: 'ascii-art' | ..., model, promptTokens,
   completionTokens, estimatedCostUsd: estimateCostUsd(usage, pricing) })`.
   `schema.ts`'s `aiCalls.purpose` enum already includes `'transcription'`
   (confirmed at `src/server/db/schema.ts:94`). The transcription response will
   not carry `prompt_tokens`/`completion_tokens` in the OpenAI-Whisper shape (no
   `usage` object at all in that API) — cost logging for `purpose: 'transcription'`
   will need a fallback (0 cost, or a token estimate from audio duration/file
   size) since the standard Whisper response has no token usage to bill from.

7. **`redact.ts` coverage** — generic scrubber (exact-value + pattern layers),
   content-agnostic. Per the existing chat-routes precedent [node:a1245ccd], the
   transcribe route must not pass audio bytes or transcript text into
   `Sentry.captureException`'s `extra` — same reasoning as chat message content,
   applied to audio content.

## Captured nodes
- [node:2704bad5] issue — `/audio/transcriptions` route confirmed real, contract unverified
- [node:ee4cadd2] concept — no Whisper model, audio-input chat models incl. 3 free
- [node:16b0ad21] constraint — no multipart dep/raw-body registration in index.ts yet
- [node:5e767aff] issue — layout.yaml's czat card doesn't set voiceInput

## Route to /gw-plan
No new domain entities needed (`domain_model()` checked — AiCall/Message/
Conversation already cover this feature; "transcription" is a `purpose` value,
not a new entity). Proceeding to `/gw-plan`.
