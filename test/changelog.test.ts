import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { renderChangelog } from '../src/client/lib/changelog.ts'
import { loadChangelog } from '../src/server/changelog.ts'
import { assembleChangelog } from '../src/shared/changelog.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

function entry(date: string, title: string) {
  return { date, title, items: ['a'] }
}

describe('assembleChangelog', () => {
  it('orders newest date first, and the higher sequence number first within a date', () => {
    const changelog = assembleChangelog([
      { name: '2026-09-10-01-first.yaml', data: entry('2026-09-10', 'first') },
      { name: '2026-09-21-01-morning.yaml', data: entry('2026-09-21', 'morning') },
      { name: '2026-09-10-02-second.yaml', data: entry('2026-09-10', 'second') },
      { name: '2026-09-21-02-evening.yaml', data: entry('2026-09-21', 'evening') },
    ])
    assert.deepEqual(
      changelog.entries.map((e) => e.title),
      ['evening', 'morning', 'second', 'first'],
    )
  })

  it('keeps both entries when two changes pick the same sequence number on the same day', () => {
    const changelog = assembleChangelog([
      { name: '2026-09-21-03-alpha.yaml', data: entry('2026-09-21', 'alpha') },
      { name: '2026-09-21-03-beta.yaml', data: entry('2026-09-21', 'beta') },
    ])
    assert.deepEqual(
      changelog.entries.map((e) => e.title),
      ['beta', 'alpha'],
    )
  })

  it('accepts no files as an empty changelog', () => {
    assert.deepEqual(assembleChangelog([]), { entries: [] })
  })

  it('rejects a file name that does not follow YYYY-MM-DD-NN-slug.yaml', () => {
    for (const name of ['2026-09-21-slug.yaml', '2026-09-21-1-slug.yaml', '2026-09-21-01-Slug.yaml', '2026-09-21-01-slug.yml']) {
      assert.throws(() => assembleChangelog([{ name, data: entry('2026-09-21', 't') }]), new RegExp(name.replace(/\./g, '\\.')))
    }
  })

  it('rejects an entry whose date disagrees with its file name', () => {
    assert.throws(
      () => assembleChangelog([{ name: '2026-09-21-01-slug.yaml', data: entry('2026-09-20', 't') }]),
      /2026-09-21-01-slug\.yaml/,
    )
  })

  it('rejects an entry missing a required field, naming the file', () => {
    assert.throws(
      () => assembleChangelog([{ name: '2026-09-10-01-slug.yaml', data: { date: '2026-09-10', title: 't' } }]),
      /2026-09-10-01-slug\.yaml/,
    )
  })

  it('rejects a file that is not a mapping', () => {
    assert.throws(() => assembleChangelog([{ name: '2026-09-10-01-slug.yaml', data: ['nope'] }]))
    assert.throws(() => assembleChangelog([{ name: '2026-09-10-01-slug.yaml', data: null }]))
  })
})

describe('loadChangelog', () => {
  it('reads every entry file in a directory, skipping the README and dotfiles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'k7-changelog-'))
    try {
      await writeFile(join(dir, 'README.md'), '# not an entry\n')
      await writeFile(join(dir, '.2026-09-21-01-swap.yaml.swp'), 'not yaml: [')
      await writeFile(join(dir, '2026-09-21-01-one.yaml'), 'date: "2026-09-21"\ntitle: "jeden"\nitems:\n  - "a"\n')
      await writeFile(join(dir, '2026-09-21-02-two.yaml'), 'date: "2026-09-21"\ntitle: "dwa"\nitems:\n  - "b"\n')
      const changelog = await loadChangelog(dir)
      assert.deepEqual(
        changelog.entries.map((e) => e.title),
        ['dwa', 'jeden'],
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('names the file when one is not valid YAML', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'k7-changelog-'))
    try {
      await writeFile(join(dir, '2026-09-21-01-broken.yaml'), 'title: "unterminated\n')
      await assert.rejects(loadChangelog(dir), /2026-09-21-01-broken\.yaml/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('the repository changelog', () => {
  it('loads — every file in changelog/ is a well-formed, correctly named entry', async () => {
    const changelog = await loadChangelog(join(ROOT, 'changelog'))
    assert.ok(changelog.entries.length > 0)
  })

  // A branch cut before the move that still adds to changelog.yaml meets a
  // modify/delete conflict on merge. Resolving it by keeping the file would
  // leave that entry where nothing reads it — the household would never see it.
  it('has no single-file changelog.yaml left at the root', () => {
    assert.ok(
      !existsSync(join(ROOT, 'changelog.yaml')),
      'changelog.yaml is retired: move its entries into changelog/, one file each (see changelog/README.md)',
    )
  })
})
