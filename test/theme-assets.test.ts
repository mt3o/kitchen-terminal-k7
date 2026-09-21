/**
 * The asset route serves exactly what the active theme names. These are the
 * refusals that make it safe to point a URL at a directory that also holds the
 * theme's YAML.
 */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

import { assetVersion, resolveThemeAsset, themeAssetUrl } from '../src/server/theme/assets.ts'

const DIR = resolve('design-system/themes')

describe('resolveThemeAsset', () => {
  const declared = ['steampunk-brass/ornaments/gear.svg', '../../.env', 'steampunk-brass.yaml', 'steampunk-brass/../../secret.png']

  it('serves a declared file of a permitted type from inside the theme directory', () => {
    assert.deepEqual(resolveThemeAsset(DIR, 'steampunk-brass/ornaments/gear.svg', declared), {
      file: resolve(DIR, 'steampunk-brass/ornaments/gear.svg'),
      type: 'image/svg+xml',
    })
  })

  it('refuses a path the theme does not name, however plausible', () => {
    assert.equal(resolveThemeAsset(DIR, 'steampunk-brass/ornaments/frame.svg', declared), undefined)
  })

  it('refuses a declared path that climbs out of the theme directory', () => {
    assert.equal(resolveThemeAsset(DIR, 'steampunk-brass/../../secret.png', declared), undefined)
  })

  it('refuses a declared file of a type a theme may not ship', () => {
    assert.equal(resolveThemeAsset(DIR, '../../.env', declared), undefined)
    assert.equal(resolveThemeAsset(DIR, 'steampunk-brass.yaml', declared), undefined)
  })
})

describe('asset URLs', () => {
  it('carry a content version that changes with the bytes', () => {
    const a = assetVersion(new TextEncoder().encode('brass'))
    assert.match(a, /^[0-9a-f]{12}$/)
    assert.notEqual(a, assetVersion(new TextEncoder().encode('copper')))
    assert.equal(themeAssetUrl('steampunk-brass/images/clockwork.jpg', a), `/theme-assets/steampunk-brass/images/clockwork.jpg?v=${a}`)
  })

  it('encode each segment but keep the separators', () => {
    assert.equal(themeAssetUrl('a b/c#d.svg', undefined), '/theme-assets/a%20b/c%23d.svg')
  })
})
