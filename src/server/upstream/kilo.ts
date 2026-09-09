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
 */
import { fetchWithTimeout, type FreshnessService } from './freshness.ts'

const BASE_URL = process.env.K7_KILO_GATEWAY_URL ?? 'https://api.kilo.ai/api/gateway'

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

export interface KiloGatewayClient {
  fetchModels(): Promise<GatewayModel[]>
  chatCompletion(request: ChatCompletionRequest, opts?: { signal?: AbortSignal }): AsyncGenerator<GatewayChunk>
  /** Non-streaming, single-shot call — used for compacting summaries. */
  chatCompletionOnce(
    request: ChatCompletionRequest,
    opts?: { signal?: AbortSignal },
  ): Promise<{ content: string; usage: GatewayUsage }>
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
    opts: { signal?: AbortSignal } = {},
  ): Promise<{ content: string; usage: GatewayUsage }> {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(options.apiKey),
      signal: opts.signal,
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
  }

  return {
    fetchModels: () => fetchModels(baseUrl),
    chatCompletion,
    chatCompletionOnce,
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
