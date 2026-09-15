/**
 * MINUTNIK's preset-minutes buttons (`.presets`, a flex-wrap block) can need
 * more vertical room than the card's grid row actually gives it — on the
 * GLOWNA page it shares a column with zegar/pogoda and gets 1/3 of the page
 * height, while the default nine presets (layout.yaml's presetsMinutes)
 * wrap into three button rows plus the "WLASNY CZAS" custom-time row below.
 * Card.svelte's `.card { overflow: hidden }` then silently clips whatever
 * doesn't fit — reproduced on a real iPad, where the third preset row is cut
 * off mid-button.
 *
 * The scroll lives on `.idle-wrap` (the outer flex column), not on
 * `.presets` alone: k7-mobile-responsive's 2-column phone pass found that
 * `.custom`'s own natural height (label, two number fields, START button)
 * can exceed what's left after `.presets` shrinks to nothing, and `.custom`
 * itself had no shrink/scroll escape hatch — the START button spilled past
 * the card boundary as an unreadable clipped blob.
 *
 * `.presets` deliberately does NOT shrink (`flex: 0 0 auto`, no
 * `min-height: 0`) — a real-browser desktop-width check caught that letting
 * it shrink while it has no overflow-clipping of its own let overflowing
 * button rows spill visually past its shrunk box and collide with
 * `.custom`'s text below it (flex-wrap children are not clipped by a
 * shrunk parent unless that parent sets its own `overflow`). Rendering
 * `.presets` at natural size and letting `.idle-wrap`'s `overflow-y: auto`
 * reveal the excess via scroll — rather than fighting the flex algorithm
 * for space — keeps both the presets and the custom-duration form reachable
 * with no overlap, same as K7ShoppingList.svelte's `.wrap`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

function ruleBody(css: string, selector: string): string {
  const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`)
  const match = re.exec(css)
  assert.ok(match, `no ${selector} rule found`)
  return match[1]
}

describe('K7Timer.svelte scrolls instead of clipping', () => {
  const src = readFileSync('src/client/lib/K7Timer.svelte', 'utf8')
  const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(src)
  assert.ok(styleMatch, 'K7Timer.svelte has no <style> block')
  const css = styleMatch[1]
  const presetsRule = ruleBody(css, '.presets')
  const wrapRule = ruleBody(css, '.idle-wrap')

  it('.presets renders at its natural size rather than shrinking and spilling into .custom', () => {
    assert.doesNotMatch(
      presetsRule,
      /flex:\s*1/,
      '.presets must not be flex-shrinkable (flex: 1 ...) — a shrunk box with no overflow clipping of its own lets overflowing button rows visually spill into .custom below it',
    )
  })

  it('.idle-wrap scrolls its own overflow rather than relying on the card to clip it', () => {
    assert.match(
      wrapRule,
      /overflow-y:\s*auto/,
      '.idle-wrap must set overflow-y: auto so both presets and the custom-duration form are reachable',
    )
  })
})
