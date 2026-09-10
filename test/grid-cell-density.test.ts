/**
 * SIATKA (the `grid` card type) nests full Card-shell custom elements inside
 * a fraction of a page cell's room. Card.svelte/K7Card.svelte read their
 * padding, min-height and glance-digit size from --card-pad/--card-min-h/
 * --glance-sm — CSS custom properties, which inherit through the shadow
 * boundary — so K7Grid.svelte's `.cells` wrapper can shrink them for every
 * nested cell just by overriding those properties, without either side
 * knowing about it. Reproduced on a real device: a nested clock's
 * --glance-sm digits (48px) were wide enough on their own to overflow a
 * small SIATKA cell.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const css = (() => {
  const src = readFileSync('src/client/lib/K7Grid.svelte', 'utf8')
  const match = /<style>([\s\S]*?)<\/style>/.exec(src)
  assert.ok(match, 'K7Grid.svelte has no <style> block')
  const cellsMatch = /\.cells\s*\{([^}]*)\}/.exec(match[1])
  assert.ok(cellsMatch, 'K7Grid.svelte has no .cells rule')
  return cellsMatch[1]
})()

describe('K7Grid.svelte .cells shrinks nested cards to fit', () => {
  it('reduces card padding for nested cells', () => {
    assert.match(css, /--card-pad:\s*var\(--space-2\)/, '.cells must shrink --card-pad for nested cards')
  })

  it('releases the minimum card height so a cell can be shorter than a full card', () => {
    assert.match(css, /--card-min-h:\s*0/, '.cells must zero --card-min-h for nested cards')
  })

  it('shrinks the glance-tier digits (the clock overflow) to the smaller --text-xl size', () => {
    assert.match(css, /--glance-sm:\s*var\(--text-xl\)/, '.cells must shrink --glance-sm so a nested clock fits its cell')
  })

  it('steps --text-base down without also redefining --text-sm on the same rule', () => {
    // A same-rule self-reference (--text-sm: var(--text-xs) declared here
    // too) would collapse --text-base/--text-sm/--text-xs to one size,
    // since --text-base's var(--text-sm) resolves against this rule's own
    // cascaded --text-sm, not the pre-override value. See K7Grid.svelte's
    // comment on the .cells rule.
    assert.match(css, /--text-base:\s*var\(--text-sm\)/, '.cells must step --text-base down to the old --text-sm')
    assert.doesNotMatch(css, /--text-sm:\s*var\(--text-xs\)/, '.cells must not also redefine --text-sm — it would collapse the whole chain to one size')
  })
})
