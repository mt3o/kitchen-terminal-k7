/**
 * The weather card's side of k7-weather-hourly (deck k7-weather-card). The
 * text it draws is pinned by test/weather-hourly.test.ts against the pure
 * module; this file pins how K7Weather.svelte wires that module in, in the
 * same source-reading style as test/weather-presenting-fit.test.ts.
 *
 * - The standard card stays exactly as it was, by the user's ruling
 *   [node:d1f56964]: no hourly strip and no [ + ] fullscreen button. On the
 *   main page its cell is 184 px of body and today's content fills it; the
 *   button's 44 px touch target alone grew the head by 21 px and cut the
 *   3-day row through the middle. Both guards below fail loudly if either
 *   comes back without that trade being re-decided.
 * - The graphs trim against a clock that advances on EVERY load attempt
 *   ([node:0c340910]): a failed refresh keeps the last answer on screen, and
 *   its past hours must still drop off rather than freeze.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const src = readFileSync('src/client/lib/K7Weather.svelte', 'utf8')
const script = (/<script lang="ts">([\s\S]*?)<\/script>/.exec(src) ?? [])[1] ?? ''
const markup = src.replace(/<script[\s\S]*?<\/script>/, '').replace(/<style>[\s\S]*?<\/style>/, '')

/** The body of `async function load(...) { ... }`, brace-matched. */
function loadBody(): string {
  const start = script.indexOf('async function load(')
  assert.ok(start >= 0, 'K7Weather.svelte has no load() function')
  const open = script.indexOf('{', start)
  let depth = 1
  let j = open + 1
  for (; j < script.length && depth > 0; j++) {
    if (script[j] === '{') depth++
    else if (script[j] === '}') depth--
  }
  return script.slice(open + 1, j - 1)
}

describe('K7Weather.svelte: the standard card keeps its height budget', () => {
  it('does not opt into the fullscreen button', () => {
    assert.doesNotMatch(
      markup,
      /<Card [^>]*\bfullscreen\b/,
      'the [ + ] button grows the head by 21 px and clips the 3-day row on the main page (node d1f56964)',
    )
  })

  it('draws no hourly strip on the standard card', () => {
    assert.doesNotMatch(markup, /class="hours"/, 'the strip was withdrawn by the user: no row to spare (node d1f56964)')
  })
})

describe('K7Weather.svelte: hourly data for the Slideshow presentation', () => {
  it('advances its clock on every load attempt, before the request can fail', () => {
    const body = loadBody()
    const tick = body.indexOf('nowMs = Date.now()')
    assert.ok(tick >= 0, 'load() must set nowMs = Date.now()')
    assert.ok(tick < body.indexOf('try'), 'nowMs must advance before the try, so a failed refresh still moves the rows')
  })
})

describe('K7Weather.svelte: graphs in the Slideshow presentation', () => {
  const css = ((/<style>([\s\S]*?)<\/style>/.exec(src) ?? [])[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '')

  it('trims through the pure module, from that clock, in the response zone', () => {
    assert.match(script, /upcomingHours\(aged\?\.data\.hourly, nowMs, 72\)/)
    assert.match(script, /timeZone = \$derived\(aged\?\.data\.timezone \?\? 'Europe\/Warsaw'\)/)
  })

  it('draws graphs only while presenting with hours; otherwise the old presentation', () => {
    assert.match(script, /hasHours = \$derived\(presenting && upcoming\.length > 0\)/)
    assert.match(markup, /\{:else if hasHours\}[\s\S]*class="graphs"[\s\S]*\{:else\}\s*\{@render hero\(aged\)\}/)
  })

  it('scopes every presented hero/graphs rule to the graph layout, so a presentation without hours is unchanged', () => {
    for (const m of css.matchAll(/([^{}]+)\{[^}]*\}/g)) {
      const sel = m[1].trim()
      if (/\.(hero|graphs)\b/.test(sel) && sel.includes('k7-slideshow-presenting')) {
        assert.match(sel, /\.has-hours|\.hero >/, `${sel} must be scoped to the graph layout`)
      }
    }
  })

  it('sizes the rows box from the layout, never from its rows ([node:21b0b80b])', () => {
    const rule = /\.g-rows\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    assert.match(rule, /flex:\s*1 1 0/)
    assert.match(rule, /min-height:\s*0/)
    assert.match(rule, /overflow:\s*hidden/)
  })

  it('caps the painted lines at 24 and paints none before the first measurement', () => {
    assert.match(script, /const MAX_LINES = 24/)
    assert.match(script, /let fit = \$state\(\{ columns: 0, lines: 0 \}\)/)
  })

  it('un-drops hero rows when the box grows, so the promotion\'s first, deck-sized frames cannot latch a drop', () => {
    assert.match(script, /el\.clientHeight > droppedAtHeight \+ 1/)
  })

  it('hides the ASCII from screen readers and gives them one sentence instead', () => {
    assert.match(markup, /class="g-text g-head" aria-hidden="true"/)
    assert.match(markup, /<p class="g-summary">\{summary\}<\/p>/)
  })
})
