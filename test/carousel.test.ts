import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CAROUSEL_COMMIT_RATIO, advanceIndex, resolveCarouselSwipe } from '../src/client/lib/carousel.ts'

const W = 1000

describe('advanceIndex', () => {
  it('steps forward and back within bounds', () => {
    assert.equal(advanceIndex(0, 3, false, 1), 1)
    assert.equal(advanceIndex(1, 3, false, -1), 0)
  })

  it('stops (returns null) at a non-looping boundary', () => {
    assert.equal(advanceIndex(2, 3, false, 1), null)
    assert.equal(advanceIndex(0, 3, false, -1), null)
  })

  it('wraps at both ends when loop is on', () => {
    assert.equal(advanceIndex(2, 3, true, 1), 0)
    assert.equal(advanceIndex(0, 3, true, -1), 2)
  })

  it('has nowhere to go with zero or one slide, loop or not', () => {
    assert.equal(advanceIndex(0, 1, true, 1), null)
    assert.equal(advanceIndex(0, 1, false, 1), null)
    assert.equal(advanceIndex(0, 0, true, 1), null)
  })
})

describe('resolveCarouselSwipe', () => {
  it('ignores a drag that goes nowhere', () => {
    assert.deepEqual(resolveCarouselSwipe(0, 3, -10, W, 300, false), { index: 0, committed: false })
  })

  it('commits past the distance threshold', () => {
    const far = -(W * CAROUSEL_COMMIT_RATIO) - 1
    assert.deepEqual(resolveCarouselSwipe(0, 3, far, W, 800, false), { index: 1, committed: true })
  })

  it('commits a short fast flick that never travels far', () => {
    assert.deepEqual(resolveCarouselSwipe(1, 3, -60, W, 60, false), { index: 2, committed: true })
  })

  it('clamps at both ends when loop is off', () => {
    assert.deepEqual(resolveCarouselSwipe(2, 3, -W * 0.5, W, 400, false), { index: 2, committed: false })
    assert.deepEqual(resolveCarouselSwipe(0, 3, W * 0.5, W, 400, false), { index: 0, committed: false })
  })

  it('wraps past either end when loop is on', () => {
    assert.deepEqual(resolveCarouselSwipe(2, 3, -W * 0.5, W, 400, true), { index: 0, committed: true })
    assert.deepEqual(resolveCarouselSwipe(0, 3, W * 0.5, W, 400, true), { index: 2, committed: true })
  })

  it('does nothing with one slide or an unmeasured viewport', () => {
    assert.deepEqual(resolveCarouselSwipe(0, 1, -W, W, 100, true), { index: 0, committed: false })
    assert.deepEqual(resolveCarouselSwipe(0, 3, -W, 0, 100, false), { index: 0, committed: false })
  })
})
