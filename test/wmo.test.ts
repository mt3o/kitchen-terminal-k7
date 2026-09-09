import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ageLabel, describeWeather, isSevere } from '../src/client/lib/wmo.ts'

describe('WMO codes', () => {
  it('names the codes Open-Meteo actually returns', () => {
    assert.equal(describeWeather(0), 'bezchmurnie')
    assert.equal(describeWeather(3), 'zachmurzenie calkowite')
    assert.equal(describeWeather(95), 'burza')
  })

  it('reports an unknown code instead of guessing', () => {
    // The numbering is sparse — 4..44 do not exist — so a lookup miss is
    // normal input, not a bug, and must not render as blank or as "clear".
    assert.equal(describeWeather(42), 'kod 42')
    assert.equal(describeWeather(-1), 'kod -1')
  })

  it('flags the conditions that change plans', () => {
    assert.equal(isSevere(95), true)
    assert.equal(isSevere(0), false)
  })
})

describe('ageLabel', () => {
  it('says "now" only when it is genuinely fresh', () => {
    assert.equal(ageLabel(0), 'teraz')
    assert.equal(ageLabel(89), 'teraz')
  })

  it('switches to a real age past the freshness window', () => {
    assert.equal(ageLabel(600), '10 min temu')
    assert.equal(ageLabel(7200), '2 godz. temu')
    assert.equal(ageLabel(180000), '2 dni temu')
  })
})
