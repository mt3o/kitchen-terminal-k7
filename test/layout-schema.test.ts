/**
 * `docs/handoff/layout.schema.yaml` is the layout contract, but a schema
 * nobody runs is documentation, not a contract. This is what actually runs
 * it: the committed `layout.yaml` and the worked example must validate, and
 * a stray/misspelled key must not — `additionalProperties: false` throughout
 * the schema is what makes that second half possible.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import Ajv2020 from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv'
import { parse } from 'yaml'

const schema = parse(readFileSync('docs/handoff/layout.schema.yaml', 'utf8'))
// strictRequired: false — ajv's strict mode otherwise rejects the root
// `oneOf: [{required: [cards]}, {required: [pages]}]` mutual-exclusion idiom,
// since neither branch declares `properties` of its own (they live one level
// up, on the schema those branches gate). Not a relaxation of validation
// itself: additionalProperties/type/enum checks all still run at "strict".
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false })
const validate: ValidateFunction = ajv.compile(schema)

function loadYaml(path: string): unknown {
  return parse(readFileSync(path, 'utf8'))
}

describe('layout.schema.yaml', () => {
  it('validates the committed layout.yaml', () => {
    const ok = validate(loadYaml('layout.yaml'))
    assert.equal(ok, true, JSON.stringify(validate.errors, null, 2))
  })

  it('validates the worked example in docs/handoff', () => {
    const ok = validate(loadYaml('docs/handoff/layout.example.yaml'))
    assert.equal(ok, true, JSON.stringify(validate.errors, null, 2))
  })

  it('rejects a misspelled optional param field', () => {
    const layout = loadYaml('layout.yaml') as { pages: { cards: { type: string; params: Record<string, unknown> }[] }[] }
    const weather = layout.pages.flatMap((p) => p.cards).find((c) => c.type === 'weather')!
    weather.params.forcastDays = weather.params.forecastDays
    delete weather.params.forecastDays

    assert.equal(validate(layout), false)
  })

  it("accepts layout.local.yaml's <key>Strategy layering directive, and only its known values", () => {
    const layout = loadYaml('layout.yaml') as Record<string, unknown>
    layout.mainCalendarsStrategy = 'union'
    assert.equal(validate(layout), true, JSON.stringify(validate.errors, null, 2))
    layout.mainCalendarsStrategy = 'merge'
    assert.equal(validate(layout), false)
  })

  it('rejects a card missing its required params', () => {
    const layout = loadYaml('layout.yaml') as { pages: { cards: Record<string, unknown>[] }[] }
    delete layout.pages[0]!.cards[0]!.params

    assert.equal(validate(layout), false)
  })
})
