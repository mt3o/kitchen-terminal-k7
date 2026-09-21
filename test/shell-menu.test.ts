import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { panelPosition } from '../src/client/lib/shell-menu.ts'

describe('panelPosition', () => {
  it('hangs the panel just under the button, flush with its right edge', () => {
    assert.deepEqual(panelPosition({ bottom: 40, right: 1000 }, 1024, 6), { top: 46, right: 24 })
  })

  it('never pushes the panel past the right edge of the viewport', () => {
    assert.deepEqual(panelPosition({ bottom: 40.4, right: 1030 }, 1024, 6), { top: 46, right: 0 })
  })
})
