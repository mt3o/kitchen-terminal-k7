import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createScrubber, REDACTED } from '../src/server/redact.ts'

const KILO = 'kilo_live_9f8e7d6c5b4a3210'
const GOOGLE = '1//0gAbCdEfGhIjKlMnOpQrStUvWxYz'

describe('createScrubber', () => {
  it('removes a known secret from anywhere in a string', () => {
    const scrub = createScrubber([KILO])
    const out = scrub(`request failed: key=${KILO} status=401`) as string
    assert.ok(!out.includes(KILO), 'the secret survived')
    assert.ok(out.includes(REDACTED))
    assert.ok(out.includes('status=401'), 'unrelated context was destroyed')
  })

  it('walks nested objects and arrays', () => {
    const scrub = createScrubber([KILO])
    const out = scrub({ a: [{ b: { c: `x ${KILO} y` } }] })
    assert.equal(JSON.stringify(out).includes(KILO), false)
  })

  it('redacts by key name even when the value looks innocuous', () => {
    const scrub = createScrubber([])
    const out = scrub({ headers: { authorization: 'abc', accept: 'application/json' } }) as {
      headers: Record<string, string>
    }
    assert.equal(out.headers.authorization, REDACTED)
    assert.equal(out.headers.accept, 'application/json', 'a harmless header was redacted')
  })

  it('catches credential shapes it was never told about', () => {
    const scrub = createScrubber([])
    for (const probe of [
      `Bearer ${'a'.repeat(40)}`,
      GOOGLE,
      'postgres://user:hunter2@db.local/k7',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    ]) {
      const out = scrub(probe) as string
      assert.ok(out.includes(REDACTED), `pattern not caught: ${probe.slice(0, 24)}`)
    }
  })

  it('ignores secrets too short to search for safely', () => {
    // A 3-character "secret" would match inside ordinary words and turn the
    // whole report into redaction noise. Refusing is the correct behaviour.
    const scrub = createScrubber(['abc'])
    assert.equal(scrub('abcdefg is a normal word-ish string'), 'abcdefg is a normal word-ish string')
  })

  it('survives a cyclic object instead of hanging the crash reporter', () => {
    const scrub = createScrubber([KILO])
    const cyclic: Record<string, unknown> = { msg: KILO }
    cyclic.self = cyclic
    const out = scrub(cyclic) as Record<string, unknown>
    assert.equal(out.msg, REDACTED)
  })

  it('leaves non-strings alone', () => {
    const scrub = createScrubber([KILO])
    assert.deepEqual(scrub({ n: 5, b: true, nil: null }), { n: 5, b: true, nil: null })
  })
})
