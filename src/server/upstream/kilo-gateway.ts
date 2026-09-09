/**
 * Kilo Gateway: the AI upstream, addressed as `provider/model-name`.
 *
 * This is the first Kilo Gateway client in the codebase — Faza 4 (AI chat) had
 * not landed when this was written, so there is nothing to reuse yet. The wire
 * format below is an assumption, not a verified contract: HANDOFF.md documents
 * the base URL, the `provider/model-name` addressing, an unauthenticated
 * `GET /models` for pricing, and `usage.prompt_tokens`/`completion_tokens` on
 * generation responses, but not the exact request/response shape of a
 * generation call. This module assumes an OpenAI-chat-compatible
 * `POST /chat/completions`, which is the closest fit to what is documented and
 * the common shape for gateways that address models this way. **Flagged for
 * human verification** once a real gateway is reachable or Faza 4's chat work
 * lands and can be diffed against it.
 *
 * The API key is never read from `process.env` here — it arrives as a
 * parameter, sourced from `config.kiloGatewayKey`, matching how every other
 * secret in this codebase is threaded (config.ts is the only module that reads
 * `process.env`).
 */
import { randomInt } from 'node:crypto'

// Overridable for the same reason K7_OPEN_METEO_URL is: it is the only way to
// prove the fallback and error paths against a dead upstream without touching
// the real gateway, and a household running its own gateway proxy needs it too.
const BASE_URL = process.env.K7_KILO_GATEWAY_URL ?? 'https://api.kilo.ai/api/gateway'

export interface GenerateAsciiArtOptions {
  prompt: string
  model: string
  apiKey: string
  /** Reused verbatim when given, for reproducing a prior result; otherwise minted here. */
  seed?: number
  maxWidthChars?: number
  maxHeightLines?: number
  timeoutMs?: number
}

export interface GenerateAsciiArtResult {
  art: string
  seed: number
  usage: { promptTokens: number; completionTokens: number }
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * A fetch with a deadline, mirroring `upstream/freshness.ts`'s `fetchWithTimeout`
 * but for a POST with a body and an auth header — the shared helper only does a
 * bare GET, and widening its signature for one caller would touch a file the
 * weather upstream (and every future one) also depends on.
 */
async function postWithTimeout(url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
    if (!res.ok) throw new Error(`kilo gateway responded ${res.status}`)
    return res
  } finally {
    clearTimeout(timer)
  }
}

/** A prompt built to bias a chat model toward returning plain ASCII art and nothing else. */
function buildPrompt(prompt: string, maxWidthChars: number, maxHeightLines: number): string {
  return (
    `Generate ASCII art for: ${prompt}\n` +
    `Constraints: plain text only, no markdown code fences, no explanation — just the art. ` +
    `At most ${maxWidthChars} characters wide and ${maxHeightLines} lines tall.`
  )
}

export async function generateAsciiArt(options: GenerateAsciiArtOptions): Promise<GenerateAsciiArtResult> {
  const seed = options.seed ?? randomInt(0, 2 ** 31 - 1)
  const res = await postWithTimeout(
    `${BASE_URL}/chat/completions`,
    {
      model: options.model,
      seed,
      messages: [{ role: 'user', content: buildPrompt(options.prompt, options.maxWidthChars ?? 60, options.maxHeightLines ?? 24) }],
    },
    { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
    options.timeoutMs ?? 15000,
  )
  const json = (await res.json()) as ChatCompletionResponse
  const art = json.choices?.[0]?.message?.content
  if (!art) throw new Error('kilo gateway returned no content')
  return {
    art,
    seed,
    usage: {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    },
  }
}

export interface ModelPrice {
  /** USD per token. Gateways more commonly price per 1K/1M tokens; the caller normalises. */
  prompt?: number
  completion?: number
}

interface ModelsResponse {
  data?: { id?: string; pricing?: { prompt?: string | number; completion?: string | number } }[]
}

/**
 * Best-effort pricing lookup, for the `ai_calls` cost estimate. `GET /models`
 * is documented as unauthenticated, so this needs no key. Failure here must
 * never fail the art generation it is costing — the art is the product, the
 * cost line is bookkeeping — so callers get `undefined` rather than a thrown
 * error and fall back to an estimate of 0.
 */
export async function fetchModelPrice(model: string, timeoutMs = 8000): Promise<ModelPrice | undefined> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(`${BASE_URL}/models`, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return undefined
    const json = (await res.json()) as ModelsResponse
    const entry = json.data?.find((m) => m.id === model)
    if (!entry?.pricing) return undefined
    const num = (v: string | number | undefined): number | undefined => (v === undefined ? undefined : Number(v))
    return { prompt: num(entry.pricing.prompt), completion: num(entry.pricing.completion) }
  } catch {
    return undefined
  }
}

/** USD estimate from token counts and a (possibly absent) per-token price. Never throws. */
export function estimateCostUsd(usage: { promptTokens: number; completionTokens: number }, price: ModelPrice | undefined): number {
  if (!price) return 0
  return usage.promptTokens * (price.prompt ?? 0) + usage.completionTokens * (price.completion ?? 0)
}
