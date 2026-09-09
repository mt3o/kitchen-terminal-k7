/**
 * The Kilo Gateway client, tested against a stubbed global `fetch` rather than
 * a live gateway — the wire format is an assumption (see the module's own
 * doc comment), and these tests pin what this codebase currently assumes it
 * to be, not what the real gateway does.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { estimateCostUsd, fetchModelPrice, generateAsciiArt } from '../src/server/upstream/kilo-gateway.ts'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('generateAsciiArt', () => {
  let lastRequest: { url: string; init: RequestInit } | undefined

  beforeEach(() => {
    lastRequest = undefined
  })

  function stubFetch(response: unknown, ok = true): void {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      lastRequest = { url: String(url), init: init ?? {} }
      return {
        ok,
        status: ok ? 200 : 500,
        json: async () => response,
      } as Response
    }) as typeof fetch
  }

  it('posts to /chat/completions with the model, seed and an ASCII-art-biased prompt', async () => {
    stubFetch({ choices: [{ message: { content: '(o.o)' } }], usage: { prompt_tokens: 12, completion_tokens: 34 } })

    const result = await generateAsciiArt({ prompt: 'kot', model: 'kilo-auto/free', apiKey: 'k-123', seed: 7 })

    assert.equal(lastRequest?.url, 'https://api.kilo.ai/api/gateway/chat/completions')
    const body = JSON.parse(String(lastRequest?.init.body)) as { model: string; seed: number; messages: { content: string }[] }
    assert.equal(body.model, 'kilo-auto/free')
    assert.equal(body.seed, 7)
    assert.match(body.messages[0].content, /kot/)
    assert.equal((lastRequest?.init.headers as Record<string, string>).authorization, 'Bearer k-123')

    assert.equal(result.art, '(o.o)')
    assert.equal(result.seed, 7)
    assert.deepEqual(result.usage, { promptTokens: 12, completionTokens: 34 })
  })

  it('mints a seed when none is supplied, so the result stays reproducible for debugging', async () => {
    stubFetch({ choices: [{ message: { content: 'art' } }], usage: {} })
    const result = await generateAsciiArt({ prompt: 'kot', model: 'kilo-auto/free', apiKey: 'k' })
    assert.ok(Number.isInteger(result.seed))
    const body = JSON.parse(String(lastRequest?.init.body)) as { seed: number }
    assert.equal(body.seed, result.seed, 'the minted seed was not the one actually sent upstream')
  })

  it('throws when the gateway returns no content, rather than caching an empty result', async () => {
    stubFetch({ choices: [] })
    await assert.rejects(() => generateAsciiArt({ prompt: 'kot', model: 'kilo-auto/free', apiKey: 'k' }))
  })

  it('throws on a non-ok response', async () => {
    stubFetch({}, false)
    await assert.rejects(() => generateAsciiArt({ prompt: 'kot', model: 'kilo-auto/free', apiKey: 'k' }))
  })
})

describe('fetchModelPrice', () => {
  it('finds the priced model by id', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'kilo-auto/free', pricing: { prompt: '0.000001', completion: '0.000002' } }] }),
    })) as unknown as typeof fetch

    const price = await fetchModelPrice('kilo-auto/free')
    assert.deepEqual(price, { prompt: 0.000001, completion: 0.000002 })
  })

  it('returns undefined rather than throwing when the gateway is unreachable', async () => {
    globalThis.fetch = (async () => { throw new Error('ENETUNREACH') }) as unknown as typeof fetch
    const price = await fetchModelPrice('kilo-auto/free')
    assert.equal(price, undefined)
  })

  it('returns undefined when the model is not in the price list', async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ data: [] }) })) as unknown as typeof fetch
    const price = await fetchModelPrice('kilo-auto/free')
    assert.equal(price, undefined)
  })
})

describe('estimateCostUsd', () => {
  it('is zero when no price is known, so an unpriced model never fails the call over its cost line', () => {
    assert.equal(estimateCostUsd({ promptTokens: 100, completionTokens: 50 }, undefined), 0)
  })

  it('multiplies token counts by their per-token price', () => {
    const cost = estimateCostUsd({ promptTokens: 100, completionTokens: 50 }, { prompt: 0.01, completion: 0.02 })
    assert.equal(cost, 100 * 0.01 + 50 * 0.02)
  })
})
