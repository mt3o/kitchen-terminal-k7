/**
 * The freshness rule, tested as behaviour rather than as implementation.
 *
 * The rule is one sentence — the cache never lies about how old the answer is —
 * and every test below is a way of getting that wrong.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { createRepositories, openDatabase } from '../src/server/adapters/drizzle/index.ts'
import { runMigrations } from '../src/server/db/migrate.ts'
import { createFreshnessService } from '../src/server/upstream/freshness.ts'
import type { Repositories } from '../src/server/ports/repositories.ts'

let repos: Repositories
let fetchThrough: ReturnType<typeof createFreshnessService>

const T0 = new Date('2026-09-08T12:00:00Z')
const at = (secs: number): Date => new Date(T0.getTime() + secs * 1000)

beforeEach(() => {
  const db = openDatabase(':memory:')
  runMigrations(db)
  repos = createRepositories(db)
  fetchThrough = createFreshnessService(repos.upstreamCache)
})

describe('fetchThrough', () => {
  it('calls the upstream when nothing is cached, and reports it as live', async () => {
    let calls = 0
    const got = await fetchThrough({
      key: 'weather:52.23,21.01:metric',
      upstream: 'open-meteo',
      freshForSeconds: 900,
      fetcher: async () => { calls += 1; return { temp: 17 } },
      now: () => T0,
    })
    assert.equal(calls, 1)
    assert.deepEqual(got.data, { temp: 17 })
    assert.equal(got.source, 'live')
    assert.equal(got.ageSeconds, 0)
    assert.equal(got.stale, false)
  })

  it('serves the stored copy inside the window without touching the network', async () => {
    let calls = 0
    const fetcher = async () => { calls += 1; return { temp: 17 } }
    const key = 'weather:warsaw'
    await fetchThrough({ key, upstream: 'open-meteo', freshForSeconds: 900, fetcher, now: () => T0 })
    const second = await fetchThrough({ key, upstream: 'open-meteo', freshForSeconds: 900, fetcher, now: () => at(300) })

    assert.equal(calls, 1, 'the upstream was called again inside the freshness window')
    assert.equal(second.source, 'cache')
    assert.equal(second.stale, false)
    // The age is REAL even though the copy counts as fresh. Zeroing it here is
    // the subtle version of lying, and it is what this assertion exists for.
    assert.equal(second.ageSeconds, 300)
  })

  it('falls back to the last good answer when the upstream is down, marked stale', async () => {
    const key = 'weather:warsaw'
    await fetchThrough({
      key, upstream: 'open-meteo', freshForSeconds: 900,
      fetcher: async () => ({ temp: 17 }), now: () => T0,
    })

    let reportedAge = -1
    const got = await fetchThrough({
      key, upstream: 'open-meteo', freshForSeconds: 900,
      fetcher: async () => { throw new Error('ENETUNREACH') },
      now: () => at(3600),
      onFallback: (_e, age) => { reportedAge = age },
    })

    assert.deepEqual(got.data, { temp: 17 }, 'the last good answer was lost')
    assert.equal(got.source, 'cache')
    assert.equal(got.stale, true)
    assert.equal(got.ageSeconds, 3600)
    assert.equal(reportedAge, 3600, 'the fallback was not reported to the caller')
  })

  it('throws when the upstream fails and there is nothing to fall back to', async () => {
    // The first ever call on a cold kiosk with no internet. There is no honest
    // answer, so the card must show an error rather than empty data.
    await assert.rejects(
      () => fetchThrough({
        key: 'weather:warsaw', upstream: 'open-meteo', freshForSeconds: 900,
        fetcher: async () => { throw new Error('ENETUNREACH') }, now: () => T0,
      }),
      /ENETUNREACH/,
    )
  })

  it('refreshes and resets the age once the upstream recovers', async () => {
    const key = 'weather:warsaw'
    await fetchThrough({ key, upstream: 'open-meteo', freshForSeconds: 900, fetcher: async () => ({ temp: 17 }), now: () => T0 })
    await fetchThrough({
      key, upstream: 'open-meteo', freshForSeconds: 900,
      fetcher: async () => { throw new Error('down') }, now: () => at(3600),
    })
    const recovered = await fetchThrough({
      key, upstream: 'open-meteo', freshForSeconds: 900,
      fetcher: async () => ({ temp: 21 }), now: () => at(7200),
    })
    assert.deepEqual(recovered.data, { temp: 21 })
    assert.equal(recovered.source, 'live')
    assert.equal(recovered.ageSeconds, 0)
  })

  it('keys different request shapes apart', async () => {
    const now = () => T0
    await fetchThrough({ key: 'weather:warsaw:metric', upstream: 'open-meteo', freshForSeconds: 900, fetcher: async () => ({ t: 'C' }), now })
    const imperial = await fetchThrough({ key: 'weather:warsaw:imperial', upstream: 'open-meteo', freshForSeconds: 900, fetcher: async () => ({ t: 'F' }), now })
    assert.deepEqual(imperial.data, { t: 'F' }, 'units collided on one cache row')
  })
})
