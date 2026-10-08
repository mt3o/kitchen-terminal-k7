/**
 * The transitional `steps` array on recipe API responses (#102), for a kiosk
 * still running the pre-stepsMarkdown bundle. Drop with legacy-steps.ts.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { legacyStepLines, withLegacySteps } from '../src/server/recipes/legacy-steps.ts'

describe('withLegacySteps', () => {
  const recipe = {
    id: 'tort',
    title: 'Tort',
    stepsMarkdown: '## Ciasto\n\n1. Wymieszaj.\n   - powoli\n\n2. Piecz 10 min.\n',
  }

  it('keeps every field and adds steps as the non-empty source lines, in order', () => {
    const out = withLegacySteps(recipe)
    assert.equal(out.stepsMarkdown, recipe.stepsMarkdown)
    assert.equal(out.title, 'Tort')
    assert.deepEqual(out.steps, ['## Ciasto', '1. Wymieszaj.', '- powoli', '2. Piecz 10 min.'])
  })

  it('serves what the old K7Recipes bundle reads: a string array, non-empty for a non-empty method', () => {
    // The old detail view did `detail.steps.length` and `{#each detail.steps}`;
    // the old review form did `recipe.steps.join('\n')`. Over the JSON wire.
    const old = JSON.parse(JSON.stringify(withLegacySteps(recipe))) as { steps: unknown }
    assert.ok(Array.isArray(old.steps) && old.steps.every((s) => typeof s === 'string'))
    const steps = old.steps as string[]
    assert.ok(steps.length > 0)
    assert.ok(steps.join('\n').includes('Piecz 10 min.'))
  })

  it('is an empty array for an empty method, which the old view shows as "brak"', () => {
    assert.deepEqual(withLegacySteps({ stepsMarkdown: '' }).steps, [])
    assert.deepEqual(legacyStepLines('  \n\r\n '), [])
  })
})
