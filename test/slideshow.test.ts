import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  INITIAL_SLIDESHOW_STATE,
  extractSlideshow,
  isForbiddenNestedSlideshow,
  slideshowReducer,
  type SlideshowConfig,
} from '../src/client/lib/slideshow.ts'
import type { Card, NormalisedLayout } from '../src/shared/layout.ts'

const baseLayout: NormalisedLayout = {
  version: 1,
  theme: 't.yaml',
  grid: { columns: 2, gap: '12px' },
  pages: [],
}

function page(id: string, cards: Card[]) {
  return { id, grid: baseLayout.grid, cards }
}

describe('extractSlideshow', () => {
  it('passes a layout through unchanged when there is no slideshow card', () => {
    const layout: NormalisedLayout = { ...baseLayout, pages: [page('main', [{ id: 'a', type: 'clock' }])] }
    const result = extractSlideshow(layout)
    assert.equal(result.config, undefined)
    assert.equal(result.warnings.length, 0)
    assert.deepEqual(result.layout, layout)
  })

  it('extracts a valid slideshow card and strips it from the page', () => {
    const layout: NormalisedLayout = {
      ...baseLayout,
      pages: [
        page('main', [
          { id: 'a', type: 'clock' },
          {
            id: 'pokaz',
            type: 'slideshow',
            params: { cardIds: ['a', 'b'], idleTriggerSeconds: 3600, intervalSeconds: 10 },
          },
        ]),
      ],
    }
    const result = extractSlideshow(layout)
    assert.equal(result.warnings.length, 0)
    assert.ok(result.config)
    assert.deepEqual(result.config?.cardIds, ['a', 'b'])
    assert.equal(result.config?.idleTriggerSeconds, 3600)
    assert.equal(result.config?.intervalSeconds, 10)
    assert.equal(result.config?.transition, 'fade', 'default transition is fade per the schema')
    assert.equal(result.config?.exitOnInteraction, true, 'defaults to true per the schema')
    assert.equal(result.config?.wakeOnPresenceRequested, false)
    assert.equal(result.layout.pages[0]?.cards.length, 1, 'the slideshow card must not occupy a grid slot')
    assert.equal(result.layout.pages[0]?.cards[0]?.id, 'a')
  })

  it('keeps only the first slideshow card and warns about extras, dropping both from the grid', () => {
    const layout: NormalisedLayout = {
      ...baseLayout,
      pages: [
        page('p1', [{ id: 'first', type: 'slideshow', params: { cardIds: ['a', 'b'], idleTriggerSeconds: 60, intervalSeconds: 5 } }]),
        page('p2', [{ id: 'second', type: 'slideshow', params: { cardIds: ['a', 'b'], idleTriggerSeconds: 60, intervalSeconds: 5 } }]),
      ],
    }
    const result = extractSlideshow(layout)
    assert.equal(result.warnings.length, 1)
    assert.match(result.warnings[0] ?? '', /only one is allowed/)
    assert.ok(result.config)
    assert.equal(result.layout.pages[0]?.cards.length, 0)
    assert.equal(result.layout.pages[1]?.cards.length, 0)
  })

  it('warns and drops a slideshow card missing required params rather than starting a broken controller', () => {
    const layout: NormalisedLayout = {
      ...baseLayout,
      pages: [page('main', [{ id: 'pokaz', type: 'slideshow', params: { cardIds: ['a'] } }])],
    }
    const result = extractSlideshow(layout)
    assert.equal(result.config, undefined)
    assert.equal(result.warnings.length, 1)
    assert.match(result.warnings[0] ?? '', /missing required params/)
    assert.equal(result.layout.pages[0]?.cards.length, 0, 'still stripped from the grid even though unusable')
  })
})

describe('isForbiddenNestedSlideshow', () => {
  it('flags a slideshow nested inside a carousel or grid', () => {
    const slide: Card = { id: 's', type: 'slideshow', params: {} }
    assert.equal(isForbiddenNestedSlideshow('carousel', slide), true)
    assert.equal(isForbiddenNestedSlideshow('grid', slide), true)
  })

  it('does not flag an ordinary card, or a slideshow used at the top level', () => {
    const clock: Card = { id: 'c', type: 'clock' }
    assert.equal(isForbiddenNestedSlideshow('carousel', clock), false)
    assert.equal(isForbiddenNestedSlideshow('weather', { id: 's', type: 'slideshow', params: {} }), false)
  })
})

describe('slideshowReducer', () => {
  const config: SlideshowConfig = {
    cardIds: ['a', 'b', 'c'],
    idleTriggerSeconds: 3600,
    intervalSeconds: 10,
    transition: 'fade',
    exitOnInteraction: true,
    wakeOnPresenceRequested: false,
  }

  it('enters fullscreen at index 0 on idle-timeout from active', () => {
    const next = slideshowReducer(INITIAL_SLIDESHOW_STATE, { type: 'idle-timeout' }, config)
    assert.deepEqual(next, { mode: 'fullscreen', index: 0 })
  })

  it('idle-timeout while already fullscreen is a no-op', () => {
    const state = { mode: 'fullscreen' as const, index: 1 }
    assert.deepEqual(slideshowReducer(state, { type: 'idle-timeout' }, config), state)
  })

  it('rotates forward and wraps on interval-tick, only while fullscreen', () => {
    const s0 = { mode: 'fullscreen' as const, index: 0 }
    const s1 = slideshowReducer(s0, { type: 'interval-tick' }, config)
    assert.deepEqual(s1, { mode: 'fullscreen', index: 1 })
    const s2 = slideshowReducer(s1, { type: 'interval-tick' }, config)
    assert.deepEqual(s2, { mode: 'fullscreen', index: 2 })
    const s3 = slideshowReducer(s2, { type: 'interval-tick' }, config)
    assert.deepEqual(s3, { mode: 'fullscreen', index: 0 }, 'wraps past the last card')

    assert.deepEqual(
      slideshowReducer(INITIAL_SLIDESHOW_STATE, { type: 'interval-tick' }, config),
      INITIAL_SLIDESHOW_STATE,
      'a tick while active does nothing',
    )
  })

  it('exits to active on interaction when exitOnInteraction is true', () => {
    const state = { mode: 'fullscreen' as const, index: 2 }
    assert.deepEqual(slideshowReducer(state, { type: 'interaction' }, config), { mode: 'active', index: 2 })
  })

  it('ignores interaction when exitOnInteraction is false', () => {
    const stubborn: SlideshowConfig = { ...config, exitOnInteraction: false }
    const state = { mode: 'fullscreen' as const, index: 2 }
    assert.deepEqual(slideshowReducer(state, { type: 'interaction' }, stubborn), state)
  })

  it('interaction while already active is a no-op', () => {
    assert.deepEqual(slideshowReducer(INITIAL_SLIDESHOW_STATE, { type: 'interaction' }, config), INITIAL_SLIDESHOW_STATE)
  })
})
