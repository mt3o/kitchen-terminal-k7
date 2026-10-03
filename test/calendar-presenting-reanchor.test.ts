/**
 * While the Slideshow presents the calendar, the list starts at today and the
 * past-day rows above it are dropped. Ending the presentation brings them
 * back above today, so the list has to re-anchor on today at that moment.
 *
 * It did not. The touch that ends the presentation reaches the list's own
 * passive touchstart (`markUserScroll`) before slideshow.ts's window
 * listener, so `userScrolledAt` is already set when `presenting` turns false
 * and the past rows return. The anchor effect bails on a non-zero
 * `userScrolledAt`, and the card showed the oldest past day at the top until
 * the 2-minute snap-back. Measured in headless Chromium at 1024x768:
 * scrollTop 0 with today's row at 374px, right after the touch.
 *
 * The contract: entering or leaving the presentation is a fresh look at the
 * list, the same as changing tab or day, so the effect that clears
 * `userScrolledAt` for a fresh look also runs when `presenting` changes.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const script = (() => {
  const src = readFileSync('src/client/lib/K7Calendar.svelte', 'utf8')
  const match = /<script lang="ts">([\s\S]*?)<\/script>/.exec(src)
  assert.ok(match, 'K7Calendar.svelte has no <script lang="ts"> block')
  return match[1].replace(/\/\/[^\n]*/g, '')
})()

/** The body of every top-level `$effect(() => { ... })`, brace-matched. */
function effectBodies(src: string): string[] {
  const bodies: string[] = []
  const marker = '$effect(() => {'
  for (let i = src.indexOf(marker); i >= 0; i = src.indexOf(marker, i + 1)) {
    const open = i + marker.length
    let depth = 1
    let j = open
    for (; j < src.length && depth > 0; j++) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') depth--
    }
    bodies.push(src.slice(open, j - 1))
  }
  return bodies
}

describe('K7Calendar.svelte re-anchors on today when a Slideshow presentation ends', () => {
  // The fresh-look reset: clears `userScrolledAt` unconditionally, as opposed
  // to the snap-back timer, which clears it only after SNAP_BACK_MS.
  const reset = effectBodies(script).find((b) => /userScrolledAt\s*=\s*0/.test(b) && !/setTimeout/.test(b))

  it('has a fresh-look reset effect', () => {
    assert.ok(reset, 'no $effect clears userScrolledAt outside the snap-back timer')
  })

  it('the reset also runs when the presentation starts or ends', () => {
    assert.match(
      reset ?? '',
      /\bpresenting\b/,
      'the fresh-look reset must depend on `presenting`: the touch that ends a presentation ' +
        'sets userScrolledAt before the past-day rows come back, and without this the list ' +
        'stays on the oldest past day until the 2-minute snap-back',
    )
  })
})
