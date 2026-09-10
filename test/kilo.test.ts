/**
 * The Kilo Gateway client's SSE parsing and model-mapping, tested against
 * frames shaped exactly like what the real gateway sent during planning
 * (verified live 2026-09-09) — including the `: KILO PROCESSING` keepalive
 * comment line and the final usage-carrying chunk before `data: [DONE]`.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { createKiloGatewayClient, estimateCostUsd, fileNameForContentType, mapGatewayModel, parseSseFrame, splitSseFrames } from '../src/server/upstream/kilo.ts'

describe('splitSseFrames', () => {
  it('splits complete frames and keeps a partial tail for the next chunk', () => {
    const { frames, rest } = splitSseFrames('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"')
    assert.deepEqual(frames, ['data: {"a":1}', 'data: {"b":2}'])
    assert.equal(rest, 'data: {"c"')
  })

  it('handles an empty buffer', () => {
    assert.deepEqual(splitSseFrames(''), { frames: [], rest: '' })
  })
})

describe('parseSseFrame', () => {
  it('extracts the JSON payload from a data line', () => {
    assert.deepEqual(parseSseFrame('data: {"x":1}'), { data: '{"x":1}' })
  })

  it('recognises the terminator', () => {
    assert.deepEqual(parseSseFrame('data: [DONE]'), { done: true })
  })

  it('skips a keepalive comment line rather than treating it as data', () => {
    assert.deepEqual(parseSseFrame(': KILO PROCESSING'), {})
  })

  it('skips a blank frame', () => {
    assert.deepEqual(parseSseFrame(''), {})
  })
})

describe('mapGatewayModel', () => {
  it('parses a real priced model exactly as the live catalogue returns it', () => {
    const model = mapGatewayModel({
      id: 'anthropic/claude-sonnet-5',
      name: 'Anthropic: Claude Sonnet 5',
      top_provider: { context_length: 1_000_000, max_completion_tokens: 128_000 },
      pricing: { prompt: '0.000002', completion: '0.00001' },
    })
    assert.equal(model.id, 'anthropic/claude-sonnet-5')
    assert.equal(model.contextLength, 1_000_000)
    assert.equal(model.maxCompletionTokens, 128_000)
    assert.deepEqual(model.pricing, { promptUsdPerToken: 0.000002, completionUsdPerToken: 0.00001 })
  })

  it('treats "-1" (unpriced auto-router entries) as null pricing, not zero', () => {
    const model = mapGatewayModel({
      id: 'kilo-auto/frontier',
      top_provider: { context_length: 1_000_000, max_completion_tokens: 128_000 },
      pricing: { prompt: '-1', completion: '-1' },
    })
    assert.equal(model.pricing, null)
  })

  it('treats "0" (genuinely free) as a real zero price, distinct from unpriced', () => {
    const model = mapGatewayModel({
      id: 'some/free-model',
      pricing: { prompt: '0', completion: '0' },
    })
    assert.deepEqual(model.pricing, { promptUsdPerToken: 0, completionUsdPerToken: 0 })
  })

  it('falls back to context_length when top_provider is absent, and to the id for name', () => {
    const model = mapGatewayModel({ id: 'x/y', context_length: 4096 })
    assert.equal(model.name, 'x/y')
    assert.equal(model.contextLength, 4096)
  })
})

describe('estimateCostUsd', () => {
  it('computes cost from real per-token pricing', () => {
    const cost = estimateCostUsd(
      { prompt_tokens: 1000, completion_tokens: 500 },
      { promptUsdPerToken: 0.000002, completionUsdPerToken: 0.00001 },
    )
    assert.ok(Math.abs(cost - (1000 * 0.000002 + 500 * 0.00001)) < 1e-12)
  })

  it('is 0 for an unpriced model rather than throwing', () => {
    assert.equal(estimateCostUsd({ prompt_tokens: 1000, completion_tokens: 500 }, null), 0)
  })
})

describe('fileNameForContentType', () => {
  it('maps known audio content-types to a sensible extension', () => {
    assert.equal(fileNameForContentType('audio/webm'), 'audio.webm')
    assert.equal(fileNameForContentType('audio/webm;codecs=opus'), 'audio.webm')
    assert.equal(fileNameForContentType('audio/mp4'), 'audio.mp4')
  })

  it('falls back to a generic extension for an unrecognised type', () => {
    assert.equal(fileNameForContentType('audio/x-made-up'), 'audio.bin')
  })
})

describe('chatCompletionOnce', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  /**
   * Reproduced live: with a real KILO_GATEWAY_KEY configured, an ascii-art
   * generation request to kilo-auto/free was still pending minutes later —
   * no response, no error, nothing in the server log past "incoming
   * request". fetchWithTimeout (freshness.ts) exists specifically for "an
   * upstream that accepts the connection and then never answers holds the
   * request open... those pile up" — chatCompletionOnce never adopted it.
   * This stub fetch mimics exactly that: it only ever settles via the
   * request's own AbortSignal, never on its own.
   */
  it('does not hang forever when the gateway accepts the connection and never answers', async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as unknown as typeof fetch

    const client = createKiloGatewayClient({ apiKey: 'test-key' })
    const outcome = await Promise.race([
      client
        .chatCompletionOnce({ model: 'kilo-auto/free', messages: [{ role: 'user', content: 'hi' }] }, { timeoutMs: 50 })
        .then(() => 'resolved' as const)
        .catch(() => 'rejected' as const),
      new Promise<'never-settled'>((resolve) => setTimeout(() => resolve('never-settled'), 1000)),
    ])
    assert.equal(outcome, 'rejected', 'chatCompletionOnce must reject via its own timeout rather than hang past it')
  })
})
