import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PULL_MAX_PX, PULL_THRESHOLD_PX, resolvePull, shouldAbort } from '../src/client/lib/pull-refresh.ts'

describe('resolvePull', () => {
  it('reports no progress and no commit at zero drag', () => {
    const state = resolvePull(0)
    assert.equal(state.progress, 0)
    assert.equal(state.committed, false)
    assert.equal(state.offsetPx, 0)
  })

  it('never commits before the threshold', () => {
    const state = resolvePull(PULL_THRESHOLD_PX - 1)
    assert.equal(state.committed, false)
    assert.ok(state.progress < 1)
  })

  it('commits exactly at the threshold', () => {
    const state = resolvePull(PULL_THRESHOLD_PX)
    assert.equal(state.committed, true)
    assert.equal(state.progress, 1)
  })

  it('stays committed past the threshold, offset capped at PULL_MAX_PX', () => {
    const state = resolvePull(PULL_MAX_PX + 500)
    assert.equal(state.committed, true)
    assert.equal(state.offsetPx, PULL_MAX_PX)
    assert.equal(state.progress, 1)
  })

  it('clamps a negative drag (upward) to zero rather than going negative', () => {
    const state = resolvePull(-50)
    assert.equal(state.offsetPx, 0)
    assert.equal(state.progress, 0)
    assert.equal(state.committed, false)
  })
})

describe('shouldAbort', () => {
  it('does not abort on a first touchmove of a pixel or two, even if slightly more horizontal', () => {
    // Regression: without a deadzone, dx=2/dy=1 aborts a genuine downward
    // pull on its very first sample, before direction is actually clear.
    assert.equal(shouldAbort(2, 1), false)
  })

  it('does not abort a clean vertical drag', () => {
    assert.equal(shouldAbort(0, 40), false)
  })

  it('aborts once a drag is clearly more horizontal than vertical, past the deadzone', () => {
    assert.equal(shouldAbort(40, 5), true)
  })

  it('does not abort a diagonal drag that is still vertical-dominant', () => {
    assert.equal(shouldAbort(15, 40), false)
  })
})
