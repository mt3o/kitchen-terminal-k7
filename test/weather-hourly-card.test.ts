/**
 * The weather card's side of k7-weather-hourly (deck k7-weather-card). The
 * text it draws is pinned by test/weather-hourly.test.ts against the pure
 * module; this file pins how K7Weather.svelte wires that module in, in the
 * same source-reading style as test/weather-presenting-fit.test.ts.
 *
 * - The strip trims against a clock that advances on EVERY load attempt
 *   ([node:0c340910]): a failed refresh keeps the last answer on screen, and
 *   its past hours must still drop off rather than freeze.
 * - Phone renders four cells, not six with two hidden, from the same 767px
 *   breakpoint the CSS uses.
 * - The strip belongs to the standard card only: maximized and presented
 *   cards show the graphs instead.
 * - The card opts into the [ + ] fullscreen button (plan-review F2: the
 *   button makes the head taller, so the standard card is measured with it).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const src = readFileSync('src/client/lib/K7Weather.svelte', 'utf8')
const script = (/<script lang="ts">([\s\S]*?)<\/script>/.exec(src) ?? [])[1] ?? ''
const markup = src.replace(/<script[\s\S]*?<\/script>/, '').replace(/<style>[\s\S]*?<\/style>/, '')
const css = ((/<style>([\s\S]*?)<\/style>/.exec(src) ?? [])[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '')

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

describe('K7Weather.svelte: the hourly strip on the standard card', () => {
  it('advances its clock on every load attempt, before the request can fail', () => {
    const body = loadBody()
    const tick = body.indexOf('nowMs = Date.now()')
    assert.ok(tick >= 0, 'load() must set nowMs = Date.now()')
    assert.ok(tick < body.indexOf('try'), 'nowMs must advance before the try, so a failed refresh still moves the strip')
  })

  it('trims through the pure module, with the response zone and that clock', () => {
    assert.match(script, /upcomingHours\(aged\?\.data\.hourly, nowMs, 72\)/)
    assert.match(script, /stripCells\(upcoming, phone \? 4 : 6, timeZone, nowMs\)/)
  })

  it('takes the phone count from the same breakpoint the CSS uses', () => {
    assert.match(script, /matchMedia\('\(max-width: 767px\)'\)/)
    assert.match(css, /\.hours\s*\{[^}]*repeat\(6, minmax\(0, 1fr\)\)/)
    assert.match(css, /@media \(max-width: 767px\)\s*\{\s*\.hours\s*\{[^}]*repeat\(4, minmax\(0, 1fr\)\)/)
  })

  it('renders the strip only on the standard card, and only when there are hours', () => {
    assert.match(markup, /\{#if strip\.length > 0 && !presenting && !manual\}/)
  })

  it('sits between the detail row and the days row', () => {
    const detail = markup.indexOf('<dl class="detail">')
    const hours = markup.indexOf('<dl class="hours"')
    const days = markup.indexOf('<ul class="days">')
    assert.ok(detail >= 0 && hours > detail && days > hours, 'order must be .detail, .hours, .days')
  })

  it('opts the card into the fullscreen button', () => {
    assert.match(markup, /<Card [^>]*\bfullscreen>/)
  })
})
