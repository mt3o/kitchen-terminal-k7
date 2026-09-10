import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  exceedsThreshold,
  pushSample,
  smooth,
  toDecibels,
  toRelativePercent,
  updateReference,
  windowMax
} from '../src/client/lib/audiometer.ts'

describe('audiometer maths', () => {
  it('does not return -Infinity for silence', () => {
    // A display that runs for months will see true silence, and -Infinity
    // renders as a bar of NaN height that never recovers.
    const db = toDecibels(0)
    assert.ok(Number.isFinite(db), `silence produced ${db}`)
  })

  it('survives nonsense input rather than propagating NaN', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.ok(Number.isFinite(toRelativePercent(bad, 0.5)), `toRelativePercent(${bad}, 0.5)`)
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

describe('windowMax', () => {
  it('is 0 for an empty window rather than throwing', () => {
    assert.equal(windowMax([]), 0)
  })

  it('finds the loudest sample regardless of position', () => {
    assert.equal(windowMax([0.1, 0.4, 0.2]), 0.4)
  })
})

describe('updateReference (peak-hold with falloff)', () => {
  it('jumps up immediately to a new, louder peak', () => {
    assert.equal(updateReference(0.1, 0.5), 0.5)
  })

  it('eases down gradually rather than snapping to a quieter window', () => {
    const next = updateReference(0.5, 0.1)
    assert.ok(next < 0.5, 'reference did not fall at all')
    assert.ok(next > 0.1, 'reference snapped straight to the new max instead of easing')
  })

  it('reaches the lower target after enough samples, and does not overshoot past it', () => {
    let ref = 1
    for (let i = 0; i < 500; i += 1) ref = updateReference(ref, 0.1)
    assert.ok(Math.abs(ref - 0.1) < 1e-6, `did not converge, landed on ${ref}`)
  })

  it('never falls below the reference floor even with prolonged silence', () => {
    let ref = 0.5
    for (let i = 0; i < 1000; i += 1) ref = updateReference(ref, 0)
    assert.ok(ref > 0, 'reference reached zero — a future rms/reference division would blow up to Infinity')
  })

  it('survives a nonsense previous reference instead of propagating it', () => {
    assert.ok(Number.isFinite(updateReference(Number.NaN, 0.3)))
    assert.ok(Number.isFinite(updateReference(-5, 0.3)))
  })
})

describe('toRelativePercent', () => {
  it('is 100% when the sample matches its reference exactly', () => {
    assert.equal(toRelativePercent(0.3, 0.3), 100)
  })

  it('is half when the sample is half its reference', () => {
    assert.equal(toRelativePercent(0.15, 0.3), 50)
  })

  it('caps at 100 even if the sample exceeds the reference', () => {
    // A real single tick between a sudden attack and updateReference catching
    // up to it — must never paint past the top of the bar.
    assert.equal(toRelativePercent(0.9, 0.3), 100)
  })

  it('is 0 for silence regardless of reference', () => {
    assert.equal(toRelativePercent(0, 0.3), 0)
  })

  it('survives a zero or negative reference instead of dividing by it', () => {
    assert.ok(Number.isFinite(toRelativePercent(0.3, 0)))
    assert.ok(Number.isFinite(toRelativePercent(0.3, -1)))
  })
})
