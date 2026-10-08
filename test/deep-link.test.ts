import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  INITIAL_ROUTER_STATE,
  type HistoryOp,
  type Route,
  type RouterEvent,
  type RouterState,
  createDeepLinkRouter,
  deepLinkReducer,
  parseRoute,
  serializeRoute,
} from '../src/client/lib/deep-link.ts'
import {
  acquireManual,
  configure,
  enterSlideshow,
  exitSlideshow,
  manualElIdStore,
  releaseManual,
  rotateSlideshow,
} from '../src/client/lib/fullscreen-lock.ts'

describe('parseRoute / serializeRoute', () => {
  const routes: [string, Route][] = [
    ['#/p/kuchnia', { kind: 'page', pageId: 'kuchnia' }],
    ['#/p/kuchnia/card/przepisy?fs=1', { kind: 'page', pageId: 'kuchnia', cardId: 'przepisy', fullscreen: true }],
    ['#/p/kuchnia/card/przepisy', { kind: 'page', pageId: 'kuchnia', cardId: 'przepisy' }],
    ['#/recipe/nalesniki-2026', { kind: 'recipe', recipeId: 'nalesniki-2026' }],
  ]

  for (const [hash, route] of routes) {
    it(`round-trips ${hash}`, () => {
      assert.deepEqual(parseRoute(hash), route)
      assert.equal(serializeRoute(route), hash)
    })
  }

  it('encodes ids that are not URL-safe and decodes them back', () => {
    const route: Route = { kind: 'recipe', recipeId: 'żurek / babci?' }
    const hash = serializeRoute(route)
    assert.ok(!hash.slice(2).includes('?'), 'the id cannot start a query string')
    assert.deepEqual(parseRoute(hash), route)
  })

  it('reads anything it does not recognise as home', () => {
    for (const hash of ['', '#', '#/', 'kuchnia', '#/x/kuchnia', '#/p/', '#/p/a/b', '#/recipe/', '#/recipe/a/b', '#/p/%E0%A4%A']) {
      assert.deepEqual(parseRoute(hash), { kind: 'home' }, hash)
    }
  })

  it('treats fs other than 1 as not fullscreen', () => {
    assert.deepEqual(parseRoute('#/p/a/card/b?fs=0'), { kind: 'page', pageId: 'a', cardId: 'b' })
  })
})

function run(events: RouterEvent[], from: RouterState = INITIAL_ROUTER_STATE): { state: RouterState; ops: HistoryOp[] } {
  let state = from
  const ops: HistoryOp[] = []
  for (const event of events) {
    const step = deepLinkReducer(state, event)
    state = step.state
    if (step.history) ops.push(step.history)
  }
  return { state, ops }
}

/** Booted on page `a` with nothing in the hash: the URL is filled in by replace. */
function booted(): RouterState {
  const { state, ops } = run([
    { type: 'apply-start', route: { kind: 'home' } },
    { type: 'page-shown', pageId: 'a' },
    { type: 'apply-end' },
  ])
  assert.deepEqual(ops, [{ op: 'replace', url: '#/p/a' }])
  return state
}

describe('deepLinkReducer', () => {
  it('a page change by a person pushes', () => {
    const { ops } = run([{ type: 'page-shown', pageId: 'b' }], booted())
    assert.deepEqual(ops, [{ op: 'push', url: '#/p/b' }])
  })

  it('manual fullscreen pushes, and releasing it pushes the page back', () => {
    const { ops } = run(
      [
        { type: 'manual-fullscreen', cardId: 'kalendarz' },
        { type: 'manual-fullscreen', cardId: null },
      ],
      booted(),
    )
    assert.deepEqual(ops, [
      { op: 'push', url: '#/p/a/card/kalendarz?fs=1' },
      { op: 'push', url: '#/p/a' },
    ])
  })

  it('opening a recipe pushes #/recipe/<id>; closing it pushes the page', () => {
    const { ops } = run(
      [
        { type: 'recipe-shown', recipeId: 'zupa' },
        { type: 'recipe-shown', recipeId: null },
      ],
      booted(),
    )
    assert.deepEqual(ops, [
      { op: 'push', url: '#/recipe/zupa' },
      { op: 'push', url: '#/p/a' },
    ])
  })

  it('an open recipe outranks paging away from it', () => {
    const { ops } = run(
      [
        { type: 'recipe-shown', recipeId: 'zupa' },
        { type: 'page-shown', pageId: 'b' },
      ],
      booted(),
    )
    assert.deepEqual(ops, [{ op: 'push', url: '#/recipe/zupa' }])
  })

  it('applying a route (Back/Forward) never pushes, whatever the UI reports meanwhile', () => {
    const start = run([{ type: 'manual-fullscreen', cardId: 'k' }, { type: 'page-shown', pageId: 'b' }], booted()).state
    // Back to #/p/a: the UI releases fullscreen and pages — each an event.
    const { state, ops } = run(
      [
        { type: 'apply-start', route: parseRoute('#/p/a') },
        { type: 'manual-fullscreen', cardId: null },
        { type: 'page-shown', pageId: 'a' },
        { type: 'apply-end' },
      ],
      start,
    )
    assert.deepEqual(ops, [])
    assert.equal(state.url, '#/p/a')
  })

  it('a cold-loaded recipe link stays put while the card fetches it, and its late announcement is not a push', () => {
    const { ops } = run([
      { type: 'apply-start', route: parseRoute('#/recipe/zupa') },
      { type: 'page-shown', pageId: 'przepisy' },
      { type: 'apply-end' },
      { type: 'recipe-shown', recipeId: 'zupa' },
    ])
    assert.deepEqual(ops, [])
  })

  it('a link to a recipe that is missing falls back by replace, not push', () => {
    const { ops } = run([
      { type: 'apply-start', route: parseRoute('#/recipe/nie-ma') },
      { type: 'page-shown', pageId: 'przepisy' },
      { type: 'apply-end' },
      { type: 'recipe-shown', recipeId: null, fallback: true },
    ])
    assert.deepEqual(ops, [{ op: 'replace', url: '#/p/przepisy' }])
  })

  it('an unknown page id falls back silently to what is shown, by replace', () => {
    const { ops } = run(
      [{ type: 'apply-start', route: parseRoute('#/p/nie-ma') }, { type: 'apply-end' }],
      booted(),
    )
    assert.deepEqual(ops, [{ op: 'replace', url: '#/p/a' }])
  })

  it('a fullscreen link to an unknown card falls back to its page, by replace', () => {
    const { ops } = run(
      [
        { type: 'apply-start', route: parseRoute('#/p/b/card/nie-ma?fs=1') },
        { type: 'page-shown', pageId: 'b' },
        { type: 'apply-end' },
      ],
      booted(),
    )
    assert.deepEqual(ops, [{ op: 'replace', url: '#/p/b' }])
  })

  it('writes nothing before any page is known', () => {
    assert.deepEqual(run([{ type: 'manual-fullscreen', cardId: null }]).ops, [])
  })
})

/** A fake address bar + history, recording every write. */
function fakeHost(initialHash = '') {
  let hash = initialHash
  const ops: HistoryOp[] = []
  let applyImpl: (route: Route) => void = () => {}
  return {
    ops,
    setHash(next: string) {
      hash = next
    },
    onApply(fn: (route: Route) => void) {
      applyImpl = fn
    },
    host: {
      readHash: () => hash,
      push: (url: string) => {
        hash = url
        ops.push({ op: 'push', url })
      },
      replace: (url: string) => {
        hash = url
        ops.push({ op: 'replace', url })
      },
      apply: (route: Route) => applyImpl(route),
    },
  }
}

describe('createDeepLinkRouter', () => {
  it('popstate applies the route without pushing, and a repeated sync for the same hash is a no-op', () => {
    const fake = fakeHost('#/p/a')
    const router = createDeepLinkRouter(fake.host)
    let applied = 0
    fake.onApply((route) => {
      applied++
      if (route.kind === 'page') router.dispatch({ type: 'page-shown', pageId: route.pageId })
    })
    router.syncFromLocation({ force: true })
    router.dispatch({ type: 'page-shown', pageId: 'b' })
    assert.deepEqual(fake.ops, [{ op: 'push', url: '#/p/b' }])

    // Back: the browser has already put #/p/a in the bar and fires popstate
    // (and on some browsers hashchange as well).
    fake.setHash('#/p/a')
    router.syncFromLocation()
    router.syncFromLocation()
    assert.equal(applied, 2, 'boot + one Back; the duplicate hashchange applied nothing')
    assert.deepEqual(fake.ops, [{ op: 'push', url: '#/p/b' }], 'Back pushed nothing')
  })

  it('hold() keeps a re-render\'s own events out of history', () => {
    const fake = fakeHost('#/p/b')
    const router = createDeepLinkRouter(fake.host)
    fake.onApply((route) => {
      if (route.kind === 'page') router.dispatch({ type: 'page-shown', pageId: route.pageId })
    })
    router.syncFromLocation({ force: true })
    router.hold()
    router.dispatch({ type: 'page-shown', pageId: 'a' }) // the new pager starts on page 1
    router.dispatch({ type: 'manual-fullscreen', cardId: null }) // configure() resets the lock
    router.syncFromLocation({ force: true })
    assert.deepEqual(fake.ops, [])
  })
})

describe('the Slideshow never writes history', () => {
  it('entering, rotating and leaving fullscreen on idle produce no history entry; a person\'s tap does', () => {
    const fake = fakeHost('#/p/a')
    const router = createDeepLinkRouter(fake.host)
    fake.onApply((route) => {
      if (route.kind === 'page') router.dispatch({ type: 'page-shown', pageId: route.pageId })
    })

    // The same bridge main.ts uses: fullscreen-lock's MANUAL owner store.
    const fakeEl = { classList: { add() {}, remove() {} } }
    configure({
      track: { style: { transform: '' } } as unknown as HTMLElement,
      pager: { go() {}, current: () => 0, suspend() {}, resume() {}, destroy() {} },
      slideshow: { suspend() {}, resume() {} },
      doc: { getElementById: () => fakeEl } as unknown as Document,
    })
    const unsubscribe = manualElIdStore.subscribe((cardId) => router.dispatch({ type: 'manual-fullscreen', cardId }))
    router.syncFromLocation({ force: true })

    enterSlideshow('zegar')
    for (let i = 0; i < 50; i++) rotateSlideshow(i % 2 ? 'pogoda' : 'kalendarz')
    exitSlideshow()
    assert.deepEqual(fake.ops, [], 'idle rotation is not navigation')

    acquireManual('kalendarz')
    releaseManual('kalendarz')
    assert.deepEqual(fake.ops, [
      { op: 'push', url: '#/p/a/card/kalendarz?fs=1' },
      { op: 'push', url: '#/p/a' },
    ])
    unsubscribe()
  })
})
