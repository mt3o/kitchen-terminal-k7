/**
 * ascii-art-of-the-day's caching and cost-recording behaviour: a repeated
 * request within the cache window must not call the gateway again, and every
 * live generation must leave a purpose:'ascii-art' row in ai_calls — that
 * billing record is the whole point of routing this through Kilo Gateway.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { createRepositories, openDatabase } from '../src/server/adapters/drizzle/index.ts'
import { runMigrations } from '../src/server/db/migrate.ts'
import { asciiArtCacheKey, createAsciiArtGenerator } from '../src/server/upstream/ascii-art.ts'
import { createFreshnessService } from '../src/server/upstream/freshness.ts'
import { createKiloGatewayClient } from '../src/server/upstream/kilo.ts'
import type { Repositories } from '../src/server/ports/repositories.ts'

let repos: Repositories
let fetchThrough: ReturnType<typeof createFreshnessService>
let generateAndRecord: ReturnType<typeof createAsciiArtGenerator>

const realFetch = globalThis.fetch
const T0 = new Date('2026-09-08T12:00:00Z')

beforeEach(() => {
  const db = openDatabase(':memory:')
  runMigrations(db)
  repos = createRepositories(db)
  fetchThrough = createFreshnessService(repos.upstreamCache)
  const client = createKiloGatewayClient({ apiKey: 'test-key' })
  // Pricing is best-effort for ascii-art (see ascii-art.ts) — a stub catalogue
  // that never resolves a price exercises exactly that fallback path.
  generateAndRecord = createAsciiArtGenerator(repos.aiCalls, client, { get: async () => undefined })
})

afterEach(() => {
  globalThis.fetch = realFetch
})

function stubGateway(art = '(o.o)'): { calls: number } {
  const counter = { calls: 0 }
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = String(url)
    if (href.includes('/chat/completions')) {
      counter.calls += 1
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: art } }], usage: { prompt_tokens: 5, completion_tokens: 10 } }),
      } as Response
    }
    // /models pricing lookup — best-effort, absent is fine.
    return { ok: false, status: 404, json: async () => ({}) } as Response
  }) as typeof fetch
  return counter
}

describe('asciiArtCacheKey', () => {
  it('folds prompt, model and seed together, same discipline as weatherCacheKey', () => {
    const a = asciiArtCacheKey({ prompt: 'kot', model: 'kilo-auto/free' })
    const b = asciiArtCacheKey({ prompt: 'pies', model: 'kilo-auto/free' })
    const c = asciiArtCacheKey({ prompt: 'kot', model: 'kilo-auto/free', seed: 7 })
    assert.notEqual(a, b)
    assert.notEqual(a, c)
  })
})

describe('ascii art through the freshness cache', () => {
  it('calls the gateway once and serves the cache on a repeat request within the window', async () => {
    const gateway = stubGateway()
    const query = { prompt: 'kot', model: 'kilo-auto/free' }
    const key = asciiArtCacheKey(query)

    const first = await fetchThrough({ key, upstream: 'kilo-gateway', freshForSeconds: 86400, fetcher: () => generateAndRecord(query), now: () => T0 })
    const second = await fetchThrough({ key, upstream: 'kilo-gateway', freshForSeconds: 86400, fetcher: () => generateAndRecord(query), now: () => T0 })

    assert.equal(gateway.calls, 1, 'the gateway was called again inside the cache-for-the-day window')
    assert.equal(first.data.art, '(o.o)')
    assert.equal(second.source, 'cache')
  })

  it('records an ai_calls row with purpose ascii-art for every live generation', async () => {
    stubGateway()
    const query = { prompt: 'kot', model: 'kilo-auto/free' }
    await fetchThrough({ key: asciiArtCacheKey(query), upstream: 'kilo-gateway', freshForSeconds: 86400, fetcher: () => generateAndRecord(query), now: () => T0 })

    const spend = await repos.aiCalls.totalCostSince(new Date('2000-01-01'))
    assert.equal(spend.calls, 1)
  })

  it('round-trips a caller-supplied seed unchanged, for reproducing a prior result', async () => {
    stubGateway()
    const query = { prompt: 'kot', model: 'kilo-auto/free', seed: 42 }
    const result = await fetchThrough({ key: asciiArtCacheKey(query), upstream: 'kilo-gateway', freshForSeconds: 86400, fetcher: () => generateAndRecord(query), now: () => T0 })
    assert.equal(result.data.seed, 42)
  })

  it('mints and caches a seed for prompt debugging when the caller supplies none', async () => {
    stubGateway()
    const query = { prompt: 'kot', model: 'kilo-auto/free' }
    const result = await fetchThrough({ key: asciiArtCacheKey(query), upstream: 'kilo-gateway', freshForSeconds: 86400, fetcher: () => generateAndRecord(query), now: () => T0 })
    assert.ok(Number.isInteger(result.data.seed))
  })
})
