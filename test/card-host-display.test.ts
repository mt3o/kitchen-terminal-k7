/**
 * A custom-element card whose content includes an intrinsically-sized <img>
 * (comic-of-the-day, the static "image" card) needs its shadow root's :host
 * to be an explicit block box. Without it, the percentage-height chain that
 * clamps the image to the card (Card.svelte's `.card { height: 100% }` down
 * to `.comic`/`.pic { max-height: 100% }`) has no definite height to resolve
 * against on Safari — the max-height clamp is silently dropped and the image
 * renders at its natural size, overlapping the card's own header and the
 * row below it. Reproduced on a real iPad (Safari 15 / iPadOS 15) via the
 * comic-of-the-day card. K7Card.svelte already carries the fix for the
 * card-shell custom element itself; this asserts the same contract on every
 * custom element that nests a max-height-constrained <img> inside one.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const HOST_BLOCK = /:host\s*\{[^}]*display:\s*block/

function styleBlock(path: string): string {
  const src = readFileSync(path, 'utf8')
  const match = /<style>([\s\S]*?)<\/style>/.exec(src)
  assert.ok(match, `${path} has no <style> block`)
  return match[1]
}

describe('custom-element cards with a max-height-clamped <img>', () => {
  for (const component of ['K7Comic', 'K7Image']) {
    it(`${component}.svelte declares :host { display: block }`, () => {
      const css = styleBlock(`src/client/lib/${component}.svelte`)
      assert.match(
        css,
        HOST_BLOCK,
        `${component}.svelte's <style> block must set :host { display: block } — ` +
          'without it, Safari has no definite height to resolve the img\'s ' +
          'max-height: 100% against, and the image overflows the card.',
      )
    })
  }
})
