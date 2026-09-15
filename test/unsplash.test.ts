/**
 * unsplash-carousel's upstream: request shape, the mapping to what the card
 * renders, and the two things that must not regress silently — the access key
 * only ever goes to api.unsplash.com, and attribution links carry the referral
 * parameters Unsplash's guidelines require.
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { fetchUnsplashPhotos, randomPhotosUrl, unsplashCacheKey, withReferral } from '../src/server/upstream/unsplash.ts'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

interface Call {
  url: string
  headers: Record<string, string>
}

function stub(body: unknown): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
    return { ok: true, status: 200, json: async () => body }
  }) as unknown as typeof fetch
  return calls
}

function apiPhoto(id: string, downloadLocation = `https://api.unsplash.com/photos/${id}/download?ixid=abc`) {
  return {
    id,
    alt_description: `photo ${id}`,
    description: null,
    urls: { raw: `https://images.unsplash.com/photo-${id}?ixid=abc`, regular: `https://images.unsplash.com/photo-${id}?w=1080` },
    links: { html: `https://unsplash.com/photos/${id}`, download_location: downloadLocation },
    user: { name: `Author ${id}`, links: { html: `https://unsplash.com/@author${id}` } },
  }
}

const OPTIONS = { accessKey: 'test-access-key', appName: 'k7_test' }
const flush = () => new Promise((r) => setImmediate(r))

describe('randomPhotosUrl', () => {
  it('prefers collections over query, since Unsplash rejects both together', () => {
    const u = new URL(randomPhotosUrl({ query: 'cat', collections: '123', count: 5, widthPx: 800 }))
    assert.equal(u.searchParams.get('collections'), '123')
    assert.equal(u.searchParams.get('query'), null)
  })

  it('clamps count to the API maximum of 30', () => {
    const u = new URL(randomPhotosUrl({ query: 'cat', count: 99, widthPx: 800 }))
    assert.equal(u.searchParams.get('count'), '30')
  })
})

describe('fetchUnsplashPhotos', () => {
  it('authenticates with Client-ID and maps photos with sized URLs and referral links', async () => {
    const calls = stub([apiPhoto('a'), apiPhoto('b')])
    const photos = await fetchUnsplashPhotos({ query: 'cat', count: 2, widthPx: 800 }, OPTIONS)

    assert.equal(calls[0]?.headers.Authorization, 'Client-ID test-access-key')
    assert.equal(photos.length, 2)
    const first = photos[0]!
    const img = new URL(first.imageUrl)
    assert.equal(img.searchParams.get('w'), '800')
    assert.equal(img.searchParams.get('ixid'), 'abc', 'ixid must survive resizing so views are counted')
    assert.equal(first.altText, 'photo a')
    assert.equal(first.photographerName, 'Author a')
    assert.equal(new URL(first.photographerUrl).searchParams.get('utm_source'), 'k7_test')
    assert.equal(new URL(first.photoUrl).searchParams.get('utm_medium'), 'referral')
  })

  it('pings each download_location, and never sends the key to another host', async () => {
    const calls = stub([apiPhoto('a'), apiPhoto('b', 'https://evil.example/steal')])
    await fetchUnsplashPhotos({ query: 'cat', count: 2, widthPx: 800 }, OPTIONS)
    await flush()

    const pings = calls.slice(1).map((c) => c.url)
    assert.deepEqual(pings, ['https://api.unsplash.com/photos/a/download?ixid=abc'])
  })

  it('throws on an empty set rather than caching a blank carousel', async () => {
    stub([])
    await assert.rejects(fetchUnsplashPhotos({ query: 'cat', count: 2, widthPx: 800 }, OPTIONS), /no photos/)
  })

  it('accepts a single photo object, which /photos/random returns without count', async () => {
    stub(apiPhoto('solo'))
    const photos = await fetchUnsplashPhotos({ count: 1, widthPx: 800 }, OPTIONS)
    assert.equal(photos[0]?.id, 'solo')
  })
})

describe('unsplashCacheKey / withReferral', () => {
  it('folds every request-shaping param into the key', () => {
    const base = { query: 'cat', count: 10, widthPx: 1080 }
    assert.notEqual(unsplashCacheKey(base), unsplashCacheKey({ ...base, count: 11 }))
    assert.notEqual(unsplashCacheKey(base), unsplashCacheKey({ ...base, widthPx: 800 }))
    assert.notEqual(unsplashCacheKey(base), unsplashCacheKey({ ...base, orientation: 'portrait' }))
  })

  it('keeps existing query params', () => {
    const u = new URL(withReferral('https://unsplash.com/photos/a?x=1', 'k7'))
    assert.equal(u.searchParams.get('x'), '1')
    assert.equal(u.searchParams.get('utm_source'), 'k7')
  })
})
