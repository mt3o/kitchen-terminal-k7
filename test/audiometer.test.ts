import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { exceedsThreshold, pushSample, smooth, toDecibels, toPercent } from '../src/client/lib/audiometer.ts'

describe('audiometer maths', () => {
  it('maps amplitude to a percentage inside the bar', () => {
    for (const rms of [0, 0.25, 0.5, 1]) {
      const p = toPercent(rms)
      assert.ok(p >= 0 && p <= 100, `${rms} produced ${p}`)
    }
  })

  it('does not return -Infinity for silence', () => {
    // A display that runs for months will see true silence, and -Infinity
    // renders as a bar of NaN height that never recovers.
    const db = toDecibels(0)
    assert.ok(Number.isFinite(db), `silence produced ${db}`)
  })

  it('survives nonsense input rather than propagating NaN', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.ok(Number.isFinite(toPercent(bad)), `toPercent(${bad})`)
      assert.ok(Number.isFinite(toDecibels(bad)), `toDecibels(${bad})`)
    }
  })

  it('windows the history instead of growing forever', () => {
    let h: number[] = []
    for (let i = 0; i < 500; i += 1) h = pushSample(h, i, 100)
    assert.equal(h.length, 100)
    assert.equal(h.at(-1), 499, 'the newest sample was dropped instead of the oldest')
  })

  it('handles a degenerate window size', () => {
    assert.ok(Array.isArray(pushSample([], 1, 0)))
    assert.equal(pushSample([1, 2], 3, 1).length, 1)
  })

  it('smooths between raw and slow, and clamps a silly factor', () => {
    assert.equal(smooth(0, 10, 0), 10, 'factor 0 should be the raw value')
    assert.ok(smooth(0, 10, 1) < 10, 'factor 1 should barely move')
    for (const f of [-5, 5, Number.NaN]) {
      assert.ok(Number.isFinite(smooth(0, 10, f)), `factor ${f}`)
    }
  })

  it('treats an absent threshold as no threshold', () => {
    assert.equal(exceedsThreshold(99, undefined), false)
    assert.equal(exceedsThreshold(80, 75), true)
    assert.equal(exceedsThreshold(70, 75), false)
  })
})
