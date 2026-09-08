import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_BACKOFF,
  backoffDelay,
  reconnectLoop,
  viewFor,
  type ReconnectUi,
  type ReconnectView,
} from '../src/client/lib/reconnect.ts'

describe('backoff', () => {
  it('grows exponentially from the base', () => {
    assert.equal(backoffDelay(1), 1000)
    assert.equal(backoffDelay(2), 2000)
    assert.equal(backoffDelay(3), 4000)
  })

  it('stops growing at the ceiling', () => {
    // Without a ceiling an overnight outage backs off to hours, and the wall
    // stays dead for hours AFTER the server comes back. That is the bug.
    assert.equal(backoffDelay(20), DEFAULT_BACKOFF.maxMs)
    assert.equal(backoffDelay(999), DEFAULT_BACKOFF.maxMs)
  })

  it('is defensive about a nonsense attempt number', () => {
    assert.equal(backoffDelay(0), DEFAULT_BACKOFF.baseMs)
    assert.equal(backoffDelay(-3), DEFAULT_BACKOFF.baseMs)
  })
})

describe('viewFor', () => {
  it('fills towards the next attempt rather than draining', () => {
    assert.equal(viewFor(1, 4000, 4000).percent, 0)
    assert.equal(viewFor(1, 2000, 4000).percent, 50)
    assert.equal(viewFor(1, 0, 4000).percent, 100)
  })

  it('clamps rather than producing a bar outside 0-100', () => {
    assert.equal(viewFor(1, 9999, 1000).percent, 0)
    assert.equal(viewFor(1, -50, 1000).percent, 100)
  })

  it('survives a zero total instead of dividing by it', () => {
    assert.ok(Number.isFinite(viewFor(1, 0, 0).percent))
  })
})

describe('reconnectLoop', () => {
  function fakeUi() {
    const views: ReconnectView[] = []
    let shown = 0
    let hidden = 0
    const ui: ReconnectUi = {
      show: () => { shown += 1 },
      hide: () => { hidden += 1 },
      render: (v) => { views.push(v) },
    }
    return { ui, views, counts: () => ({ shown, hidden }) }
  }

  it('returns immediately when the backend is already up, but still shows the scrim', async () => {
    const { ui, counts } = fakeUi()
    let recovered = 0
    await reconnectLoop({ probe: async () => 'ok', ui, onRecovered: () => { recovered += 1 }, sleep: async () => {} })
    assert.deepEqual(counts(), { shown: 1, hidden: 1 })
    assert.equal(recovered, 1)
  })

  it('retries until the backend answers, then hides and refreshes', async () => {
    const { ui, views, counts } = fakeUi()
    let calls = 0
    let recovered = 0
    await reconnectLoop({
      probe: async () => {
        calls += 1
        if (calls < 4) throw new Error('ECONNREFUSED')
        return 'ok'
      },
      ui,
      onRecovered: () => { recovered += 1 },
      sleep: async () => {},
      tickMs: 1000,
    })
    assert.equal(calls, 4)
    assert.equal(recovered, 1)
    assert.equal(counts().hidden, 1)
    assert.ok(views.length > 0, 'the scrim was never rendered during the wait')
    // The attempt counter must advance — a scrim stuck on "próba 1" for ten
    // minutes is the uninformative spinner this design exists to avoid.
    assert.deepEqual([...new Set(views.map((v) => v.attempt))], [1, 2, 3])
  })

  it('never renders a percentage outside the bar', async () => {
    const { ui, views } = fakeUi()
    let calls = 0
    await reconnectLoop({
      probe: async () => { calls += 1; if (calls < 3) throw new Error('down'); return 1 },
      ui, onRecovered: () => {}, sleep: async () => {}, tickMs: 300,
    })
    for (const v of views) {
      assert.ok(v.percent >= 0 && v.percent <= 100, `percent out of range: ${v.percent}`)
    }
  })
})
