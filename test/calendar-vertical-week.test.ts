/**
 * The week strip used to lay its seven days out side by side, each getting
 * an equal 1/7 of the card's width — at this card's actual on-screen width
 * that squeezed event titles into single-column text ("dentysta" wrapping
 * as "dent" / "ysta"). Each day is now a full-width row stacked vertically
 * instead, with the whole week scrolling as one region — matches the
 * `role="row"` each day already carried even under the old side-by-side
 * layout, which was a CSS/ARIA mismatch the old layout never noticed.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const css = (() => {
  const src = readFileSync('src/client/lib/K7Calendar.svelte', 'utf8')
  const match = /<style>([\s\S]*?)<\/style>/.exec(src)
  assert.ok(match, 'K7Calendar.svelte has no <style> block')
  return match[1]
})()

function ruleBody(selector: string): string {
  const re = new RegExp(`(?:^|\\s)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm')
  const match = re.exec(css)
  assert.ok(match, `no ${selector} rule found`)
  return match[1]
}

describe('K7Calendar.svelte lays days out as a scrollable vertical list', () => {
  it('.week stacks days as rows, not side-by-side columns', () => {
    assert.match(ruleBody('.week'), /flex-direction:\s*column/, '.week must stack days vertically')
  })

  it('.week scrolls the whole week rather than clipping days that do not fit', () => {
    assert.match(ruleBody('.week'), /overflow-y:\s*auto/, '.week must scroll vertically through the days')
  })

  it('each day row is sized to its own content, not force-stretched to fill the week', () => {
    assert.match(ruleBody('.col'), /flex:\s*0 0 auto/, '.col must size to its own content height')
  })

  // A live-server screenshot showed the event list's left edge zigzagging
  // from row to row: an auto-sized .col-head (DOW + date + a "DZIS" badge
  // on today's row only) made rows with wider headers push their events
  // further right than rows without one.
  it('.col-head has a fixed width so every row\'s content lines up on the same left edge', () => {
    assert.match(ruleBody('.col-head'), /width:\s*var\(--space-12\)/, '.col-head must not auto-size — every row needs the same width')
  })

  it('the empty-day placeholder sits next to the date instead of floating centered in empty space', () => {
    assert.match(ruleBody('.empty'), /text-align:\s*left/, '.empty must left-align, not center, so it reads as part of the date\'s row')
  })
})
