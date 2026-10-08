/**
 * Issue #101: the weather card's manual fullscreen. Source-reading tests in
 * the style of test/weather-presenting-fit.test.ts, because what they pin is
 * wiring and CSS selectors, not behaviour a DOM-free test can drive.
 *
 * - The card shows [ + ], in the `text` rank: the ghost button is 44 px tall
 *   and grows the head by 21 px, which on the 1024x768 wall cuts the 3-day
 *   row ([node:d1f56964]). The text rank keeps the 44 px touch target as an
 *   invisible hit area and lends the head only one line.
 * - Fullscreen by either cause (Slideshow or [ + ]) shows every day and the
 *   hourly graphs: the content reads the promoted store, the styles match
 *   `.k7-fullscreen-active`. Only `overflow: hidden` stays presentation-only,
 *   since a person holding the tablet can scroll and nobody can scroll a
 *   presentation.
 * - The acquiring touchstart is non-passive. Svelte 5 registers
 *   `ontouchstart` passive, so its preventDefault() did nothing and the
 *   trailing click released the fullscreen the same tap had acquired, for a
 *   card whose [ x ] lands where its [ + ] was (the top-right cell).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')

function parts(file: string): { script: string; markup: string; css: string } {
  const src = readFileSync(`src/client/lib/${file}`, 'utf8')
  const script = (/<script lang="ts">([\s\S]*?)<\/script>/.exec(src) ?? [])[1] ?? ''
  const css = stripComments((/<style>([\s\S]*?)<\/style>/.exec(src) ?? [])[1] ?? '')
  const markup = stripComments(src.replace(/<script[\s\S]*?<\/script>/, '').replace(/<style>[\s\S]*?<\/style>/, ''))
  return { script, markup, css }
}

/** Every selector in a stylesheet, flattened out of @media blocks. */
function selectors(css: string): string[] {
  const out: string[] = []
  for (const m of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const prelude = m[1].trim()
    if (!prelude.startsWith('@')) out.push(...prelude.split(',').map((s) => s.trim()))
  }
  return out
}

/** The declarations of the first rule whose selector list includes `sel`. */
function declsOf(css: string, sel: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim()).includes(sel)) return m[2]
  }
  return ''
}

describe('K7Weather.svelte: manual fullscreen (#101)', () => {
  const { script, markup, css } = parts('K7Weather.svelte')

  it('renders the [ + ] button, in the text rank', () => {
    const card = /<Card [^>]*>/.exec(markup)?.[0] ?? ''
    assert.match(card, /\bfullscreen\b/)
    assert.match(card, /fullscreenRank="text"/)
  })

  it('shows every day and the hourly graphs while promoted by either cause', () => {
    assert.match(script, /import \{[^}]*\bpromotedElIdStore\b[^}]*\} from '\.\/fullscreen-lock\.ts'/)
    assert.doesNotMatch(script, /presentingElIdStore/, 'manual fullscreen must get the big content too, not only a presentation')
    assert.match(script, /expanded = \$derived\(hostId !== undefined && \$promotedElIdStore === hostId\)/)
    assert.match(script, /daily\.slice\(1, expanded \? undefined : 4\)/)
    assert.match(script, /hasHours = \$derived\(expanded && upcoming\.length > 0\)/)
  })

  it('keys the big look on .k7-fullscreen-active, which fullscreen-lock.ts sets for both causes', () => {
    const all = selectors(css)
    assert.ok(all.some((s) => s.startsWith(':host(.k7-fullscreen-active) .glance')), 'no fullscreen .glance rule')
    const presentingOnly = all.filter((s) => s.includes('k7-slideshow-presenting'))
    assert.deepEqual(presentingOnly, [':host(.k7-slideshow-presenting) .wrap'], 'only the no-scroll rule may stay presentation-only')
    assert.match(declsOf(css, ':host(.k7-slideshow-presenting) .wrap'), /overflow:\s*hidden/)
    assert.doesNotMatch(declsOf(css, ':host(.k7-fullscreen-active) .wrap'), /overflow/, 'manual fullscreen must stay scrollable')
  })

  it('never uses the burnt k7-slideshow-active name', () => {
    assert.doesNotMatch(css, /k7-slideshow-active/)
  })
})

describe('Card.svelte: the text-rank fullscreen button', () => {
  const { script, markup, css } = parts('Card.svelte')

  it('is opt-in and additive: ghost stays the default', () => {
    assert.match(script, /fullscreenRank\?: 'ghost' \| 'text'/)
    assert.match(script, /fullscreenRank = 'ghost'/)
    assert.match(markup, /class:rank-text=\{fullscreenRank === 'text'\}/)
  })

  it('takes one line of the head, not the 44 px control height', () => {
    const rule = declsOf(css, '.fullscreen-btn.rank-text')
    assert.match(rule, /min-height:\s*0/)
    assert.match(rule, /padding:\s*0/)
    assert.match(rule, /border-style:\s*none/)
    assert.match(rule, /position:\s*relative/)
  })

  it('keeps the 44 px touch target as a hit area centred on the label', () => {
    const rule = declsOf(css, '.fullscreen-btn.rank-text::before')
    assert.match(rule, /position:\s*absolute/)
    assert.match(rule, /top:\s*calc\(50% - var\(--control-h-sm\) \/ 2\)/)
    assert.match(rule, /bottom:\s*calc\(50% - var\(--control-h-sm\) \/ 2\)/)
  })

  it('acquires on a non-passive touchstart, so preventDefault() really stops the trailing click', () => {
    assert.doesNotMatch(markup, /ontouchstart=/, 'Svelte 5 registers ontouchstart passive')
    assert.match(script, /addEventListener\('touchstart', onPointerDown, \{ passive: false \}\)/)
    assert.match(script, /removeEventListener\('touchstart', onPointerDown\)/)
  })
})
