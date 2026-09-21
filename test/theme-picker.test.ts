/**
 * The per-tab theme picker: which theme ids the server will honour, and what
 * the client asks for. The server side reads the real themes directory.
 */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

import { themeAssetUrl } from '../src/server/theme/assets.ts'
import { listThemes, pickThemePath, themeId, THEMES_DIR } from '../src/server/theme/catalogue.ts'
import { selectedThemeId, themeSheetHref } from '../src/client/lib/theme-picker.ts'

const ROOT = resolve('.')
const LAYOUT_THEME = 'design-system/themes/retro-scifi.yaml'

describe('listThemes', () => {
  it('lists every theme file by id with its own name, and nothing else in the directory', async () => {
    const themes = await listThemes(resolve(ROOT, THEMES_DIR))
    const ids = themes.map((t) => t.id)
    for (const id of ['retro-scifi', 'daylight-lab', 'steampunk-brass', 'punktomat']) assert.ok(ids.includes(id), id)
    assert.equal(themes.find((t) => t.id === 'retro-scifi')?.name, 'Retro sci-fi HUD')
    // Asset directories (steampunk-brass/, punktomat/) are not themes.
    assert.equal(ids.length, new Set(ids).size)
    assert.ok(themes.every((t) => !t.id.includes('/')))
  })
})

describe('pickThemePath', () => {
  const catalogue = [
    { id: 'retro-scifi', name: 'Retro' },
    { id: 'daylight-lab', name: 'Daylight' },
  ]

  it('uses the layout theme when nothing is requested', () => {
    assert.equal(pickThemePath(ROOT, LAYOUT_THEME, undefined, catalogue), resolve(ROOT, LAYOUT_THEME))
  })

  it('uses a requested theme that is in the catalogue', () => {
    assert.equal(pickThemePath(ROOT, LAYOUT_THEME, 'daylight-lab', catalogue), resolve(ROOT, THEMES_DIR, 'daylight-lab.yaml'))
  })

  it('falls back to the layout theme for an id it does not know, including anything path-shaped', () => {
    for (const id of ['gone', '../../layout', '../themes/daylight-lab', '/etc/passwd', 'daylight-lab.yaml']) {
      assert.equal(pickThemePath(ROOT, LAYOUT_THEME, id, catalogue), resolve(ROOT, LAYOUT_THEME), id)
    }
  })
})

describe('themeId', () => {
  it('is the basename without .yaml', () => {
    assert.equal(themeId(LAYOUT_THEME), 'retro-scifi')
  })
})

describe('session theme URLs', () => {
  it('asks for the plain sheet for no choice or the default, and a query otherwise', () => {
    assert.equal(themeSheetHref(null, 'retro-scifi'), '/theme.css')
    assert.equal(themeSheetHref('retro-scifi', 'retro-scifi'), '/theme.css')
    assert.equal(themeSheetHref('steampunk-brass', 'retro-scifi'), '/theme.css?theme=steampunk-brass')
  })

  it('carries the theme on its asset URLs so the route checks the right declarations', () => {
    assert.equal(themeAssetUrl('punktomat/decor/cork.svg', 'abc', 'punktomat'), '/theme-assets/punktomat/decor/cork.svg?v=abc&theme=punktomat')
    assert.equal(themeAssetUrl('punktomat/decor/cork.svg', undefined, 'punktomat'), '/theme-assets/punktomat/decor/cork.svg?theme=punktomat')
  })

  it('shows the stored choice only while the catalogue still has it', () => {
    const catalogue = { default: 'retro-scifi', themes: [{ id: 'retro-scifi', name: 'R' }, { id: 'punktomat', name: 'P' }] }
    assert.equal(selectedThemeId(catalogue, 'punktomat'), 'punktomat')
    assert.equal(selectedThemeId(catalogue, 'deleted'), 'retro-scifi')
    assert.equal(selectedThemeId(catalogue, null), 'retro-scifi')
  })
})
