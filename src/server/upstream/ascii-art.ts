/**
 * ascii-art-of-the-day: a prompt generated once a day through Kilo Gateway,
 * kept small on purpose — own AI-generated content, no attribution, no
 * copyright exposure. See `upstream/comic-rss.ts` for the opposite case; the
 * two stay separate services deliberately (comic-of-the-day pulls third-party
 * content and carries legal weight this one does not).
 */
import { estimateCostUsd, fetchModelPrice, generateAsciiArt } from './kilo-gateway.ts'
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

/**
 * Generate the art and record its cost, in one step so a cache hit — the
 * common case, since this runs at most once a day per prompt — never touches
 * the gateway or the `ai_calls` table at all.
 */
export function createAsciiArtGenerator(aiCalls: AiCallRepository, apiKey: string) {
  return async function generateAndRecord(q: AsciiArtQuery): Promise<AsciiArtResult> {
    const result = await generateAsciiArt({
      prompt: q.prompt,
      model: q.model,
      apiKey,
      seed: q.seed,
      maxWidthChars: q.maxWidthChars,
      maxHeightLines: q.maxHeightLines,
    })

    // Best-effort: an unpriced or unreachable pricing table must not fail the
    // generation it would have costed. The art is the product; the cost line
    // is bookkeeping.
    const price = await fetchModelPrice(q.model).catch(() => undefined)
    await aiCalls.record({
      conversationId: null,
      messageId: null,
      purpose: 'ascii-art',
      model: q.model,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      estimatedCostUsd: estimateCostUsd(result.usage, price),
    })

    return { art: result.art, seed: result.seed, model: q.model, prompt: q.prompt }
  }
}
