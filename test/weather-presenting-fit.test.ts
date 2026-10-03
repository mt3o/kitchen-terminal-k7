/**
 * The Slideshow is declared in the shared layout.yaml, so a phone presents
 * the weather card too, not just the 1024x768 wall. The presentation look
 * first shipped centred with `justify-content: center`, a `flex-wrap: nowrap`
 * row and `overflow: hidden`, sized for the wall. Measured in headless
 * Chromium:
 *
 * - 375x667: the 112px temperature ran to x=424 inside a card body ending at
 *   x=365. Centred overflow spills past both edges, so the start of the row
 *   was cut off too.
 * - 667x375: the content was 360px tall in a 296px box, clipped top and
 *   bottom.
 *
 * The contract: a presented row may wrap; centring gives way when content
 * does not fit (auto margins collapse to zero on overflow, whereas
 * `justify-content`/`align-items: center` overflow both ways, and
 * `safe center` is Safari 15.4+, past this project's floor); and at the
 * phone breakpoint the presentation steps down from the wall's sizes.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const PRESENTING = ':host(.k7-slideshow-presenting)'
const PHONE = /max-width:\s*767px/

interface Rule {
  media: string | null
  selectors: string[]
  decls: Map<string, string>
}

const css = (() => {
  const src = readFileSync('src/client/lib/K7Weather.svelte', 'utf8')
  const match = /<style>([\s\S]*?)<\/style>/.exec(src)
  assert.ok(match, 'K7Weather.svelte has no <style> block')
  return match[1].replace(/\/\*[\s\S]*?\*\//g, '')
})()

/** Every rule in source order, with the @media it sits in (null: none). */
function parseRules(text: string, media: string | null = null, out: Rule[] = []): Rule[] {
  let i = 0
  for (;;) {
    const open = text.indexOf('{', i)
    if (open < 0) return out
    let depth = 1
    let j = open + 1
    for (; j < text.length && depth > 0; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
    }
    const prelude = text.slice(i, open).trim()
    const body = text.slice(open + 1, j - 1)
    if (prelude.startsWith('@media')) parseRules(body, prelude.slice('@media'.length).trim(), out)
    else if (!prelude.startsWith('@')) {
      const decls = new Map<string, string>()
      for (const d of body.split(';')) {
        const colon = d.indexOf(':')
        if (colon > 0) decls.set(d.slice(0, colon).trim(), d.slice(colon + 1).trim())
      }
      out.push({ media, selectors: prelude.split(',').map((s) => s.trim()), decls })
    }
    i = j
  }
}

const presenting = parseRules(css).filter((r) => r.selectors.some((s) => s.startsWith(PRESENTING)))

/** Last value of `prop` on the presented `inner` selector; `phone` adds the phone breakpoint. */
function valueOf(inner: string, prop: string, phone = false): string | undefined {
  let value: string | undefined
  for (const rule of presenting) {
    if (!rule.selectors.includes(`${PRESENTING} ${inner}`)) continue
    if (rule.media !== null && !(phone && PHONE.test(rule.media))) continue
    if (rule.decls.has(prop)) value = rule.decls.get(prop)
  }
  return value
}

describe('K7Weather.svelte: the Slideshow presentation fits a phone', () => {
  it('no presented row refuses to wrap', () => {
    for (const rule of presenting) {
      assert.notEqual(
        rule.decls.get('flex-wrap'),
        'nowrap',
        `${rule.selectors.join(', ')} must not be nowrap: a row wider than a phone is cut off on both sides`,
      )
    }
  })

  it('.wrap does not centre with justify-content/align-items, which overflow past both edges', () => {
    for (const phone of [false, true]) {
      assert.notEqual(valueOf('.wrap', 'justify-content', phone), 'center', '.wrap must centre with auto margins instead')
      assert.notEqual(valueOf('.wrap', 'align-items', phone), 'center', '.wrap must centre with auto margins instead')
    }
  })

  it('the presented content is centred with auto margins, which collapse when it does not fit', () => {
    const rule = presenting.find((r) => r.selectors.includes(`${PRESENTING} .wrap > *`))
    assert.ok(rule, `no ${PRESENTING} .wrap > * rule centring the children`)
    assert.equal(rule.decls.get('margin-left'), 'auto')
    assert.equal(rule.decls.get('margin-right'), 'auto')
    const first = presenting.find((r) => r.selectors.includes(`${PRESENTING} .wrap > :first-child`))
    const last = presenting.find((r) => r.selectors.includes(`${PRESENTING} .wrap > :last-child`))
    assert.equal(first?.decls.get('margin-top'), 'auto', 'the first child needs margin-top: auto')
    assert.equal(last?.decls.get('margin-bottom'), 'auto', 'the last child needs margin-bottom: auto')
  })

  it('the rows are spaced only by .wrap\'s gap, not by their grid-cell margins', () => {
    // The auto-margin rules override left/right (and the outer top/bottom)
    // only; a base `margin: 0 0 var(--space-2)` left standing adds 8px
    // above the next row on the wall.
    assert.equal(valueOf('.detail', 'margin-top'), '0', 'presented .detail must zero its top margin')
    assert.equal(valueOf('.detail', 'margin-bottom'), '0', 'presented .detail must zero its bottom margin')
    assert.equal(valueOf('.stale', 'margin-top'), '0', 'presented .stale must zero its top margin')
  })

  it('at the phone breakpoint the temperature steps down from the wall size', () => {
    const phone = valueOf('.glance', 'font-size', true)
    assert.ok(phone, 'presented .glance has no font-size')
    assert.notEqual(phone, 'var(--glance-lg)', 'a 112px temperature does not fit beside its art on a 375px phone')
  })
})
