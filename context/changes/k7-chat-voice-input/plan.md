# Plan — k7-chat-voice-input

Goal: [node:243ffaa5] enable the chat card's mic button, record with
MediaRecorder, transcribe server-side via Kilo Gateway, populate the compose
field without auto-sending.

No new domain entities (`domain_model()` checked — AiCall/Conversation/Card
already cover this; "transcription" is an existing `AiCall.purpose` value, not
a new entity).

## Non-goals
- No changes to `src/client/main.ts` (out of scope; a sibling change owns it).
- No new Fastify plugin dependency (`@fastify/multipart` etc.) — see phase 2.
- No auto-send of the transcript; it only populates the input field.
- Not wiring a `conversationId` into the transcribe call — transcription
  happens before a conversation necessarily exists (the household may record
  before typing/sending anything), so `AiCall.conversationId` stays `null`,
  same as `ascii-art`'s `purpose`.

## Phase 1 — extend `src/server/upstream/kilo.ts` with `transcribeAudio`
- Add `transcribeAudio(audio: { data: Buffer; contentType: string }, opts?: {
  model?: string; signal?: AbortSignal }): Promise<{ text: string }>` to
  `KiloGatewayClient` and its `createKiloGatewayClient` implementation.
- Build the request as `multipart/form-data` using Node's global `FormData`/
  `Blob` (already available, no new dependency): `file` (the audio Blob,
  named `audio.<ext-from-contentType>`) + `model`. Only send an
  `authorization` header — no `content-type`, so `fetch` sets the multipart
  boundary itself (unlike `buildHeaders`, which always sets
  `content-type: application/json`; add a small separate header builder for
  this call, or an `includeJsonContentType` flag).
- Add `DEFAULT_TRANSCRIPTION_MODEL = 'thinkingmachines/inkling-small:free'`
  (one of the three free audio-input models found live — [node:ee4cadd2]),
  overridable via `K7_KILO_TRANSCRIPTION_MODEL` env var, mirroring the
  existing `K7_KILO_GATEWAY_URL` override pattern — this is the escape hatch
  for the unverified contract ([node:2704bad5]): an operator can repoint it
  without a code change if the assumption is wrong.
- Response is parsed as `{ text: string }` (OpenAI-Whisper shape) — **this
  parsing is the unverified part**, called out in the module doc comment the
  same way the existing top-of-file comment documents the verified
  chat-completions contract, so the two are never confused for equally solid.
- Doc-comment at the top of the new section states plainly: verified live
  that `POST {base}/audio/transcriptions` is a real, distinct route
  ([node:2704bad5]); the field names/response shape are a documented
  best-effort OpenAI-Whisper-style guess, not verified, because no real
  `KILO_GATEWAY_KEY` was available to complete an authenticated call.

**Verify:** `npm run build` (typecheck) + new pure-function coverage if any
helper is extracted (e.g. a content-type→file-extension mapper).

## Phase 2 — server route `POST /api/chat/transcribe`
- In `src/server/routes/chat.ts` (`ChatRouteDeps` gains
  `kiloGateway: Pick<KiloGatewayClient, 'transcribeAudio'>`, reusing
  `deps.aiCalls` and `deps.modelCatalog` already present) — keeps the route
  surface in its existing module rather than adding a third file, matching
  how `registerChatRoutes` already owns everything chat-shaped.
- Register `app.addContentTypeParser(/^audio\//, { parseAs: 'buffer' },
  (req, payload, done) => done(null, payload))` once, inside
  `registerChatRoutes` — [node:16b0ad21]: no multipart dependency needed,
  since the client sends exactly one raw audio body and no other fields.
  Confirmed this is safe to add on the shared `app` instance: no existing
  route uses an `audio/*` content-type, so the new parser cannot shadow
  anything.
- `app.post('/api/chat/transcribe', { bodyLimit: 10_000_000 }, ...)` — the
  Fastify default (1 MB) is too small for a several-minutes voice note;
  10 MB covers a long compressed clip with headroom. Reject with 400 if
  `req.body` isn't a non-empty `Buffer` or if `content-type` doesn't start
  with `audio/`.
- Call `deps.kiloGateway.transcribeAudio({ data: req.body, contentType:
  req.headers['content-type'] })`, then `deps.aiCalls.record({
  conversationId: null, messageId: null, purpose: 'transcription', model:
  <the model actually used>, promptTokens: 0, completionTokens: 0,
  estimatedCostUsd: 0 })` — **decision**: Whisper-style transcription
  responses carry no `usage`, so cost logging degrades to 0 rather than
  inventing a token estimate from audio duration/file size, matching how
  `ascii-art.ts` already tolerates a best-effort-only catalogue lookup rather
  than failing the primary action over bookkeeping.
- Errors: caught and reported via `deps.reportError(err, { model })` —
  **never** `{ audio: ... }` or `{ transcript: ... }` in `extra`, mirroring
  [node:a1245ccd]'s "chat content never reaches Sentry extra" precedent
  applied to audio/transcript content. Respond `502` with a generic
  `{ error: 'transcription failed' }` (no upstream error text passed
  through, since it could echo back request content).
- Wire the new dep at the one call site in `src/server/index.ts`
  (`await registerChatRoutes(app, { ..., kiloGateway: kiloClient })`) — the
  existing `kiloClient` already built there; only the deps-object literal
  changes, no new construction.

**Verify:** `test/chat-routes.test.ts` additions (phase 5) via
`app.inject()`.

## Phase 3 — `layout.yaml`
- Add `voiceInput: true` to the `czat` card's `params` (root `layout.yaml`,
  currently only `defaultModel` — [node:5e767aff]).

**Verify:** `npm run tokens:check` / layout validation already run by
`npm run check`; manual read-through that the YAML still parses.

## Phase 4 — `K7Chat.svelte` mic UI
- Feature-detect once, outside any click handler: `mediaSupported =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  && typeof MediaRecorder !== 'undefined'`. `showMic` becomes `voiceInput ===
  'true' && mediaSupported` — an unsupported browser (this is exactly the
  iPad Air 2 / Safari 15 risk the task calls out) never shows a button that
  would break on click, per [node:2946e332]'s "never render a dead control"
  discipline (the audiometer's version of this problem is permission, not
  support, but the same rule applies).
- Local phase state machine (separate from the audiometer's `Phase` type,
  but same shape): `'idle' | 'pending' | 'recording' | 'transcribing'`.
  Never touches `getUserMedia` except from the click handler — no
  request-on-mount, per [node:2946e332].
- Click while `idle`: `micPhase = 'pending'`; `getUserMedia({ audio: true })`;
  on success, pick the first supported `MediaRecorder` mime type from a
  candidate list (`audio/webm;codecs=opus`, `audio/webm`, `audio/mp4`,
  `audio/mp4;codecs=mp4a.40.2`) via `MediaRecorder.isTypeSupported`, falling
  back to the browser default (no `mimeType` option) if none match — Safari
  does not reliably support WebM-in-MediaRecorder the way Chromium does, so
  the implementation must not hardcode `audio/webm` despite it being
  MediaRecorder's default on Chromium; `recorder.mimeType` (the type the
  browser actually used) is what gets sent as the upload's `content-type`,
  not the requested one. `recorder.start()`; `micPhase = 'recording'`.
  On failure: teardown, `micPhase = 'idle'`, `failed = true`, `errorText`
  set from `err.name` (`NotAllowedError`/`SecurityError` → permission
  denied message, `NotFoundError` → no microphone, else generic) — same
  mapping shape as `K7Audiometer.svelte`'s `enableMic` catch block.
- Click while `recording`: `recorder.stop()`; on the recorder's `stop`
  event, build a `Blob` from the collected chunks with `type:
  recorder.mimeType`, stop every `stream` track (release the mic
  immediately, before the network call — [node:2946e332]), `micPhase =
  'transcribing'`, `POST /api/chat/transcribe` with `body: blob`, `headers:
  { 'content-type': blob.type }`. On success: `input = (await
  res.json()).text` (trimmed) — **not** sent, just placed in the existing
  `input` state the composer already binds to. On failure: `failed = true`,
  `errorText = ...`. Always end in `micPhase = 'idle'`.
- Teardown: extend the existing `$effect` cleanup (the one that already
  aborts `controller` on unmount) to also stop any live `stream`/`recorder`
  — a card that can be destroyed and recreated (theme/layout reload) must
  not leak an open microphone, per [node:2946e332]'s audiometer precedent.
- Button label/aria-label changes per phase (bracket-glyph convention,
  [node:9b0e63ee] — colour never carries state alone): `[MIC]` idle,
  `[MIC...]` pending (disabled), `[● REC]` recording, `[...]` transcribing
  (disabled). A small pulsing dot on `recording` animates `opacity` only
  (never `box-shadow`/`filter`, per [node:716987ce]'s per-frame-cost
  constraint) using `var(--warn)` — an attention colour, never `var(--accent)`
  amber, matching [node:ff852de4] ("warn and fail are never amber", applied
  here to "this control is doing something urgent-looking"); the animation
  respects `prefers-reduced-motion`. All colours/spacing/radii come from
  existing tokens already used elsewhere in this file — no new hex.
- Errors reuse the composer's existing `failed`/`errorText` display (no new
  UI region) — consistent with how a failed chat send is already shown.

**Verify:** `npm run build:storybook` (component still registers/renders as
a custom element); manual reasoning only for the MediaRecorder flow itself,
since it needs a real browser + real microphone hardware to exercise fully
— flagged in the PR as something to smoke-test on the actual iPad.

## Phase 5 — tests
- `test/chat-routes.test.ts`: add a `fakeKiloGateway` implementing
  `Pick<KiloGatewayClient, 'transcribeAudio'>` (mirrors the existing
  `fakeGateway` for chat completions); assert `POST /api/chat/transcribe`
  with an `audio/webm` body returns `{ text }`, records an `AiCall` with
  `purpose: 'transcription'` and 0 cost, rejects a non-audio content-type
  with 400, and that a thrown `transcribeAudio` error reaches
  `reportError` without the audio buffer or transcript text in `extra`
  (mirrors the existing "no chat content in extra" assertion style if one
  exists in this file, else a new explicit assertion) — this is the
  redaction precedent [node:a1245ccd] proven on the route, not just assumed.
- `test/kilo.test.ts`: if a pure helper is extracted in phase 1 (content-type
  → filename/extension mapping, or multipart-field assembly), give it direct
  unit coverage the same way `mapGatewayModel`/`estimateCostUsd` are tested
  now; the network call itself stays exercised only through the route test's
  fake, matching how `chatCompletion`/`chatCompletionOnce` are already
  untested directly in `kilo.test.ts` today.

**Verify:** `node --test` (or whatever `npm test` wraps) green.

## Final gate (before PR)
`npm run check` (lint + token contract + `tokens:check` + tests + build) AND
`npm run build:storybook`, both green. Fix anything either flags.

## Flagged for human decision (state in PR)
1. **Unverified transcription contract** [node:2704bad5] — built against the
   OpenAI-Whisper-style multipart assumption; the live gateway confirms the
   route exists but not its field/response shape (no real API key available
   here). `K7_KILO_TRANSCRIPTION_MODEL` env override is the mitigation.
2. **Default transcription model choice** [node:ee4cadd2] —
   `thinkingmachines/inkling-small:free` picked because it's free and
   declares audio input support; nobody has confirmed it actually performs
   well at transcription (vs. some other audio-input model) or that it's the
   model `/audio/transcriptions` expects at all.
3. **MediaRecorder codec assumption in the original task brief was wrong**
   for Safari — WebM/Opus is not reliably supported there, corrected to a
   runtime `isTypeSupported` probe with an `audio/mp4` fallback; worth an
   explicit smoke test on the real iPad Air 2 per [node:0bc7e618].
