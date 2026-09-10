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
 * K7ShoppingList.svelte already establishes the fix for exactly this
 * situation: its scrollable region is `flex: 1 1 auto; min-height: 0;
 * overflow-y: auto` (see layout.yaml's comment on the zakupy card: "sharing
 * a column with another card gives it four visible rows and a scrollbar").
 * `.presets` needs the same three declarations so the overflow is reachable
 * by scroll instead of invisibly cut off.
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

describe('K7Timer.svelte .presets scrolls instead of clipping', () => {
  const src = readFileSync('src/client/lib/K7Timer.svelte', 'utf8')
  const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(src)
  assert.ok(styleMatch, 'K7Timer.svelte has no <style> block')
  const css = styleMatch[1]
  const rule = ruleBody(css, '.presets')

  it('is allowed to shrink below its content size', () => {
    assert.match(rule, /min-height:\s*0/, '.presets must set min-height: 0 to shrink inside the flex column')
  })

  it('scrolls its own overflow rather than relying on the card to clip it', () => {
    assert.match(rule, /overflow-y:\s*auto/, '.presets must set overflow-y: auto so extra preset rows are reachable')
  })
})
