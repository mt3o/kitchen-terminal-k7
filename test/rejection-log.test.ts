/**
 * sanitizeRejectionInput, tested in isolation — no Fastify, no filesystem,
 * no database. That is the point: this module was extracted specifically
 * so the scrub-then-bound order could be proven here rather than only
 * claimed in a route handler nobody exercises automatically.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createScrubber, REDACTED } from '../src/server/redact.ts'
import { sanitizeRejectionInput } from '../src/server/recipes/rejection-log.ts'

const KILO = 'kilo_live_9f8e7d6c5b4a3210'

describe('sanitizeRejectionInput', () => {
  it('redacts a secret nested anywhere in the input before bounding', () => {
    const scrub = createScrubber([KILO])
    const out = sanitizeRejectionInput({ title: `x ${KILO} y`, tags: [`also ${KILO}`] }, scrub)
    assert.equal(JSON.stringify(out).includes(KILO), false)
    assert.equal(out.title, `x ${REDACTED} y`)
    assert.deepEqual(out.tags, [`also ${REDACTED}`])
  })

  it('caps an over-length string field without producing invalid JSON', () => {
    const scrub = createScrubber([])
    const long = 'a'.repeat(5000)
    const out = sanitizeRejectionInput({ description: long }, scrub)
    assert.equal((out.description as string).length, 4000)
    // Round-trips cleanly — the point of bounding per-field rather than
    // slicing an already-serialized JSON string.
    assert.deepEqual(JSON.parse(JSON.stringify(out)), out)
  })

  it('caps an array to 200 elements, and each string element within it', () => {
    const scrub = createScrubber([])
    const out = sanitizeRejectionInput({ ingredients: Array.from({ length: 300 }, (_, i) => `item ${i}`.repeat(1000)) }, scrub)
    const ingredients = out.ingredients as string[]
    assert.equal(ingredients.length, 200)
    assert.ok(ingredients.every((s) => s.length <= 4000))
  })

  it('preserves a malformed field bounded rather than dropping it', () => {
    // Exactly the shape that failed "ingredients, steps and tags must be
    // string arrays" — the value that caused the rejection must survive so
    // the household can see and fix it on retry, not disappear.
    const scrub = createScrubber([])
    const out = sanitizeRejectionInput({ title: 'Zupa', ingredients: 'not an array', steps: 123, tags: null }, scrub)
    assert.equal(out.ingredients, 'not an array')
    assert.equal(out.steps, 123)
    assert.equal(out.tags, null)
  })

  it('leaves ordinary non-string, non-array values alone', () => {
    const scrub = createScrubber([])
    assert.deepEqual(sanitizeRejectionInput({ n: 5, b: true, nil: null }, scrub), { n: 5, b: true, nil: null })
  })

  it('keeps a null, array or bare-value body instead of throwing on the 400 path', () => {
    const scrub = createScrubber([KILO])
    assert.deepEqual(sanitizeRejectionInput(null, scrub), { value: null })
    assert.deepEqual(sanitizeRejectionInput(undefined, scrub), {})
    assert.deepEqual(sanitizeRejectionInput([`a ${KILO}`], scrub), { value: [`a ${REDACTED}`] })
    assert.equal((sanitizeRejectionInput('x'.repeat(5000), scrub).value as string).length, 4000)
  })
})
