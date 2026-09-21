import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { backdropIndex, cssUrls, msUntilNextBackdrop } from '../src/client/lib/backdrop.ts'

// Built from local wall-clock parts, so the tests hold in any TZ the suite runs in.
const at = (h: number, m: number, s = 0): Date => new Date(2026, 8, 21, h, m, s)

describe('backdropIndex', () => {
  it('is 0 when there is nothing to rotate', () => {
    assert.equal(backdropIndex(at(13, 30), 60, 1), 0)
    assert.equal(backdropIndex(at(13, 30), 0, 6), 0)
  })

  it('changes on the interval boundary and holds within it', () => {
    const a = backdropIndex(at(13, 0), 60, 6)
    assert.equal(backdropIndex(at(13, 59, 59), 60, 6), a)
    assert.equal(backdropIndex(at(14, 0), 60, 6), (a + 1) % 6)
  })

  it('follows local time, so every screen shows the same picture at the same hour', () => {
    // Local midnight starts an interval whatever the UTC offset is.
    const midnight = new Date(2026, 8, 21, 0, 0, 0)
    const beforeMidnight = new Date(2026, 8, 20, 23, 59, 59)
    assert.notEqual(backdropIndex(midnight, 1440, 7), backdropIndex(beforeMidnight, 1440, 7))
  })

  it('wraps round the set', () => {
    const seen = new Set<number>()
    for (let h = 0; h < 24; h++) seen.add(backdropIndex(at(h, 5), 60, 6))
    assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4, 5])
  })
})

describe('msUntilNextBackdrop', () => {
  it('counts down to the next boundary', () => {
    assert.equal(msUntilNextBackdrop(at(13, 45), 60), 15 * 60_000)
    assert.equal(msUntilNextBackdrop(at(13, 0), 60), 60 * 60_000)
  })

  it('never schedules a busy loop', () => {
    assert.ok(msUntilNextBackdrop(new Date(at(13, 59, 59).getTime() + 999), 60) >= 1000)
  })
})

describe('cssUrls', () => {
  it('finds every url in a background stack, quoted or not', () => {
    const value = 'linear-gradient(to top, rgba(0, 0, 0, 0.9) 0, transparent 60px), url("/theme-assets/a.jpg?v=1") center / cover no-repeat, url(/b.svg), #140d08'
    assert.deepEqual(cssUrls(value), ['/theme-assets/a.jpg?v=1', '/b.svg'])
  })
})
