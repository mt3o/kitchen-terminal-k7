import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { nextMode, toggleLabel } from '../src/client/lib/theme-toggle.ts'

describe('nextMode', () => {
  it('flips dark to light', () => {
    assert.equal(nextMode('dark'), 'light')
  })

  it('flips light to dark', () => {
    assert.equal(nextMode('light'), 'dark')
  })
})

describe('toggleLabel', () => {
  it('names the mode a click would switch TO, not the active one', () => {
    assert.equal(toggleLabel('dark'), '[ MOTYW: JASNY ]')
    assert.equal(toggleLabel('light'), '[ MOTYW: CIEMNY ]')
  })
})
