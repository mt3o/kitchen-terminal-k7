import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { renderChangelog } from '../src/client/lib/changelog.ts'
import { parseChangelog } from '../src/shared/changelog.ts'

describe('renderChangelog', () => {
  it('renders the date, title and each item for every entry', () => {
    const html = renderChangelog({
      entries: [{ date: '2026-09-10', title: 'Tytuł', items: ['pierwsza rzecz', 'druga rzecz'] }],
    })
    assert.ok(html.includes('2026-09-10'))
    assert.ok(html.includes('Tytuł'))
    assert.ok(html.includes('pierwsza rzecz'))
    assert.ok(html.includes('druga rzecz'))
  })

  it('reports no entries rather than rendering an empty list', () => {
    const html = renderChangelog({ entries: [] })
    assert.ok(html.includes('brak wpisów'))
  })

  it('escapes a title/item containing HTML rather than injecting it', () => {
    const html = renderChangelog({
      entries: [{ date: '2026-09-10', title: '<script>alert(1)</script>', items: ['<img src=x onerror=alert(1)>'] }],
    })
    assert.ok(!html.includes('<script>'))
    assert.ok(!html.includes('<img'))
    assert.ok(html.includes('&lt;script&gt;'))
  })
})

describe('parseChangelog', () => {
  it('accepts a well-formed changelog', () => {
    const parsed = parseChangelog({ entries: [{ date: '2026-09-10', title: 't', items: ['a'] }] })
    assert.equal(parsed.entries.length, 1)
  })

  it('rejects a document with no entries key', () => {
    assert.throws(() => parseChangelog({}))
  })

  it('rejects an entry missing a required field', () => {
    assert.throws(() => parseChangelog({ entries: [{ date: '2026-09-10', title: 't' }] }))
  })

  it('rejects an entries value that is not an array', () => {
    assert.throws(() => parseChangelog({ entries: 'nope' }))
  })
})
