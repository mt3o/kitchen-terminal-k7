/**
 * The renewal policy and the Cloudflare client, tested without a network and
 * without a certificate authority.
 *
 * What is deliberately NOT tested here is issuance itself: it needs a real
 * Cloudflare token and Let's Encrypt's staging endpoint, so it belongs in a
 * manual verification step, not in the suite that runs on every push.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createCloudflareDns } from '../src/server/tls/cloudflare.ts'
import { RENEW_BEFORE_DAYS, daysUntil, shouldRenew } from '../src/server/tls/certificate.ts'
import { isAllowedHost, isPrivateAddress } from '../src/server/security/network.ts'

const at = (days: number): Date => new Date(Date.now() + days * 86_400_000)

describe('renewal policy', () => {
  it('renews when there is nothing on disk', () => {
    assert.equal(shouldRenew(undefined), true)
  })

  it('leaves a healthy certificate alone', () => {
    const cert = { certificate: '', privateKey: '', notAfter: at(60), staging: false }
    assert.equal(shouldRenew(cert), false)
  })

  it('renews inside the threshold, and an expired cert is not a special case', () => {
    for (const days of [RENEW_BEFORE_DAYS - 1, 1, 0, -5]) {
      const cert = { certificate: '', privateKey: '', notAfter: at(days), staging: false }
      assert.equal(shouldRenew(cert), true, `should renew at ${days} days`)
    }
  })

  it('measures remaining life from a supplied clock, not the wall clock', () => {
    const notAfter = new Date('2026-12-01T00:00:00Z')
    assert.equal(Math.round(daysUntil(notAfter, new Date('2026-11-01T00:00:00Z'))), 30)
  })
})

describe('Cloudflare DNS client', () => {
  /** Records every request so the assertions can be about the wire, not the mock. */
  function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
    const calls: { url: string; init?: RequestInit }[] = []
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      return new Response(JSON.stringify(handler(url, init)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    return { impl, calls }
  }

  it('walks up the labels to find a zone the token can see', async () => {
    const { impl, calls } = stubFetch((url) =>
      url.includes('name=revert-h0m3.co.pl')
        ? { success: true, errors: [], messages: [], result: [{ id: 'zone-123' }] }
        : { success: true, errors: [], messages: [], result: [] },
    )
    const dns = createCloudflareDns('token-not-real', { fetchImpl: impl })
    assert.equal(await dns.resolveZoneId('k7.revert-h0m3.co.pl'), 'zone-123')
    // It must try the full name first — a token scoped to a subdomain zone
    // would match there, and skipping it would find the wrong zone.
    assert.ok(calls[0]?.url.includes('k7.revert-h0m3.co.pl'))
  })

  it('fails loudly when no zone matches, naming the hostname', async () => {
    const { impl } = stubFetch(() => ({ success: true, errors: [], messages: [], result: [] }))
    const dns = createCloudflareDns('token-not-real', { fetchImpl: impl })
    await assert.rejects(() => dns.resolveZoneId('k7.example.invalid'), /k7\.example\.invalid/)
  })

  it('surfaces Cloudflare error codes rather than a bare failure', async () => {
    const { impl } = stubFetch(() => ({
      success: false,
      errors: [{ code: 10000, message: 'Authentication error' }],
      messages: [],
      result: null,
    }))
    const dns = createCloudflareDns('token-not-real', { fetchImpl: impl })
    await assert.rejects(() => dns.resolveZoneId('k7.revert-h0m3.co.pl'), /10000|Authentication/)
  })

  it('never puts the token in an error message', async () => {
    const TOKEN = 'cf-super-secret-token-value'
    const { impl } = stubFetch(() => ({
      success: false,
      errors: [{ code: 9109, message: 'Invalid access token' }],
      messages: [],
      result: null,
    }))
    const dns = createCloudflareDns(TOKEN, { fetchImpl: impl })
    const err = await dns.resolveZoneId('k7.revert-h0m3.co.pl').catch((e: unknown) => e)
    assert.ok(err instanceof Error)
    assert.ok(!JSON.stringify({ m: err.message, s: err.stack }).includes(TOKEN), 'the token leaked into the error')
  })
})

describe('network boundary', () => {
  it('accepts the addresses a household actually uses', () => {
    for (const ip of ['127.0.0.1', '::1', '192.168.0.114', '10.0.0.5', '172.16.3.9', '172.31.255.254', '::ffff:192.168.1.2', 'fd00::1']) {
      assert.equal(isPrivateAddress(ip), true, `${ip} should be private`)
    }
  })

  it('rejects the public internet, including near-misses', () => {
    // 172.32 and 172.15 sit just outside the RFC1918 block, and 192.169 just
    // outside 192.168 — the classic off-by-one in a hand-rolled check.
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '192.169.0.1', '11.0.0.1', '2001:4860:4860::8888', '']) {
      assert.equal(isPrivateAddress(ip), false, `${ip} should not be private`)
    }
  })

  it('rejects a rebinding Host while accepting the real ones', () => {
    const allowed = ['k7.revert-h0m3.co.pl', '0.0.0.0']
    assert.equal(isAllowedHost('k7.revert-h0m3.co.pl', allowed), true)
    assert.equal(isAllowedHost('k7.revert-h0m3.co.pl:8443', allowed), true, 'the port is not a boundary')
    assert.equal(isAllowedHost('192.168.0.114:8080', allowed), true)
    assert.equal(isAllowedHost('localhost:5173', allowed), true)
    // The rebinding case: local packets, attacker-controlled name.
    assert.equal(isAllowedHost('rebind.evil.example', allowed), false)
    assert.equal(isAllowedHost('8.8.8.8', allowed), false)
    assert.equal(isAllowedHost(undefined, allowed), false)
  })
})

describe('the hostname is not a TLS detail', () => {
  it('accepts the configured hostname even with TLS off', () => {
    // Regression: the allowlist was keyed off a setting named for TLS, so with
    // TLS disabled the kiosk answered on its IP and returned 400 for its own
    // name — which on a tablet looks exactly like broken DNS.
    const allowed = ['k7.revert-h0m3.co.pl']
    assert.equal(isAllowedHost('k7.revert-h0m3.co.pl:8080', allowed), true)
    assert.equal(isAllowedHost('k7.revert-h0m3.co.pl', allowed), true)
  })

  it('still rejects an unrelated public name', () => {
    assert.equal(isAllowedHost('k7.revert-h0m3.co.pl', []), false, 'unset hostname must not open the allowlist')
  })
})
