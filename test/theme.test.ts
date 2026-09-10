/**
 * The generator is checked against the committed stylesheet.
 *
 * Switching from a hand-written tokens.css to a generated one must not change
 * the design, and "must not change" is only a claim unless something compares
 * them. These tests read the real theme file and the real stylesheet.
 */
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { parse } from 'yaml'

import { generateTokensCss, type Theme } from '../src/server/theme/generate.ts'

const theme = parse(readFileSync('design-system/themes/retro-scifi.yaml', 'utf8')) as Theme
const daylight = parse(readFileSync('design-system/themes/daylight-lab.yaml', 'utf8')) as Theme
const committed = readFileSync('design-system/tokens.css', 'utf8')
const generated = generateTokensCss(theme)

/** Read a property out of a stylesheet's first matching declaration. */
function valueOf(css: string, token: string, after = ''): string | undefined {
  const from = after ? css.indexOf(after) : 0
  const m = new RegExp(`${token}:\\s*([^;]+);`).exec(css.slice(from >= 0 ? from : 0))
  return m?.[1]?.trim()
}

describe('generated tokens match the committed stylesheet', () => {
  it('agrees on the dark-mode colours, which are the accepted wireframe palette', () => {
    for (const token of ['--bg', '--surface', '--fg', '--fg-muted', '--accent', '--signal', '--warn', '--fail', '--border', '--border-strong']) {
      assert.equal(valueOf(generated, token), valueOf(committed, token), `${token} drifted`)
    }
  })

  it('agrees on the type scale, including the 20px body size', () => {
    assert.equal(valueOf(generated, '--text-base'), '20px')
    for (const token of ['--text-xs', '--text-sm', '--text-lg', '--text-xl', '--glance-sm', '--glance-md', '--glance-lg']) {
      assert.equal(valueOf(generated, token), valueOf(committed, token), `${token} drifted`)
    }
  })

  it('agrees on shape, and radius is still zero', () => {
    assert.equal(valueOf(generated, '--radius'), '0px')
    assert.equal(valueOf(generated, '--border-w'), valueOf(committed, '--border-w'))
    assert.equal(valueOf(generated, '--border-w-strong'), valueOf(committed, '--border-w-strong'))
  })

  it('agrees on the spacing scale', () => {
    for (const step of [1, 2, 3, 4, 5, 6, 8, 12, 16]) {
      assert.equal(valueOf(generated, `--space-${step}`), valueOf(committed, `--space-${step}`), `--space-${step} drifted`)
    }
  })
})

describe('the generated stylesheet stays inside the Safari 15 floor', () => {
  it('emits no colour function past the floor', () => {
    for (const banned of ['color-mix(', 'oklch(', '@container', ':has(']) {
      assert.ok(!generated.includes(banned), `generated CSS contains ${banned}`)
    }
  })

  it('emits all three luminance modes', () => {
    for (const sel of ['[data-mode="dark"]', '[data-mode="light"]', '[data-mode="night"]']) {
      assert.ok(generated.includes(sel), `missing ${sel}`)
    }
  })
})

describe('a second theme actually produces a different design', () => {
  it('changes the colours', () => {
    // daylight-lab was written to make the swap testable rather than
    // aspirational. If this passes, the theming contract is demonstrated.
    const other = generateTokensCss(daylight)
    assert.notEqual(valueOf(other, '--bg'), valueOf(generated, '--bg'))
    assert.notEqual(valueOf(other, '--accent'), valueOf(generated, '--accent'))
  })

  it('changes shape and type too, not only colour', () => {
    const other = generateTokensCss(daylight)
    assert.notEqual(valueOf(other, '--radius'), valueOf(generated, '--radius'), 'daylight-lab is meant to be rounded')
    assert.notEqual(valueOf(other, '--font-ui'), valueOf(generated, '--font-ui'))
  })

  it('falls back to dark when a theme defines no night mode', () => {
    const noNight = { ...daylight, colors: { ...daylight.colors } } as Theme
    for (const k of Object.keys(noNight.colors)) {
      const { light, dark } = noNight.colors[k] as { light: string; dark: string }
      noNight.colors[k] = { light, dark }
    }
    const css = generateTokensCss(noNight)
    assert.equal(valueOf(css, '--bg', '[data-mode="night"]'), valueOf(css, '--bg', '[data-mode="dark"]'))
  })
})

describe('the generator emits every token the components use', () => {
  it('leaves nothing resolving to empty', () => {
    // This is the regression that shipped: five tokens the components reference
    // were absent from the generator, so on the deployed kiosk they resolved to
    // nothing — silently, because an unresolved custom property is not an error.
    const sources = execSync(
      "grep -rhoE 'var\\(--[a-z0-9-]+' src/ --include='*.css' --include='*.svelte' --include='*.ts' || true",
      { encoding: 'utf8' },
    )
    // Set inline per page by the renderer from the layout, not by the theme —
    // they are runtime layout state that happens to travel as custom properties.
    const RUNTIME = new Set(['--deck-cols', '--deck-rows', '--card-gap', '--cell-cols', '--cell-gap'])
    const used = new Set(
      [...sources.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1] as string).filter((t) => !RUNTIME.has(t)),
    )
    const emitted = new Set([...generated.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string))
    const missing = [...used].filter((t) => !emitted.has(t)).sort()
    assert.deepEqual(missing, [], `components use tokens the theme does not emit: ${missing.join(' ')}`)
  })
})
