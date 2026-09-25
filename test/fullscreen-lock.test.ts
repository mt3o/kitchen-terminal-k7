import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  type FullscreenEvent,
  type FullscreenLockState,
  INITIAL_FULLSCREEN_LOCK_STATE,
  fullscreenLockReducer,
  presentingElId,
  promotedElId,
} from '../src/client/lib/fullscreen-lock.ts'

describe('fullscreenLockReducer / promotedElId', () => {
  it('starts with nothing promoted', () => {
    assert.equal(promotedElId(INITIAL_FULLSCREEN_LOCK_STATE), null)
  })

  it('a Slideshow enter promotes its element', () => {
    const s1 = fullscreenLockReducer(INITIAL_FULLSCREEN_LOCK_STATE, { type: 'slideshow-enter', elId: 'weather' })
    assert.equal(promotedElId(s1), 'weather')
  })

  it('a Slideshow rotation moves the promoted element', () => {
    const s1 = fullscreenLockReducer(INITIAL_FULLSCREEN_LOCK_STATE, { type: 'slideshow-enter', elId: 'weather' })
    const s2 = fullscreenLockReducer(s1, { type: 'slideshow-rotate', elId: 'calendar' })
    assert.equal(promotedElId(s2), 'calendar')
  })

  it('a Slideshow exit clears the promotion', () => {
    const s1 = fullscreenLockReducer(INITIAL_FULLSCREEN_LOCK_STATE, { type: 'slideshow-enter', elId: 'weather' })
    const s2 = fullscreenLockReducer(s1, { type: 'slideshow-exit' })
    assert.equal(promotedElId(s2), null)
  })

  it('manual acquire wins over a Slideshow element already promoted (scenario 4)', () => {
    const s1 = fullscreenLockReducer(INITIAL_FULLSCREEN_LOCK_STATE, { type: 'slideshow-enter', elId: 'weather' })
    const s2 = fullscreenLockReducer(s1, { type: 'manual-acquire', elId: 'calendar' })
    assert.equal(promotedElId(s2), 'calendar', 'manual always wins while held')
    assert.equal(s2.slideshowElId, 'weather', 'the Slideshow\'s own element is remembered, not discarded')
  })

  it('manual acquire on the same element the Slideshow already has is a no-op on the derived value (scenario 3)', () => {
    const s1 = fullscreenLockReducer(INITIAL_FULLSCREEN_LOCK_STATE, { type: 'slideshow-enter', elId: 'calendar' })
    const s2 = fullscreenLockReducer(s1, { type: 'manual-acquire', elId: 'calendar' })
    assert.equal(promotedElId(s2), 'calendar')
    assert.equal(s2.slideshowElId, 'calendar')
  })

  it('manual release hands back to the Slideshow when it still has an element — "back with the slideshow slideshowing"', () => {
    const s1 = fullscreenLockReducer(INITIAL_FULLSCREEN_LOCK_STATE, { type: 'slideshow-enter', elId: 'weather' })
    const s2 = fullscreenLockReducer(s1, { type: 'manual-acquire', elId: 'calendar' })
    const s3 = fullscreenLockReducer(s2, { type: 'manual-release', elId: 'calendar' })
    assert.equal(promotedElId(s3), 'weather', 'falls through to the Slideshow\'s element with no explicit teardown branch')
  })

  it('manual release with no Slideshow running returns to normal view', () => {
    const s1 = fullscreenLockReducer(INITIAL_FULLSCREEN_LOCK_STATE, { type: 'manual-acquire', elId: 'calendar' })
    const s2 = fullscreenLockReducer(s1, { type: 'manual-release', elId: 'calendar' })
    assert.equal(promotedElId(s2), null)
  })

  it('a release naming a card other than the current manual holder is ignored (stale/late release cannot clobber a newer acquire)', () => {
    const s1 = fullscreenLockReducer(INITIAL_FULLSCREEN_LOCK_STATE, { type: 'manual-acquire', elId: 'calendar' })
    const s2 = fullscreenLockReducer(s1, { type: 'manual-release', elId: 'weather' })
    assert.equal(promotedElId(s2), 'calendar', 'weather never held the slot, so releasing it changes nothing')
  })

  it('a rotation tick while a manual owner exists updates slideshowElId but does not change the derived value', () => {
    const s1 = fullscreenLockReducer(INITIAL_FULLSCREEN_LOCK_STATE, { type: 'slideshow-enter', elId: 'weather' })
    const s2 = fullscreenLockReducer(s1, { type: 'manual-acquire', elId: 'calendar' })
    const s3 = fullscreenLockReducer(s2, { type: 'slideshow-rotate', elId: 'clock' })
    assert.equal(promotedElId(s3), 'calendar', 'still the manual card — nothing visible changes')
    assert.equal(s3.slideshowElId, 'clock', 'the Slideshow\'s own bookkeeping keeps moving underneath')
  })

  it('a rotation tick while no manual owner exists follows the Slideshow (regression: today\'s behavior)', () => {
    const s1 = fullscreenLockReducer(INITIAL_FULLSCREEN_LOCK_STATE, { type: 'slideshow-enter', elId: 'weather' })
    const s2 = fullscreenLockReducer(s1, { type: 'slideshow-rotate', elId: 'clock' })
    assert.equal(promotedElId(s2), 'clock')
  })
})


describe('presentingElId', () => {
  const reduce = (events: FullscreenEvent[]): FullscreenLockState =>
    events.reduce(fullscreenLockReducer, INITIAL_FULLSCREEN_LOCK_STATE)

  it('nothing is presenting on a quiet dashboard', () => {
    assert.equal(presentingElId(INITIAL_FULLSCREEN_LOCK_STATE), null)
  })

  it('the Slideshow presents the card it enters on, and the one it rotates to', () => {
    const s1 = reduce([{ type: 'slideshow-enter', elId: 'zegar' }])
    assert.equal(presentingElId(s1), 'zegar')
    const s2 = fullscreenLockReducer(s1, { type: 'slideshow-rotate', elId: 'pogoda' })
    assert.equal(presentingElId(s2), 'pogoda')
  })

  it('a card opened by hand is never presenting — that is the whole distinction', () => {
    const s1 = reduce([{ type: 'manual-acquire', elId: 'pogoda' }])
    assert.equal(promotedElId(s1), 'pogoda', 'it is fullscreen')
    assert.equal(presentingElId(s1), null, 'but being used, not presented')
  })

  it('taking manual control of the very card the Slideshow is presenting drops it to its ordinary shape', () => {
    const s1 = reduce([
      { type: 'slideshow-enter', elId: 'zegar' },
      { type: 'manual-acquire', elId: 'zegar' },
    ])
    assert.equal(promotedElId(s1), 'zegar', 'still fullscreen — nothing closes')
    assert.equal(presentingElId(s1), null, 'but no longer presented: somebody is using it')
  })

  it('manual anywhere suppresses presentation, even as the Slideshow keeps rotating underneath', () => {
    const s1 = reduce([
      { type: 'slideshow-enter', elId: 'zegar' },
      { type: 'manual-acquire', elId: 'kalendarz' },
      { type: 'slideshow-rotate', elId: 'pogoda' },
    ])
    assert.equal(presentingElId(s1), null)
    assert.equal(s1.slideshowElId, 'pogoda', 'the Slideshow\'s bookkeeping is untouched')
  })

  it('releasing manual hands the card back to presentation, with no explicit re-entry', () => {
    const s1 = reduce([
      { type: 'slideshow-enter', elId: 'zegar' },
      { type: 'manual-acquire', elId: 'kalendarz' },
      { type: 'slideshow-rotate', elId: 'pogoda' },
      { type: 'manual-release', elId: 'kalendarz' },
    ])
    assert.equal(presentingElId(s1), 'pogoda', 'whatever the Slideshow moved to while manual held the slot')
  })

  it('a Slideshow that exited while manual held the slot does not come back on release', () => {
    const s1 = reduce([
      { type: 'slideshow-enter', elId: 'zegar' },
      { type: 'manual-acquire', elId: 'zegar' },
      { type: 'slideshow-exit' },
      { type: 'manual-release', elId: 'zegar' },
    ])
    assert.equal(presentingElId(s1), null)
    assert.equal(promotedElId(s1), null)
  })
})
