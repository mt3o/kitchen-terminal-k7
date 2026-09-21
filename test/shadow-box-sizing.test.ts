/**
 * app.css's `*, *::before, *::after { box-sizing: border-box }` stops at every
 * shadow boundary, and every widget is a Svelte custom element with its own
 * shadow root — so inside a widget, everything is content-box unless the
 * component says otherwise. Card.svelte's `.card { height: 100%; padding:
 * var(--card-pad); border: var(--border-w-strong) ... }` therefore came out
 * 2×padding + 2×border taller than its grid cell (337px in a 293px cell on
 * GLOWNA at 1024x768, retro theme), and `.page > *`'s `overflow: hidden`
 * clipped the difference — the bottom border and the footer status badge
 * never showed, on every card of every page.
 *
 * The contract: a shadow-root rule that sizes an element against its
 * container (`100%` on a width/height/min/max) and also gives it padding or a
 * border must declare `box-sizing: border-box`, or the box ends up larger
 * than the container it was sized to. Controls sized by
 * `min-height: var(--control-h*)` are deliberately outside this rule — that
 * is a touch-target size, not a container fit.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const LIB = 'src/client/lib'

const CONTAINER_SIZED = /^(?:min-|max-)?(?:width|height)$/
const BOX_EDGE = /^(?:padding|border)(?:-(?:top|right|bottom|left))?(?:-width)?$/
const ZERO_EDGE = /^(?:0(?:px)?(?:\s+0(?:px)?)*|none)$/

function styleBlock(path: string): string | undefined {
  const match = /<style>([\s\S]*?)<\/style>/.exec(readFileSync(path, 'utf8'))
  return match?.[1].replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Declarations per selector, merged across every rule in the block —
 * including ones inside @media, since a breakpoint that adds padding to a
 * container-sized element reintroduces the overflow at that breakpoint.
 */
function declarationsBySelector(css: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  // Innermost `selector { body }` pairs; an @media prelude never matches
  // because its own body contains braces.
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = [...rule[2].matchAll(/([\w-]+)\s*:\s*([^;]+)/g)].map((d) => [d[1].trim(), d[2].trim()] as const)
    for (const selector of rule[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const merged = out.get(selector) ?? new Map<string, string>()
      for (const [prop, value] of decls) merged.set(prop, value)
      out.set(selector, merged)
    }
  }
  return out
}

function offenders(css: string): string[] {
  const found: string[] = []
  for (const [selector, decls] of declarationsBySelector(css)) {
    const sized = [...decls].filter(([p, v]) => CONTAINER_SIZED.test(p) && v === '100%')
    const edged = [...decls].filter(([p, v]) => BOX_EDGE.test(p) && !ZERO_EDGE.test(v))
    if (sized.length === 0 || edged.length === 0) continue
    if (decls.get('box-sizing') === 'border-box') continue
    found.push(`${selector} { ${[...sized, ...edged].map(([p, v]) => `${p}: ${v}`).join('; ')} }`)
  }
  return found
}

describe('shadow-root box sizing', () => {
  // The reported defect, asserted directly on the two card shells.
  for (const shell of ['Card', 'K7Card']) {
    it(`${shell}.svelte's .card is border-box, so it fits the grid cell it is sized to`, () => {
      const css = styleBlock(`${LIB}/${shell}.svelte`)
      assert.ok(css, `${shell}.svelte has no <style> block`)
      assert.equal(
        declarationsBySelector(css).get('.card')?.get('box-sizing'),
        'border-box',
        `${shell}.svelte's .card must set box-sizing: border-box — app.css's global rule ` +
          'does not reach inside a shadow root, and content-box makes the card ' +
          '2×padding + 2×border taller than its cell, clipping its own footer.',
      )
    })
  }

  // The same defect anywhere else in a widget's shadow root.
  for (const file of readdirSync(LIB).filter((f) => f.endsWith('.svelte')).sort()) {
    it(`${file}: no container-sized rule with padding/border is content-box`, () => {
      const css = styleBlock(`${LIB}/${file}`)
      if (!css) return
      assert.deepEqual(
        offenders(css),
        [],
        `${file}: these rules size an element to 100% of its container and add padding/border, ` +
          'but stay content-box inside the shadow root — add box-sizing: border-box.',
      )
    })
  }
})
