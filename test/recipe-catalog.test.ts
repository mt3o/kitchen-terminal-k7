/**
 * The recipes card's listing (recipes/catalog.ts): summaries only, the whole
 * collection, newest first — pure, no Fastify, no directory.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Recipe } from '../src/server/domain/types.ts'
import { InvalidCursorError, listCatalog } from '../src/server/recipes/catalog.ts'

function recipe(id: string, day: number, over: Partial<Recipe> = {}): Recipe {
  return {
    id,
    title: id.toUpperCase(),
    description: 'opis',
    sourceUrl: null,
    ingredients: ['mąka'],
    steps: ['piecz'],
    tags: [],
    importedAt: new Date(Date.UTC(2026, 0, day)),
    ...over,
  }
}

describe('listCatalog', () => {
  it('lists every recipe as a summary, newest first, ties by id', () => {
    const page = listCatalog([recipe('b', 1), recipe('c', 3), recipe('a', 1)])
    assert.deepEqual(
      page.items.map((r) => r.id),
      ['c', 'a', 'b'],
    )
    assert.equal(page.total, 3)
    assert.deepEqual(Object.keys(page.items[0]!).sort(), ['id', 'importedAt', 'tags', 'title'])
  })

  it('pages rather than truncates', () => {
    const many = Array.from({ length: 120 }, (_, n) => recipe(`r${n}`, n + 1))
    assert.equal(listCatalog(many, { limit: 200 }).items.length, 100, 'one page is capped at MAX_PAGE_SIZE')
  })

  it('filters by tag and counts only what matched', () => {
    const page = listCatalog([recipe('a', 1, { tags: ['obiad'] }), recipe('b', 2)], { tag: 'obiad' })
    assert.deepEqual(
      page.items.map((r) => r.id),
      ['a'],
    )
    assert.equal(page.total, 1)
  })
})

describe('listCatalog paging', () => {
  const many = Array.from({ length: 70 }, (_, n) => recipe(`r${String(n).padStart(2, '0')}`, (n % 20) + 1))

  function walk(all: Recipe[], limit: number): string[] {
    const seen: string[] = []
    let cursor: string | undefined
    for (;;) {
      const page = listCatalog(all, { cursor, limit })
      seen.push(...page.items.map((r) => r.id))
      if (!page.nextCursor) return seen
      cursor = page.nextCursor
    }
  }

  it('serves the first page and a cursor, with total the full count', () => {
    const page = listCatalog(many)
    assert.equal(page.items.length, 30)
    assert.equal(page.total, 70)
    assert.ok(page.nextCursor)
  })

  it('walking every page yields the whole list once, in order', () => {
    const full = listCatalog(many, { limit: 100 }).items.map((r) => r.id)
    assert.deepEqual(walk(many, 7), full)
    assert.deepEqual(walk(many, 30), full)
  })

  it('ends with a null cursor, including on an exact-fit last page', () => {
    assert.equal(listCatalog(many, { limit: 70 }).nextCursor, null)
    assert.equal(listCatalog([], {}).nextCursor, null)
  })

  it('never repeats a row when a recipe is saved mid-scroll', () => {
    const first = listCatalog(many, { limit: 10 })
    const newer = [...many, recipe('nowy', 28)]
    const second = listCatalog(newer, { cursor: first.nextCursor!, limit: 10 })
    const firstIds = new Set(first.items.map((r) => r.id))
    assert.ok(second.items.every((r) => !firstIds.has(r.id)))
    assert.equal(second.total, 71)
  })

  it('refuses a cursor it did not mint', () => {
    assert.throws(() => listCatalog(many, { cursor: 'nonsense' }), InvalidCursorError)
    assert.throws(
      () => listCatalog(many, { cursor: Buffer.from('{"t":"x"}').toString('base64url') }),
      InvalidCursorError,
    )
  })

  it('clamps the page size', () => {
    assert.equal(listCatalog(many, { limit: 0 }).items.length, 1)
    assert.equal(listCatalog(many, { limit: 1000 }).items.length, 70)
    assert.equal(listCatalog(many, { limit: Number.NaN }).items.length, 30)
  })
})

describe('listCatalog search', () => {
  const ids = (page: { items: { id: string }[] }): string[] => page.items.map((r) => r.id)

  it('ranks title > tags > ingredients > steps > description > url', () => {
    const all = [
      recipe('url', 6, { sourceUrl: 'https://example.test/cebula' }),
      recipe('opis', 5, { description: 'z cebulą' }),
      recipe('kroki', 4, { steps: ['podsmaż cebulę'] }),
      recipe('skladniki', 3, { ingredients: ['cebula'] }),
      recipe('tagi', 2, { tags: ['cebula'] }),
      recipe('tytul', 1, { title: 'Zupa cebulowa' }),
      recipe('nic', 7),
    ]
    assert.deepEqual(ids(listCatalog(all, { q: 'cebul' })), ['tytul', 'tagi', 'skladniki', 'kroki', 'opis', 'url'])
  })

  it('ANDs terms: typing more narrows', () => {
    const all = [recipe('a', 1, { title: 'Zupa pomidorowa' }), recipe('b', 2, { title: 'Zupa ogórkowa' })]
    assert.deepEqual(ids(listCatalog(all, { q: 'zupa' })).sort(), ['a', 'b'])
    assert.deepEqual(ids(listCatalog(all, { q: 'zupa pomidor' })), ['a'])
    assert.equal(listCatalog(all, { q: 'zupa rybna' }).total, 0)
  })

  it('folds case and Polish diacritics, ł included', () => {
    const all = [recipe('a', 1, { title: 'Żurek z kiełbasą' })]
    assert.deepEqual(ids(listCatalog(all, { q: 'ZUREK kielbasa' })), ['a'])
  })

  it('a title hit outranks any number of lower hits for the same term', () => {
    const all = [
      recipe('wszedzie', 2, {
        tags: ['jajko'],
        ingredients: ['jajko'],
        steps: ['jajko'],
        description: 'jajko',
      }),
      recipe('tytul', 1, { title: 'Jajko sadzone' }),
    ]
    assert.deepEqual(ids(listCatalog(all, { q: 'jajko' })), ['tytul', 'wszedzie'])
  })

  it('a blank query is no search, in the newest-first order', () => {
    const all = [recipe('a', 1), recipe('b', 2)]
    assert.deepEqual(ids(listCatalog(all, { q: '   ' })), ['b', 'a'])
  })

  it('pages a ranked result exactly once', () => {
    const all = Array.from({ length: 40 }, (_, n) =>
      recipe(`r${String(n).padStart(2, '0')}`, (n % 9) + 1, n % 3 === 0 ? { title: `Placki ${n}` } : { ingredients: ['placki'] }),
    )
    const full = ids(listCatalog(all, { q: 'placki', limit: 100 }))
    const walked: string[] = []
    let cursor: string | undefined
    do {
      const page = listCatalog(all, { q: 'placki', cursor, limit: 6 })
      walked.push(...ids(page))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    assert.deepEqual(walked, full)
    assert.equal(full.length, 40)
  })
})

describe('listCatalog tag facets', () => {
  const ids = (page: { items: { id: string }[] }): string[] => page.items.map((r) => r.id).sort()
  const all = [
    recipe('a', 1, { title: 'Zupa pomidorowa', tags: ['zupa', 'obiad', 'wege'] }),
    recipe('b', 2, { title: 'Zupa rybna', tags: ['zupa', 'obiad', 'ryby'] }),
    recipe('c', 3, { title: 'Sernik', tags: ['deser'] }),
    recipe('d', 4, { title: 'Pomidory z grilla', tags: ['wege'] }),
  ]

  it('ANDs selected tags with each other and with the search', () => {
    assert.deepEqual(ids(listCatalog(all, { tags: ['zupa'] })), ['a', 'b'])
    assert.deepEqual(ids(listCatalog(all, { tags: ['zupa', 'wege'] })), ['a'])
    assert.deepEqual(ids(listCatalog(all, { tags: ['wege'], q: 'pomidor' })), ['a', 'd'])
    assert.deepEqual(ids(listCatalog(all, { tags: ['wege'], q: 'grill' })), ['d'])
    assert.deepEqual(ids(listCatalog(all, { tag: 'obiad', tags: ['ryby'] })), ['b'])
  })

  it('counts facets over the current result, most common first', () => {
    assert.deepEqual(listCatalog(all, { q: 'zupa' }).tagFacets, [
      { tag: 'obiad', count: 2 },
      { tag: 'zupa', count: 2 },
      { tag: 'ryby', count: 1 },
      { tag: 'wege', count: 1 },
    ])
  })

  it('counts over the whole result, not just the page', () => {
    const facets = listCatalog(all, { limit: 1 }).tagFacets
    assert.equal(facets.find((f) => f.tag === 'wege')?.count, 2)
  })

  it("leaves out the layout's fixed tag: every result carries it", () => {
    assert.deepEqual(
      listCatalog(all, { tag: 'obiad' }).tagFacets.map((f) => f.tag),
      ['zupa', 'ryby', 'wege'],
    )
  })

  it('caps the facets, but always keeps a selected tag', () => {
    const many = Array.from({ length: 20 }, (_, n) =>
      recipe(`r${n}`, n + 1, { tags: [`t${String(n).padStart(2, '0')}`, 'wspolny'] }),
    )
    assert.equal(listCatalog(many).tagFacets.length, 12)
    const selected = listCatalog(many, { tags: ['t19'] }).tagFacets
    assert.ok(selected.some((f) => f.tag === 't19' && f.count === 1))
    const gone = listCatalog(many, { tags: ['brak'] }).tagFacets
    assert.deepEqual(gone, [{ tag: 'brak', count: 0 }])
  })
})
