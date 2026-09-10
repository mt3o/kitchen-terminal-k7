import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PULL_MAX_PX, PULL_THRESHOLD_PX, resolvePull } from '../src/client/lib/pull-refresh.ts'

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
