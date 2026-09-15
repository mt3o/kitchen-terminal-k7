/**
 * `isFetchableUrl` is the guard against SSRF via a client-supplied URL that
 * ends up fetched server-side — the vulnerability class found live in
 * `/api/calendar/week` and, still unpatched until this same fix, in
 * `/api/comic`'s `rssUrl`. These tests are what proves a malicious LAN
 * client cannot redirect either fetch at a local or private address.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isFetchableUrl } from '../src/server/security/network.ts'

describe('isFetchableUrl', () => {
  it('accepts an ordinary public https URL', () => {
    assert.equal(isFetchableUrl(new URL('https://example.com/feed.rss')), true)
  })

  it('accepts plain http too', () => {
    assert.equal(isFetchableUrl(new URL('http://example.com/feed.rss')), true)
  })

  it('rejects a non-http(s) scheme', () => {
    assert.equal(isFetchableUrl(new URL('file:///etc/passwd')), false)
    assert.equal(isFetchableUrl(new URL('ftp://example.com/x')), false)
  })

  it('rejects localhost by name', () => {
    assert.equal(isFetchableUrl(new URL('http://localhost:9443/admin')), false)
  })

  it('rejects loopback and RFC1918 addresses', () => {
    assert.equal(isFetchableUrl(new URL('http://127.0.0.1:8080/')), false)
    assert.equal(isFetchableUrl(new URL('http://192.168.0.10/portainer')), false)
    assert.equal(isFetchableUrl(new URL('http://10.0.0.5/')), false)
    assert.equal(isFetchableUrl(new URL('http://172.17.0.1/')), false) // a typical docker bridge address
  })

  it('rejects link-local addresses', () => {
    assert.equal(isFetchableUrl(new URL('http://169.254.169.254/latest/meta-data/')), false) // cloud metadata endpoint shape
  })

  // Every case below is a real bypass found live, 2026-09-15, by the peer
  // session running on the actual home server, tested offline against the
  // shipped function before this fix — not hypothetical.
  describe('bracketed IPv6 literals (what URL#hostname actually produces)', () => {
    it('rejects IPv6 loopback [::1]', () => {
      assert.equal(isFetchableUrl(new URL('http://[::1]/')), false)
    })

    it('rejects an IPv4-mapped IPv6 loopback', () => {
      assert.equal(isFetchableUrl(new URL('http://[::ffff:127.0.0.1]/')), false)
    })

    it('rejects an IPv4-mapped IPv6 RFC1918 address', () => {
      assert.equal(isFetchableUrl(new URL('http://[::ffff:192.168.1.1]/')), false)
    })

    it('rejects an IPv6 unique-local (fc00::/7) address', () => {
      assert.equal(isFetchableUrl(new URL('http://[fd00::1]/')), false)
    })

    it('rejects an IPv6 link-local (fe80::/10) address', () => {
      assert.equal(isFetchableUrl(new URL('http://[fe80::1]/')), false)
    })

    it('rejects the unspecified IPv6 address ::', () => {
      assert.equal(isFetchableUrl(new URL('http://[::]/')), false)
    })

    it('accepts a genuinely public IPv6 address', () => {
      assert.equal(isFetchableUrl(new URL('http://[2001:db8::1]/')), true)
    })
  })

  it('rejects 0.0.0.0, which reaches local listeners on Linux', () => {
    assert.equal(isFetchableUrl(new URL('http://0.0.0.0:9443/')), false)
  })

  it('rejects a trailing-dot localhost (the same DNS name, RFC 1035 root notation)', () => {
    assert.equal(isFetchableUrl(new URL('http://localhost./')), false)
  })
})
