/**
 * The footer badge — `[OK]` / `[!]` / `[X]` / `[--]` — is the card's state in a
 * form that does not depend on colour (DESIGN.md §8, "Status badge"), so it is
 * read as one glyph or not at all. At 390x844 the CZAT card's footer pairs it
 * with the widget's meta ("kilo-auto/free | dziś: $0.0000", truncated at phone
 * width), and `.card-foot` could not wrap while `.badge` could shrink and
 * could break: a hyphen is a line-break opportunity, so the idle `[--]` was
 * squeezed to its min-content and drawn as "[-" over "-]" (measured: 2 line
 * boxes, 46px tall, in headless Chromium at 390x844 and 375x667, dark and
 * light).
 *
 * The contract: in both card shells the badge never breaks and never shrinks,
 * and a footer that pairs text with it wraps (DESIGN.md §6.1, "rows wrap
 * before they crush") — the badge drops to a line of its own, still at the
 * card's bottom-right, instead of being squeezed.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const LIB = 'src/client/lib'
const PHONE = /max-width:\s*767px/

interface Rule {
  media: string | null
  selectors: string[]
  decls: Map<string, string>
}

function styleBlock(src: string): string {
  const match = /<style>([\s\S]*?)<\/style>/.exec(src)
  assert.ok(match, 'component has no <style> block')
  return match[1].replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every rule in source order, with the @media it sits in (null: none). */
function parseRules(css: string): Rule[] {
  const out: Rule[] = []
  const walk = (text: string, media: string | null): void => {
    let i = 0
    for (;;) {
      const open = text.indexOf('{', i)
      if (open < 0) return
      let depth = 1
      let j = open + 1
      for (; j < text.length && depth > 0; j++) {
        if (text[j] === '{') depth++
        else if (text[j] === '}') depth--
      }
      const prelude = text.slice(i, open).trim()
      const body = text.slice(open + 1, j - 1)
      if (prelude.startsWith('@media')) walk(body, prelude.slice('@media'.length).trim())
      else if (prelude.startsWith('@supports')) walk(body, media)
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
  walk(css, null)
  return out
}

/**
 * The value `selector` ends up with for `prop`: the last declaration in source
 * order, from unconditional rules and, when `phone`, the phone breakpoint's
 * rules too. `flex` is expanded so `flex-shrink` can be asked for directly.
 */
function valueOf(rules: Rule[], selector: string, prop: string, phone = false): string | undefined {
  let value: string | undefined
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue
    if (rule.media !== null && !(phone && PHONE.test(rule.media))) continue
    for (const [p, v] of rule.decls) {
      if (p === prop) value = v
      else if (p === 'flex' && prop === 'flex-shrink') value = v === 'none' ? '0' : v.split(/\s+/)[1]
    }
  }
  return value
}

/** The first static class of every element in the shell's footer. */
function footerClasses(src: string): string[] {
  const foot = /<footer class="card-foot">([\s\S]*?)<\/footer>/.exec(src)
  assert.ok(foot, 'shell has no <footer class="card-foot">')
  return [...foot[1].matchAll(/<[a-zA-Z][\w-]*[^>]*\bclass="([^"{\s]+)/g)].map((m) => m[1])
}

for (const shell of ['Card', 'K7Card']) {
  describe(`${shell}.svelte: the footer badge is one glyph`, () => {
    const src = readFileSync(`${LIB}/${shell}.svelte`, 'utf8')
    const rules = parseRules(styleBlock(src))
    const withText = footerClasses(src).some((cls) => cls !== 'badge')

    it('the footer holds the badge', () => {
      assert.ok(footerClasses(src).includes('badge'), `${shell}.svelte's .card-foot has no .badge`)
    })

    for (const phone of [false, true]) {
      const at = phone ? 'at phone width' : 'at every width'

      it(`the badge never breaks inside its glyph, ${at}`, () => {
        assert.equal(
          valueOf(rules, '.badge', 'white-space', phone),
          'nowrap',
          `${shell}.svelte's .badge needs white-space: nowrap — "[--]" has a line-break opportunity after ` +
            'each hyphen and was drawn as "[-" over "-]" once the footer squeezed it',
        )
      })

      it(`the badge never shrinks below its glyph, ${at}`, () => {
        assert.equal(
          valueOf(rules, '.badge', 'flex-shrink', phone),
          '0',
          `${shell}.svelte's .badge needs flex-shrink: 0 — the text beside it gives way, the state carrier does not`,
        )
      })

      if (withText) {
        it(`a footer that pairs text with the badge wraps, ${at} (DESIGN.md §6.1)`, () => {
          assert.equal(
            valueOf(rules, '.card-foot', 'flex-wrap', phone),
            'wrap',
            `${shell}.svelte's .card-foot holds text beside the badge and must wrap, so that the badge drops ` +
              'to a line of its own rather than being squeezed',
          )
        })

        it(`a badge on a line of its own stays at the card's right edge, ${at}`, () => {
          assert.equal(valueOf(rules, '.badge', 'margin-left', phone), 'auto')
        })
      }
    }
  })
}

describe("Card.svelte's footer is the one that pairs text with the badge", () => {
  it('meta renders in the footer beside the badge when the head holds a widget’s own controls', () => {
    assert.deepEqual(footerClasses(readFileSync(`${LIB}/Card.svelte`, 'utf8')), ['meta', 'badge'])
  })
})
