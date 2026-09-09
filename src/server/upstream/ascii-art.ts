/**
 * ascii-art-of-the-day: a prompt generated once a day through Kilo Gateway,
 * kept small on purpose — own AI-generated content, no attribution, no
 * copyright exposure. See `upstream/comic-rss.ts` for the opposite case; the
 * two stay separate services deliberately (comic-of-the-day pulls third-party
 * content and carries legal weight this one does not).
 *
 * Shares the Kilo Gateway client and model catalogue with the chat surface
 * (`upstream/kilo.ts`) rather than rolling its own — Faza 4 and Faza 5 briefly
 * built one each in parallel worktrees; the chat one was verified live against
 * the real gateway, so it is the one that survived reconciliation.
 */
import { randomInt } from 'node:crypto'

import { estimateCostUsd, type KiloGatewayClient, type ModelCatalog } from './kilo.ts'
import type { AiCallRepository } from '../ports/repositories.ts'

export interface AsciiArtQuery {
  prompt: string
  model: string
  seed?: number
  maxWidthChars?: number
  maxHeightLines?: number
}

export interface AsciiArtResult {
  art: string
  /** Stored alongside the art for prompt debugging — reusing it reproduces the same result. */
  seed: number
  model: string
  prompt: string
}

/**
 * All cache-relevant params folded in, same discipline as `weatherCacheKey`:
 * `maxWidthChars`/`maxHeightLines` shape what is actually asked of the
 * gateway, so two different sizes for the same prompt must not collide on
 * one cache row and serve art the wrong shape for the card.
 */
export function asciiArtCacheKey(q: AsciiArtQuery): string {
  return `kilo-ascii-art:${q.prompt}:${q.model}:${q.seed ?? 'auto'}:${q.maxWidthChars ?? 60}x${q.maxHeightLines ?? 24}`
}

/** A prompt built to bias a chat model toward returning plain ASCII art and nothing else. */
function buildPrompt(prompt: string, maxWidthChars: number, maxHeightLines: number): string {
  return (
    `Generate ASCII art for: ${prompt}\n` +
    `Constraints: plain text only, no markdown code fences, no explanation — just the art. ` +
    `At most ${maxWidthChars} characters wide and ${maxHeightLines} lines tall.`
  )
}

/**
 * Generate the art and record its cost, in one step so a cache hit — the
 * common case, since this runs at most once a day per prompt — never touches
 * the gateway or the `ai_calls` table at all.
 */
export function createAsciiArtGenerator(
  aiCalls: AiCallRepository,
  client: Pick<KiloGatewayClient, 'chatCompletionOnce'>,
  modelCatalog: Pick<ModelCatalog, 'get'>,
) {
  return async function generateAndRecord(q: AsciiArtQuery): Promise<AsciiArtResult> {
    const seed = q.seed ?? randomInt(0, 2 ** 31 - 1)
    const maxWidthChars = q.maxWidthChars ?? 60
    const maxHeightLines = q.maxHeightLines ?? 24

    const { content, usage } = await client.chatCompletionOnce({
      model: q.model,
      seed,
      messages: [{ role: 'user', content: buildPrompt(q.prompt, maxWidthChars, maxHeightLines) }],
    })
    if (!content) throw new Error('kilo gateway returned no content')

    // Best-effort: an unpriced or unreachable model catalogue must not fail the
    // generation it would have costed. The art is the product; the cost line
    // is bookkeeping.
    const model = await modelCatalog.get(q.model).catch(() => undefined)
    await aiCalls.record({
      conversationId: null,
      messageId: null,
      purpose: 'ascii-art',
      model: q.model,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      estimatedCostUsd: estimateCostUsd(usage, model?.pricing ?? null),
    })

    return { art: content, seed, model: q.model, prompt: q.prompt }
  }
}
