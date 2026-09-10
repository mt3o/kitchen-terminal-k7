/**
 * Kilo Gateway: the AI chat upstream.
 *
 * Verified live against the real gateway while planning this module (2026-09-09):
 * `GET {base}/models` needs no auth and returns `{ data: GatewayModelRaw[] }`, and
 * `POST {base}/chat/completions` is byte-for-byte OpenAI-compatible — the same
 * request/response shape whichever `provider/model-name` you address. Streaming
 * (`stream: true`) yields SSE frames of `{ choices: [{ delta: { content } }] }`,
 * a `: KILO PROCESSING` comment/keepalive line that is not JSON and must be
 * skipped, a final chunk carrying `usage` (when `stream_options.include_usage`
 * is set), and a literal `data: [DONE]`.
 *
 * No AI SDK or SSE library is added for this: one streaming endpoint does not
 * justify a new dependency, and the project already has exactly this shape of
 * hand-rolled client for Open-Meteo (`upstream/open-meteo.ts`).
 *
 * `transcribeAudio` (added for k7-chat-voice-input) is a different story:
 * `POST {base}/audio/transcriptions` was confirmed live (2026-09-10) to be a
 * real, distinct route — its `x-matched-path` response header names it
 * exactly, unlike a genuinely unimplemented path (e.g. `/audio/speech`),
 * which falls through to a catch-all "only accepts /chat/completions" error.
 * Its *request contract*, however, could NOT be verified live: every
 * unauthenticated attempt (JSON body, multipart body, with/without a fake
 * bearer token) returned the same generic "Could not parse request body"
 * error before any auth-specific error appeared, and no real
 * `KILO_GATEWAY_KEY` was available in the sandbox this was built in to get
 * past that. The implementation below is a **documented best-effort
 * assumption** — OpenAI-Whisper-style `multipart/form-data` with `file` +
 * `model` fields, responding `{ text: string }` — not a verified contract
 * like the chat-completions shape above. `K7_KILO_TRANSCRIPTION_MODEL` is
 * the escape hatch: if the assumption is wrong, an operator can repoint the
 * model (or, with a code change, the field shape) without redeploying blind.
 */
import { fetchWithTimeout, type FreshnessService } from './freshness.ts'

const BASE_URL = process.env.K7_KILO_GATEWAY_URL ?? 'https://api.kilo.ai/api/gateway'

/**
 * Reproduced live against the real gateway: a kilo-auto/free ascii-art
 * generation request sat with no response and no error for minutes.
 * Non-streaming, so there is no partial output to show meanwhile — 45s
 * gives a genuinely slow (even auto-routed, even free-tier) completion
 * real room, while still failing fast enough that a kiosk card refreshing
 * on a timer (ascii-art-of-the-day) or a mid-conversation compacting call
 * does not pile up stuck requests indefinitely.
 */
const DEFAULT_CHAT_COMPLETION_ONCE_TIMEOUT_MS = 45_000

/**
 * One of three free audio-input-capable models found live in the gateway's
 * catalogue (2026-09-10) — no Whisper-named model exists, so transcription
 * here means routing audio through a multimodal chat model instead of a
 * dedicated speech-to-text model. Unverified which model `/audio/
 * transcriptions` actually expects; this is a starting default, not a
 * confirmed fit.
 */
const DEFAULT_TRANSCRIPTION_MODEL = process.env.K7_KILO_TRANSCRIPTION_MODEL ?? 'thinkingmachines/inkling-small:free'

/** Model list and pricing change rarely; unlike weather, per-request freshness buys nothing. */
const MODELS_FRESH_FOR_SECONDS = 3600
const MODELS_CACHE_KEY = 'kilo:models'

export interface GatewayModelPricing {
  promptUsdPerToken: number
  completionUsdPerToken: number
}

/** The slim shape this project reasons about — see the Model domain entity. */
export interface GatewayModel {
  id: string
  name: string
  contextLength: number
  maxCompletionTokens: number
  /** `null` when the catalogue reports no fixed price (auto-router entries). */
  pricing: GatewayModelPricing | null
}

interface RawPricing {
  prompt?: string
  completion?: string
}

interface RawModel {
  id: string
  name?: string
  context_length?: number
  top_provider?: { context_length?: number; max_completion_tokens?: number }
  pricing?: RawPricing
}

interface RawModelsResponse {
  data: RawModel[]
}

/** `"-1"` means unpriced, `"0"` means free — both are real prices, not errors. */
function parsePricePerToken(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export function mapGatewayModel(raw: RawModel): GatewayModel {
  const promptPrice = parsePricePerToken(raw.pricing?.prompt)
  const completionPrice = parsePricePerToken(raw.pricing?.completion)
  const pricing =
    promptPrice !== undefined && completionPrice !== undefined
      ? { promptUsdPerToken: promptPrice, completionUsdPerToken: completionPrice }
      : null
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    contextLength: raw.top_provider?.context_length ?? raw.context_length ?? 0,
    maxCompletionTokens: raw.top_provider?.max_completion_tokens ?? 0,
    pricing,
  }
}

export async function fetchModels(baseUrl: string = BASE_URL, timeoutMs?: number): Promise<GatewayModel[]> {
  const res = await fetchWithTimeout(`${baseUrl}/models`, timeoutMs)
  const raw = (await res.json()) as RawModelsResponse
  return (raw.data ?? []).map(mapGatewayModel)
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  /** Injected so a compaction summarisation call can ask for something short. */
  maxTokens?: number
  temperature?: number
  /** Reused verbatim when given (e.g. to reproduce a prior ascii-art-of-the-day result). */
  seed?: number
}

export interface GatewayChunkDelta {
  content?: string
  role?: string
}

export interface GatewayUsage {
  prompt_tokens: number
  completion_tokens: number
}

export interface GatewayChunk {
  choices: { delta: GatewayChunkDelta; finish_reason: string | null }[]
  usage?: GatewayUsage
}

export interface AudioTranscriptionRequest {
  /** Raw audio bytes exactly as recorded — no re-encoding happens on this side of the wire. */
  data: Buffer
  /** The browser's own `MediaRecorder.mimeType` (or the client's declared upload content-type). */
  contentType: string
  /** Defaults to {@link DEFAULT_TRANSCRIPTION_MODEL} when omitted. */
  model?: string
}

export interface KiloGatewayClient {
  fetchModels(): Promise<GatewayModel[]>
  chatCompletion(request: ChatCompletionRequest, opts?: { signal?: AbortSignal }): AsyncGenerator<GatewayChunk>
  /**
   * Non-streaming, single-shot call — used for compacting summaries and
   * ascii-art-of-the-day. `timeoutMs` defaults to
   * {@link DEFAULT_CHAT_COMPLETION_ONCE_TIMEOUT_MS}; a caller-supplied
   * `signal` still cancels the request too, whichever fires first.
   */
  chatCompletionOnce(
    request: ChatCompletionRequest,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<{ content: string; usage: GatewayUsage }>
  /** See the module doc comment: the request contract here is a documented best-effort assumption, not a verified one. */
  transcribeAudio(request: AudioTranscriptionRequest, opts?: { signal?: AbortSignal }): Promise<{ text: string; model: string }>
}

/**
 * Parse one Server-Sent-Events buffer into complete frames plus the leftover
 * partial tail, mirroring the browser's own incremental-decode requirement so
 * the same splitting logic can be reasoned about on both ends of the wire (the
 * client-side reader in K7Chat.svelte re-implements this independently, since
 * it runs in a different environment — see plan.md's note on that).
 */
export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  return { frames: parts, rest }
}

/** A frame may be a comment/keepalive (starts with `:`), blank, or a real `data:` line. */
export function parseSseFrame(frame: string): { data?: string; done?: boolean } {
  const line = frame
    .split('\n')
    .find((l) => l.startsWith('data:'))
    ?.slice('data:'.length)
    .trim()
  if (line === undefined) return {}
  if (line === '[DONE]') return { done: true }
  return { data: line }
}

function buildHeaders(apiKey: string | undefined): HeadersInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  return headers
}

/** No `content-type` here on purpose: a multipart body needs `fetch` to set its own boundary. */
function buildAuthHeader(apiKey: string | undefined): HeadersInit {
  const headers: Record<string, string> = {}
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  return headers
}

/** A filename is required by multipart form conventions even though the gateway (presumably) only reads the bytes and the field's declared type. */
export function fileNameForContentType(contentType: string): string {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  const ext =
    {
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/mp4': 'mp4',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
    }[mime] ?? 'bin'
  return `audio.${ext}`
}

export function createKiloGatewayClient(options: { apiKey?: string; baseUrl?: string } = {}): KiloGatewayClient {
  const baseUrl = options.baseUrl ?? BASE_URL

  async function* chatCompletion(
    request: ChatCompletionRequest,
    opts: { signal?: AbortSignal } = {},
  ): AsyncGenerator<GatewayChunk> {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(options.apiKey),
      signal: opts.signal,
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
      }),
    })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(`kilo gateway responded ${res.status}${text ? `: ${text}` : ''}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, rest } = splitSseFrames(buffer)
        buffer = rest
        for (const frame of frames) {
          const parsed = parseSseFrame(frame)
          if (parsed.done) return
          if (parsed.data === undefined) continue // comment/keepalive line, e.g. ": KILO PROCESSING"
          yield JSON.parse(parsed.data) as GatewayChunk
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async function chatCompletionOnce(
    request: ChatCompletionRequest,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<{ content: string; usage: GatewayUsage }> {
    // fetchWithTimeout (freshness.ts) exists for exactly this: an upstream
    // that accepts the connection and never answers otherwise holds the
    // request open indefinitely. It is GET-only, so this call builds its
    // own AbortController rather than reusing it, merging in the caller's
    // own signal (if any) so either one can cancel the request.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_CHAT_COMPLETION_ONCE_TIMEOUT_MS)
    const onCallerAbort = (): void => controller.abort()
    opts.signal?.addEventListener('abort', onCallerAbort)
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(options.apiKey),
        signal: controller.signal,
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: false,
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.seed !== undefined ? { seed: request.seed } : {}),
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`kilo gateway responded ${res.status}${text ? `: ${text}` : ''}`)
      }
      const json = (await res.json()) as {
        choices: { message: { content: string } }[]
        usage: GatewayUsage
      }
      return { content: json.choices[0]?.message.content ?? '', usage: json.usage }
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onCallerAbort)
    }
  }

  async function transcribeAudio(
    request: AudioTranscriptionRequest,
    opts: { signal?: AbortSignal } = {},
  ): Promise<{ text: string; model: string }> {
    const model = request.model ?? DEFAULT_TRANSCRIPTION_MODEL
    const form = new FormData()
    form.append('model', model)
    form.append(
      'file',
      new Blob([new Uint8Array(request.data)], { type: request.contentType }),
      fileNameForContentType(request.contentType),
    )
    const res = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: buildAuthHeader(options.apiKey),
      signal: opts.signal,
      body: form,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`kilo gateway responded ${res.status}${text ? `: ${text}` : ''}`)
    }
    const json = (await res.json()) as { text?: string }
    if (typeof json.text !== 'string') throw new Error('kilo gateway returned no transcript text')
    return { text: json.text, model }
  }

  return {
    fetchModels: () => fetchModels(baseUrl),
    chatCompletion,
    chatCompletionOnce,
    transcribeAudio,
  }
}

/** `pricing` is `null` for unpriced models (see {@link GatewayModel}) — cost is then 0. */
export function estimateCostUsd(usage: GatewayUsage, pricing: GatewayModelPricing | null): number {
  if (!pricing) return 0
  return usage.prompt_tokens * pricing.promptUsdPerToken + usage.completion_tokens * pricing.completionUsdPerToken
}

/**
 * The model catalogue, cached through the same `upstream_cache` table and
 * `fetchThrough` machinery every other upstream uses — `kilo-gateway` is
 * already a valid `Upstream` enum value (schema.ts) precisely for this.
 */
export interface ModelCatalog {
  list(): Promise<GatewayModel[]>
  get(modelId: string): Promise<GatewayModel | undefined>
}

export function createModelCatalog(fetchThrough: FreshnessService, client: Pick<KiloGatewayClient, 'fetchModels'>): ModelCatalog {
  async function list(): Promise<GatewayModel[]> {
    const aged = await fetchThrough<GatewayModel[]>({
      key: MODELS_CACHE_KEY,
      upstream: 'kilo-gateway',
      freshForSeconds: MODELS_FRESH_FOR_SECONDS,
      fetcher: () => client.fetchModels(),
    })
    return aged.data
  }
  return {
    list,
    async get(modelId) {
      const models = await list()
      return models.find((m) => m.id === modelId)
    },
  }
}
