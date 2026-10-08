/**
 * The clock card's date line ("poniedziałek, 21 września") is K7Card.svelte's
 * `.body`, set at the card's `--text-base` (20px). At phone width the GLOWNA
 * page puts the clock in a half-width card, and its longest word, the weekday
 * with its comma, is wider than that card's content box. The word cannot
 * break, so it runs past the right border: at 375x667 (iPhone 6s) the comma
 * painted 0.5px over it, and at 390x844 the word overran the content box by
 * 3px. Measured in headless Chromium on 2026-10-08, every mode.
 *
 * Ruling (k7-clock-date-phone-fit): at phone width the date steps one token
 * down to `--text-sm`. That follows the precedent of stepping down one notch
 * per media query (the timer readout, the presented weather card), and it does
 * not break words or shorten the copy.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const SRC = readFileSync('src/client/lib/K7Card.svelte', 'utf8')
const TOKENS = readFileSync('design-system/tokens.css', 'utf8')
const PHONE = /max-width:\s*767px/

/**
 * The content box of a half-width GLOWNA card at 375x667, the narrowest
 * household phone (iPhone 6s): a 165.5px card less its phone padding and
 * frame. Measured in Chromium against the production build. Re-measure it if
 * the phone grid or the card's phone padding changes.
 */
const HALF_CARD_CONTENT_375 = 145.5

/** Source Code Pro, the default theme's `--font-ui`, advances 600/1000 em per glyph. */
const MONO_ADVANCE = 0.6

function styleBlock(src: string): string {
  const match = /<style>([\s\S]*?)<\/style>/.exec(src)
  assert.ok(match, 'component has no <style> block')
  return match[1].replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The last `font-size` set on `.body` by a rule whose @media matches `media` (null: unconditional). */
function bodyFontSize(css: string, phone: boolean): string | undefined {
  let value: string | undefined
  const rule = /(@media[^{]*)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}|([^{}@]+)\{([^{}]*)\}/g
  for (const m of css.matchAll(rule)) {
    const blocks = m[1]
      ? PHONE.test(m[1]) && phone
        ? [...m[2].matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((b) => [b[1], b[2]])
        : []
      : [[m[3], m[4]]]
    for (const [prelude, body] of blocks) {
      if (!prelude.split(',').map((s) => s.trim()).includes('.body')) continue
      const decl = /(?:^|;)\s*font-size:\s*([^;]+)/.exec(body)
      if (decl) value = decl[1].trim()
    }
  }
  return value
}

/** A `var(--token)` resolved against the default theme's `:root`, in px. */
function px(value: string): number {
  const name = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
  assert.ok(name, `expected a token reference, got ${value}`)
  const decl = new RegExp(`${name}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(TOKENS)
  assert.ok(decl, `${name} has no px value in tokens.css`)
  return Number(decl[1])
}

/** The longest run the date line cannot break: a Polish weekday plus its comma. */
function longestDateWord(): string {
  const fmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })
  let longest = ''
  for (let day = 0; day < 366; day++) {
    for (const word of fmt.format(new Date(2026, 0, 1 + day)).split(' ')) {
      if (word.length > longest.length) longest = word
    }
  }
  return longest
}

describe("K7Card.svelte: the clock's date fits a half-width card at phone width", () => {
  const css = styleBlock(SRC)
  // .card sets --text-base, and .body inherits it unless a rule sets its own.
  const base = 'var(--text-base)'

  it('the longest date word is the weekday with its comma', () => {
    assert.equal(longestDateWord(), 'poniedziałek,')
  })

  it('at phone width the longest date word fits the content box of a half-width card at 375px', () => {
    const size = px(bodyFontSize(css, true) ?? base)
    const width = longestDateWord().length * MONO_ADVANCE * size
    assert.ok(
      width <= HALF_CARD_CONTENT_375,
      `"${longestDateWord()}" is ${width}px at ${size}px, wider than the ${HALF_CARD_CONTENT_375}px content box: ` +
        'it cannot break, so it runs past the card border',
    )
  })

  it('the phone step is exactly one notch, --text-sm, and goes no smaller', () => {
    assert.equal(bodyFontSize(css, true), 'var(--text-sm)')
  })

  it('the wall keeps the date at the card size: no unconditional font-size on .body', () => {
    assert.equal(bodyFontSize(css, false), undefined)
  })
})
