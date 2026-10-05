/**
 * The card-background dealer: every variant before any repeat, no repeat
 * across a refill, a fresh deck when the theme's count changes, and slots
 * always inside what the generator emits.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CARD_BG_SLOTS, createDealer, shuffled } from '../src/client/lib/card-background.ts'
import { CARD_BG_SLOTS as GENERATED_SLOTS } from '../src/server/theme/generate.ts'

/** A seeded generator, so a failure reproduces. */
function seeded(seed: number): () => number {
  let a = seed
  return () => (a = (a * 1103515245 + 12345) % 2147483648) / 2147483648
}

describe('card-background dealer', () => {
  it('agrees with the generator on how many slots exist', () => {
    assert.equal(CARD_BG_SLOTS, GENERATED_SLOTS)
  })

  it('shuffles a permutation', () => {
    for (let seed = 1; seed < 20; seed++) {
      assert.deepEqual([...shuffled(7, seeded(seed))].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6])
    }
  })

  it('deals every variant once before any repeats', () => {
    for (let seed = 1; seed < 50; seed++) {
      const dealer = createDealer(seeded(seed))
      for (let round = 0; round < 4; round++) {
        const hand = Array.from({ length: 5 }, () => dealer.next(5))
        assert.deepEqual([...hand].sort(), [0, 1, 2, 3, 4], `seed ${seed} round ${round}: ${hand}`)
      }
    }
  })

  it('never deals the same variant twice in a row, refills included', () => {
    for (let seed = 1; seed < 200; seed++) {
      const dealer = createDealer(seeded(seed))
      let prev = -1
      for (let i = 0; i < 30; i++) {
        const v = dealer.next(3)
        assert.notEqual(v, prev, `seed ${seed} card ${i}`)
        prev = v
      }
    }
  })

  it('stays inside the emitted slots, whatever count it is given', () => {
    const dealer = createDealer(seeded(3))
    for (const count of [0, 1, 2, 5, 12, 40, Number.NaN]) {
      for (let i = 0; i < 30; i++) {
        const v = dealer.next(count)
        assert.ok(Number.isInteger(v) && v >= 0 && v < CARD_BG_SLOTS, `count ${count} dealt ${v}`)
      }
    }
  })

  it('is random: different seeds deal different orders', () => {
    const orders = new Set(Array.from({ length: 20 }, (_, s) => {
      const d = createDealer(seeded(s + 1))
      return Array.from({ length: 6 }, () => d.next(6)).join()
    }))
    assert.ok(orders.size > 5, `only ${orders.size} distinct orders`)
  })
})
