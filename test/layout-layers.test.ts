/**
 * `layerLayout` hands all of the merging to config-layers — these tests are
 * the proof that the layout's shape lets it: a local file written with
 * layout.yaml's own keys adds a calendar, amends one field of a tracked one,
 * and replaces or extends `mainCalendars`, with no hand-written merge step.
 * Run against the real library, not a stub, since its merge rules are the
 * whole point.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'

import { layerLayout } from '../src/server/layout-layers.ts'
import type { Layout } from '../src/shared/layout.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const BASE: Layout = {
  version: 1,
  theme: 'x',
  grid: { columns: 2 },
  pages: [{ id: 'p1', cards: [{ id: 'kalendarz', type: 'calendar', params: { view: 'week' } }] }],
  calendars: {
    'google-primary': { name: 'Google', source: { mode: 'google', calendarId: 'primary' } },
    swieta: { name: 'Święta', source: { mode: 'google', calendarId: 'pl.polish#holiday@group.v.calendar.google.com' } },
  },
  mainCalendars: ['google-primary', 'swieta'],
}

const PERSONAL = { name: 'Mój kalendarz', source: { mode: 'google' as const, calendarId: 'someone@example.com' } }

describe('layerLayout', () => {
  it('with no local file, normalises the tracked calendars into a list in declaration order', () => {
    const layout = layerLayout(BASE, {})
    assert.deepEqual(
      layout.calendars.map((c) => c.id),
      ['google-primary', 'swieta'],
    )
    assert.deepEqual(layout.calendars[0], { id: 'google-primary', name: 'Google', source: { mode: 'google', calendarId: 'primary' } })
    assert.deepEqual(layout.mainCalendars, ['google-primary', 'swieta'])
  })

  it('a calendar under the same `calendars` key is added after the tracked ones', () => {
    const layout = layerLayout(BASE, { calendars: { 'moj-kalendarz': PERSONAL } })
    assert.deepEqual(
      layout.calendars.map((c) => c.id),
      ['google-primary', 'swieta', 'moj-kalendarz'],
    )
    assert.deepEqual(layout.calendars[2], { id: 'moj-kalendarz', ...PERSONAL })
  })

  it('writing a tracked id changes only the fields given, keeping the rest and the tab order', () => {
    const layout = layerLayout(BASE, { calendars: { 'google-primary': { source: { calendarId: 'someone@example.com' } } } } as never)
    assert.deepEqual(layout.calendars[0], {
      id: 'google-primary',
      name: 'Google',
      source: { mode: 'google', calendarId: 'someone@example.com' },
    })
    assert.equal(layout.calendars.length, 2)
  })

  it('a local `mainCalendars` replaces the tracked list by default — config-layers treats a list as one unit', () => {
    const layout = layerLayout(BASE, { calendars: { 'moj-kalendarz': PERSONAL }, mainCalendars: ['moj-kalendarz'] })
    assert.deepEqual(layout.mainCalendars, ['moj-kalendarz'])
  })

  it('`mainCalendarsStrategy: union` extends the tracked list instead, without duplicates', () => {
    const layout = layerLayout(BASE, {
      calendars: { 'moj-kalendarz': PERSONAL },
      mainCalendars: ['swieta', 'moj-kalendarz'],
      mainCalendarsStrategy: 'union',
    })
    assert.deepEqual(layout.mainCalendars, ['google-primary', 'swieta', 'moj-kalendarz'])
    assert.equal('mainCalendarsStrategy' in layout, false, 'the merge directive is not part of the normalised layout')
  })

  it('a plain field overrides the same way — the local file is just a partial layout.yaml', () => {
    assert.equal(layerLayout(BASE, { theme: 'inny.yaml' }).theme, 'inny.yaml')
  })

  it('never touches the caller’s layer objects', () => {
    const local = { calendars: { 'moj-kalendarz': PERSONAL } }
    layerLayout(BASE, local)
    assert.deepEqual(Object.keys(BASE.calendars!), ['google-primary', 'swieta'])
    assert.deepEqual(Object.keys(local.calendars), ['moj-kalendarz'])
  })

  it('an id in mainCalendars that is not a configured calendar is a layout error, not a silently empty tab', () => {
    assert.throws(() => layerLayout(BASE, { mainCalendars: ['literowka'] }), /mainCalendars names "literowka"/)
  })

  it('a layout with no calendars at all normalises to empty lists', () => {
    const layout = layerLayout({ ...BASE, calendars: undefined, mainCalendars: undefined }, {})
    assert.deepEqual(layout.calendars, [])
    assert.deepEqual(layout.mainCalendars, [])
  })

  it('the tracked layout.yaml layers cleanly with layout.local.yaml.example', async () => {
    const base = parse(await readFile(resolve(ROOT, 'layout.yaml'), 'utf8')) as Layout
    const example = parse(await readFile(resolve(ROOT, 'layout.local.yaml.example'), 'utf8')) as Record<string, unknown>
    const layout = layerLayout(base, example)
    const ids = layout.calendars.map((c) => c.id)
    assert.ok(ids.includes('przyklad'))
    assert.ok(layout.mainCalendars.includes('przyklad'))
    for (const id of base.mainCalendars ?? []) assert.ok(layout.mainCalendars.includes(id), `${id} kept in mainCalendars`)
  })
})
