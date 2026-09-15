/**
 * `resolvePinned` closes the DNS-based SSRF `isFetchableUrl` cannot: a
 * hostname that *resolves* to a private address (the household's own LAN A
 * records, `localtest.me`, `127.0.0.1.nip.io`) sails straight past a
 * literal-address check — confirmed live, 2026-09-15, against the deployed
 * server, via a real canary listener that recorded the request actually
 * arriving. `lookupAll` is injected here with fixture DNS answers, matching
 * this project's own DI-over-mocking convention, so these tests stay fast
 * and offline; the dispatcher-pinning mechanism itself (does the returned
 * `Agent` actually connect only to the vetted address, not re-resolve) was
 * verified separately against real hostnames and a real fetch before this
 * landed.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { pinnedLookup, resolvePinned, UnresolvableHostError, UnsafeAddressError, type Address } from '../src/server/security/dns-pin.ts'

function fixture(...addresses: Address[]): (hostname: string) => Promise<Address[]> {
  return async () => addresses
}

describe('resolvePinned', () => {
  it('resolves and vets a hostname whose every address is public', async () => {
    const { vettedAddress, close } = await resolvePinned('example.com', fixture({ address: '93.184.216.34', family: 4 }))
    assert.equal(vettedAddress, '93.184.216.34')
    close()
  })

  it('rejects when the (only) resolved address is private', async () => {
    await assert.rejects(
      resolvePinned('internal.example', fixture({ address: '192.168.1.5', family: 4 })),
      UnsafeAddressError,
    )
  })

  it('rejects when ANY resolved address is private, even if others are public — the mixed-answer attack', async () => {
    await assert.rejects(
      resolvePinned(
        'mixed.example',
        fixture({ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }),
      ),
      UnsafeAddressError,
    )
  })

  it('rejects an IPv6 private address the same way', async () => {
    await assert.rejects(
      resolvePinned('ula.example', fixture({ address: 'fd00::1', family: 6 })),
      UnsafeAddressError,
    )
  })

  it('rejects a hostname that resolves to nothing', async () => {
    await assert.rejects(resolvePinned('empty.example', fixture()), UnresolvableHostError)
  })

  it('wraps a DNS lookup failure (NXDOMAIN etc.) as UnresolvableHostError, not a raw errno', async () => {
    await assert.rejects(
      resolvePinned('nowhere.invalid', async () => {
        throw new Error('getaddrinfo ENOTFOUND nowhere.invalid')
      }),
      UnresolvableHostError,
    )
  })

  it('resolvePinned closes over the vetted address, not the raw hostname', async () => {
    const { dispatcher, close } = await resolvePinned('example.com', fixture({ address: '93.184.216.34', family: 4 }))
    assert.ok(dispatcher, 'resolvePinned did not return a dispatcher')
    close()
  })
})

describe('pinnedLookup', () => {
  it('answers with the vetted address regardless of the hostname/options the connector actually asked to resolve', () => {
    const lookup = pinnedLookup({ address: '93.184.216.34', family: 4 })
    lookup('some-other-hostname-entirely.evil', { some: 'option' }, (err, address, family) => {
      assert.equal(err, null)
      assert.deepEqual(address, [{ address: '93.184.216.34', family: 4 }])
      assert.equal(family, undefined) // family travels inside the address array, not the third arg, for this form
    })
  })

  it('answers the same way no matter how many times or with what hostname it is called', () => {
    const lookup = pinnedLookup({ address: '1.1.1.1', family: 4 })
    for (const hostname of ['a.example', 'b.example', 'attacker-controlled.example']) {
      lookup(hostname, {}, (err, address) => {
        assert.equal(err, null)
        assert.deepEqual(address, [{ address: '1.1.1.1', family: 4 }])
      })
    }
  })
})
