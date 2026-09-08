/**
 * The test this slice exists for.
 *
 * Unit-testing the scrubber proves the function works. It does not prove the
 * function is *wired in* — and a redactor that is never called is worse than no
 * redactor, because it makes everyone confident. So this drives the real SDK
 * with a transport that captures the envelope on its way to the wire, and
 * asserts on the bytes that would have reached GlitchTip.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { initObservability, Sentry } from '../src/server/observability.ts'

const KILO_KEY = 'kilo_live_9f8e7d6c5b4a3210deadbeef'
const GOOGLE_REFRESH = '1//0gAbCdEfGhIjKlMnOpQrStUvWxYz'

/** Everything the SDK tried to send, serialized the way the wire would see it. */
const sent: string[] = []

function capturingTransport() {
  return {
    send: async (envelope: unknown) => {
      sent.push(JSON.stringify(envelope))
      return {}
    },
    flush: async () => true,
  }
}

describe('GlitchTip reporting', () => {
  after(async () => {
    await Sentry.close(2000)
  })

  it('is off, not broken, when no DSN is configured', () => {
    assert.equal(initObservability({ dsn: undefined, secrets: [KILO_KEY] }), false)
  })

  it('scrubs a secret out of the envelope that would reach the wire', async () => {
    const on = initObservability({
      // A syntactically valid DSN pointing nowhere: the transport below means
      // nothing is actually dialled.
      dsn: 'https://examplePublicKey@o0.ingest.glitchtip.test/0',
      environment: 'test',
      secrets: [KILO_KEY, GOOGLE_REFRESH],
      transport: capturingTransport as never,
    })
    assert.equal(on, true, 'reporting should be enabled with a DSN')

    // The realistic shape: a request fails and the key rides along in the
    // message, in structured context, and in a header.
    Sentry.withScope((scope) => {
      scope.setExtra('request', {
        url: `https://api.kilo.ai/api/gateway/chat?key=${KILO_KEY}`,
        headers: { authorization: `Bearer ${KILO_KEY}` },
      })
      scope.setContext('google', { refresh_token: GOOGLE_REFRESH })
      Sentry.captureException(new Error(`gateway rejected key ${KILO_KEY}`))
    })

    await Sentry.flush(2000)

    assert.ok(sent.length > 0, 'the SDK sent nothing — the test proves nothing')
    const wire = sent.join('\n')

    assert.ok(!wire.includes(KILO_KEY), 'the Kilo Gateway key reached the wire')
    assert.ok(!wire.includes(GOOGLE_REFRESH), 'the Google refresh token reached the wire')
    // And the report is still useful: an error stripped of everything is a
    // redactor that "passes" by destroying the evidence.
    assert.ok(wire.includes('gateway rejected key'), 'the error message was destroyed')
    assert.ok(wire.includes('[redacted]'), 'nothing was actually redacted')
  })
})
