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
})
