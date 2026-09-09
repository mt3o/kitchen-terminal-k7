import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { COMMIT_RATIO, resolveSwipe } from '../src/client/lib/pager.ts'
import { normaliseLayout, type Layout } from '../src/shared/layout.ts'

const W = 1000

describe('resolveSwipe', () => {
  it('ignores a drag that goes nowhere', () => {
    assert.deepEqual(resolveSwipe(0, 3, -10, W, 300), { index: 0, committed: false })
  })

  it('commits past the distance threshold', () => {
    const far = -(W * COMMIT_RATIO) - 1
    assert.deepEqual(resolveSwipe(0, 3, far, W, 800), { index: 1, committed: true })
  })

  it('commits a short fast flick that never travels far', () => {
    // The gesture people actually make on a wall display is a flick, not a drag.
    assert.deepEqual(resolveSwipe(1, 3, -60, W, 60), { index: 2, committed: true })
  })

  it('moves backwards on a rightward drag', () => {
    assert.deepEqual(resolveSwipe(2, 3, W * 0.5, W, 400), { index: 1, committed: true })
  })

  it('clamps at both ends rather than wrapping', () => {
    // A wall display that loops surprises anyone counting pages, and nothing on
    // screen says it will.
    assert.deepEqual(resolveSwipe(0, 3, W * 0.5, W, 400), { index: 0, committed: false })
    assert.deepEqual(resolveSwipe(2, 3, -W * 0.5, W, 400), { index: 2, committed: false })
  })

  it('does nothing with one page or an unmeasured viewport', () => {
    assert.deepEqual(resolveSwipe(0, 1, -W, W, 100), { index: 0, committed: false })
    assert.deepEqual(resolveSwipe(0, 3, -W, 0, 100), { index: 0, committed: false })
  })
})

describe('normaliseLayout', () => {
  const base = { version: 1 as const, theme: 't.yaml', grid: { columns: 3, gap: '12px' } }

  it('wraps a v1 card list in a single page, so old layouts keep working', () => {
    const out = normaliseLayout({ ...base, cards: [{ id: 'a', type: 'clock' }] } as Layout)
    assert.equal(out.pages.length, 1)
    assert.equal(out.pages[0]?.id, 'main')
    assert.equal(out.pages[0]?.cards.length, 1)
    assert.equal(out.pages[0]?.grid?.columns, 3, 'the page did not inherit the layout grid')
  })

  it('keeps pages and lets each override the grid', () => {
    const out = normaliseLayout({
      ...base,
      pages: [
        { id: 'one', grid: { columns: 2 }, cards: [{ id: 'a', type: 'clock' }] },
        { id: 'two', cards: [{ id: 'b', type: 'timer' }] },
      ],
    } as Layout)
    assert.equal(out.pages[0]?.grid?.columns, 2, 'the page override was lost')
    assert.equal(out.pages[1]?.grid?.columns, 3, 'the page did not fall back to the layout grid')
  })

  it('prefers pages when a file somehow has both', () => {
    const out = normaliseLayout({ ...base, cards: [{ id: 'x', type: 'clock' }], pages: [{ id: 'p', cards: [] }] } as Layout)
    assert.equal(out.pages.length, 1)
    assert.equal(out.pages[0]?.id, 'p')
  })
})
