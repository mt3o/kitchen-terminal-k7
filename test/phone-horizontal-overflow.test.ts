/**
 * At phone width (<768px) a page keeps its desktop column count, so a card
 * can be as narrow as a third of the screen — 111px on PRZEPISY at 390x844.
 * Whatever does not fit horizontally inside a card is cut off by
 * Card.svelte's `.card { overflow: hidden }`, with nothing to show it
 * happened. Measured in headless Chromium at 390x844, dark and light:
 *
 * - K7Menu (vertical, 1 of 3 columns): `.items` was a *wrapping* column
 *   flexbox. A multi-line flex container sizes each line to its widest item
 *   rather than to itself, so every button came out 135px wide in a 91px
 *   card body — 35px past the card's edge, labels cut off.
 * - The card head: `[ + ]` is deliberately `flex-shrink: 0; white-space:
 *   nowrap`, but the group it sits in had `min-width: 0` and no way to wrap,
 *   so the group shrank and the button hung out of it — 34px on k7-image,
 *   17px on k7-unsplash-carousel, 139px on k7-chat (whose MENU/ARCHIWUM/NOWA
 *   group could not wrap either), 110px on a running k7-timer.
 *
 * The contract: a card head is a row that wraps (DESIGN.md §6.1, "rows wrap
 * before they crush"), its controls live in a group of their own that wraps,
 * and every widget's own group of head controls wraps too — a nested group
 * that cannot wrap is as wide as all of its buttons together, and no
 * wrapping around it can make it narrower. Controls are never shrunk: their
 * height is the touch-target floor (--control-h-sm, DESIGN.md §8).
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const LIB = 'src/client/lib'
const PHONE = /max-width:\s*767px/

interface Rule {
  media: string | null
  selectors: string[]
  decls: Map<string, string>
}

function source(file: string): string {
  return readFileSync(`${LIB}/${file}`, 'utf8')
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
 * The value `selector` ends up with for `prop` — the last declaration in
 * source order, from unconditional rules and, when `phone`, the phone
 * breakpoint's rules too. `flex` is expanded so `flex-basis` and friends can
 * be asked for directly.
 */
function valueOf(rules: Rule[], selector: string, prop: string, phone = false): string | undefined {
  let value: string | undefined
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue
    if (rule.media !== null && !(phone && PHONE.test(rule.media))) continue
    for (const [p, v] of rule.decls) {
      if (p === prop) value = v
      else if (p === 'flex' && /^flex-(?:grow|shrink|basis)$/.test(prop)) {
        const [grow, shrink, basis] = v.split(/\s+/)
        value = { 'flex-grow': grow, 'flex-shrink': shrink, 'flex-basis': basis }[prop]
      }
    }
  }
  return value
}

/** The first static class of each element at the top level of a snippet. */
function snippetRootClasses(snippet: string): { tag: string; cls: string | undefined }[] {
  const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr'])
  const roots: { tag: string; cls: string | undefined }[] = []
  let depth = 0
  for (const m of snippet.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [, closing, tag, attrs, selfClosing] = m
    if (closing) {
      depth--
      continue
    }
    if (depth === 0) roots.push({ tag, cls: /\bclass="([^"{]*)/.exec(attrs)?.[1].trim().split(/\s+/)[0] })
    if (!selfClosing && !VOID.has(tag.toLowerCase())) depth++
  }
  return roots
}

describe('card head: controls wrap onto their own line instead of past the card edge', () => {
  const src = source('Card.svelte')
  const rules = parseRules(styleBlock(src))

  it('the head row wraps (DESIGN.md §6.1)', () => {
    assert.equal(
      valueOf(rules, '.card-head', 'flex-wrap', true),
      'wrap',
      '.card-head must wrap: its [ + ] button is flex-shrink: 0 on purpose, so a head row ' +
        'that cannot wrap pushes it past the card edge on a narrow card.',
    )
  })

  it('the controls group wraps and may shrink to the row, so a group wider than the card breaks into lines', () => {
    for (const phone of [false, true]) {
      assert.equal(valueOf(rules, '.card-head-right', 'flex-wrap', phone), 'wrap', '.card-head-right must wrap')
      assert.equal(
        valueOf(rules, '.card-head-right', 'min-width', phone),
        '0',
        '.card-head-right needs min-width: 0 so that, alone on its line and still too wide, it narrows to ' +
          'the card and wraps its controls rather than overflowing',
      )
    }
  })

  it('meta is text beside the label, not a member of the controls group', () => {
    const group = /<div class="card-head-right">([\s\S]*?)<\/header>/.exec(src)
    assert.ok(group, 'Card.svelte has no .card-head-right group in its header')
    assert.doesNotMatch(
      group[1],
      /class="meta"/,
      'meta must not share the controls group: at phone width it truncates, and a truncatable string in a ' +
        'group that wraps would either be pushed to a line of its own or push a control to one',
    )
  })

  it('at phone width the label and meta give way before the controls do, down to a floor', () => {
    assert.equal(
      valueOf(rules, '.card-head-title', 'flex-basis', true),
      '0',
      'at phone width .card-head-title must not size the line from its text (flex-basis: 0): label and meta ' +
        'truncate there (k7-mobile-responsive), so their full width must not be what pushes the controls down',
    )
    const floor = valueOf(rules, '.card-head-title', 'min-width', true)
    assert.ok(
      floor !== undefined && !/^0(?:px)?$/.test(floor),
      '.card-head-title needs a non-zero min-width at phone width, or controls that just fit beside it squeeze ' +
        'the label to nothing instead of wrapping',
    )
  })

  it('a toolbar wraps, and at phone width takes a row of its own below the title and [ + ]', () => {
    for (const phone of [false, true]) {
      assert.equal(valueOf(rules, '.card-head-toolbar', 'flex-wrap', phone), 'wrap', '.card-head-toolbar must wrap')
      assert.equal(valueOf(rules, '.card-head-toolbar', 'min-width', phone), '0')
    }
    assert.equal(valueOf(rules, '.card-head-toolbar', 'flex-basis', true), '100%')
    assert.equal(valueOf(rules, '.card-head-toolbar', 'order', true), '1')
  })

  it('[ + ] keeps its natural size and stays on one line', () => {
    assert.equal(valueOf(rules, '.fullscreen-btn', 'flex-shrink', true), '0')
    assert.equal(valueOf(rules, '.fullscreen-btn', 'white-space', true), 'nowrap')
  })
})

describe("widgets' own head controls wrap", () => {
  const withActions = readdirSync(LIB)
    .filter((f) => f.endsWith('.svelte'))
    .map((file) => ({ file, snippet: /\{#snippet actions\(\)\}([\s\S]*?)\{\/snippet\}/.exec(source(file))?.[1] }))
    .filter((w): w is { file: string; snippet: string } => w.snippet !== undefined)
    .sort((a, b) => a.file.localeCompare(b.file))

  it('finds the widgets that put controls in the card head', () => {
    assert.ok(withActions.length >= 3, `expected several widgets with an actions snippet, found ${withActions.length}`)
  })

  for (const { file, snippet } of withActions) {
    it(`${file}: every group at the top of the actions snippet wraps`, () => {
      const rules = parseRules(styleBlock(source(file)))
      // A lone control (a button) is one item; only a group of several can be
      // wider than the card while none of its members is.
      for (const root of snippetRootClasses(snippet).filter((r) => r.tag !== 'button')) {
        assert.ok(root.cls, `${file}: <${root.tag}> at the top of the actions snippet has no static class to check`)
        for (const phone of [false, true]) {
          assert.equal(
            valueOf(rules, `.${root.cls}`, 'flex-wrap', phone),
            'wrap',
            `${file}: .${root.cls} holds head controls and must wrap — otherwise it is as wide as all of its ` +
              'controls together and overflows any card narrower than that',
          )
        }
      }
    })
  }
})

describe('K7Menu fits its card', () => {
  const rules = parseRules(styleBlock(source('K7Menu.svelte')))

  it('a vertical menu is a single-line column, so its items are as wide as the menu', () => {
    const wrap = valueOf(rules, '.orientation-vertical', 'flex-wrap') ?? valueOf(rules, '.items', 'flex-wrap')
    assert.notEqual(
      wrap,
      'wrap',
      'a wrapping column flexbox sizes each line to its widest item, not to the container — every item came ' +
        'out 135px wide in a 91px card body at 390x844',
    )
  })

  it('an item never gets wider than the menu, whatever the orientation', () => {
    assert.equal(valueOf(rules, '.item', 'max-width', true), '100%')
    assert.equal(
      valueOf(rules, '.item', 'box-sizing', true),
      'border-box',
      '.item pads and borders a 100% max-width; say border-box rather than relying on the UA default for buttons',
    )
  })

  it('a label longer than the item breaks inside it rather than running out of it', () => {
    assert.equal(valueOf(rules, '.label', 'min-width', true), '0', '.label must be able to shrink below its text')
    assert.equal(
      valueOf(rules, '.label', 'overflow-wrap', true),
      'break-word',
      '.label must break a word that does not fit (break-word: `anywhere` is Safari 15.4, past the floor)',
    )
  })

  it('items keep the touch-target height at phone width', () => {
    assert.equal(valueOf(rules, '.item', 'min-height', true), 'var(--control-h-sm)')
  })
})
