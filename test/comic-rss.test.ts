/**
 * comic-of-the-day's feed parsing and image extraction, against real RSS/Atom
 * XML fixtures rather than mocked parser output — the shape rss-parser
 * actually returns for `<description>` vs `<content:encoded>` vs
 * `<media:content>` is exactly the kind of thing that looks obvious and isn't
 * (see the doc comment on `ComicItem` in the module under test).
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { comicCacheKey, fetchComic } from '../src/server/upstream/comic-rss.ts'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFeed(xml: string): void {
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    text: async () => xml,
  })) as unknown as typeof fetch
}

const RSS_WITH_ENCLOSURE = `<?xml version="1.0"?>
<rss version="2.0">
<channel><title>Test</title>
<item><title>Cat Comic</title><link>https://example.com/1</link>
<enclosure url="https://example.com/cat.png" type="image/png"/>
<description>a funny cat</description></item>
</channel></rss>`

const RSS_WITH_MEDIA_CONTENT = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>Test</title>
<item><title>Dog Comic</title><link>https://example.com/2</link>
<media:content url="https://example.com/dog.png"/>
<description>a funny dog</description></item>
</channel></rss>`

const RSS_WITH_ENCODED_IMG = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Test</title>
<item><title>Plain Entry</title><link>https://example.com/3</link>
<description>no enclosure here</description>
<content:encoded><![CDATA[<div class="comic"><img src="https://example.com/plain.png"/></div>]]></content:encoded>
</item>
</channel></rss>`

const RSS_TWO_ITEMS = `<?xml version="1.0"?>
<rss version="2.0">
<channel><title>Test</title>
<item><title>Space Comic</title><link>https://example.com/a</link>
<enclosure url="https://example.com/space.png"/>
<description>a comic about space travel</description></item>
<item><title>Kitchen Comic</title><link>https://example.com/b</link>
<enclosure url="https://example.com/kitchen.png"/>
<description>a comic about cooking</description></item>
</channel></rss>`

const RSS_NO_IMAGE = `<?xml version="1.0"?>
<rss version="2.0">
<channel><title>Test</title>
<item><title>Text Only</title><link>https://example.com/x</link>
<description>just words, no picture anywhere</description></item>
</channel></rss>`

describe('fetchComic', () => {
  it('prefers the enclosure image when present', async () => {
    stubFeed(RSS_WITH_ENCLOSURE)
    const result = await fetchComic({ rssUrl: 'https://feed.example/rss.xml' })
    assert.equal(result.imageUrl, 'https://example.com/cat.png')
    assert.equal(result.sourceUrl, 'https://example.com/1')
    assert.equal(result.title, 'Cat Comic')
  })

  it('falls back to media:content when there is no enclosure', async () => {
    stubFeed(RSS_WITH_MEDIA_CONTENT)
    const result = await fetchComic({ rssUrl: 'https://feed.example/rss.xml' })
    assert.equal(result.imageUrl, 'https://example.com/dog.png')
  })

  it('falls back to the first <img> in content:encoded when neither enclosure nor media:content exist', async () => {
    stubFeed(RSS_WITH_ENCODED_IMG)
    const result = await fetchComic({ rssUrl: 'https://feed.example/rss.xml' })
    assert.equal(result.imageUrl, 'https://example.com/plain.png')
  })

  it('uses itemSelector as a CSS selector against the entry HTML when given', async () => {
    stubFeed(RSS_WITH_ENCODED_IMG)
    const result = await fetchComic({ rssUrl: 'https://feed.example/rss.xml', itemSelector: '.comic img' })
    assert.equal(result.imageUrl, 'https://example.com/plain.png')
  })

  it('picks the first entry whose title or description matches filterKeywords', async () => {
    stubFeed(RSS_TWO_ITEMS)
    const result = await fetchComic({ rssUrl: 'https://feed.example/rss.xml', filterKeywords: ['cooking'] })
    assert.equal(result.imageUrl, 'https://example.com/kitchen.png')
    assert.equal(result.title, 'Kitchen Comic')
  })

  it('matches keywords case-insensitively', async () => {
    stubFeed(RSS_TWO_ITEMS)
    const result = await fetchComic({ rssUrl: 'https://feed.example/rss.xml', filterKeywords: ['SPACE'] })
    assert.equal(result.title, 'Space Comic')
  })

  it('throws when no entry matches filterKeywords, rather than serving the wrong comic', async () => {
    stubFeed(RSS_TWO_ITEMS)
    await assert.rejects(
      () => fetchComic({ rssUrl: 'https://feed.example/rss.xml', filterKeywords: ['nonexistent-topic'] }),
      /filterKeywords/,
    )
  })

  it('throws when the matched entry has no extractable image', async () => {
    stubFeed(RSS_NO_IMAGE)
    await assert.rejects(() => fetchComic({ rssUrl: 'https://feed.example/rss.xml' }), /no image/)
  })

  it('takes the first entry when no filterKeywords are given', async () => {
    stubFeed(RSS_TWO_ITEMS)
    const result = await fetchComic({ rssUrl: 'https://feed.example/rss.xml' })
    assert.equal(result.title, 'Space Comic')
  })
})

describe('comicCacheKey', () => {
  it('folds rssUrl, itemSelector and filterKeywords into the key', () => {
    const a = comicCacheKey({ rssUrl: 'https://a.example/feed.xml', filterKeywords: ['cat'] })
    const b = comicCacheKey({ rssUrl: 'https://a.example/feed.xml', filterKeywords: ['dog'] })
    const c = comicCacheKey({ rssUrl: 'https://a.example/feed.xml', itemSelector: '.x img', filterKeywords: ['cat'] })
    assert.notEqual(a, b, 'different filterKeywords collided on one cache row')
    assert.notEqual(a, c, 'different itemSelector collided on one cache row')
  })

  it('is stable for the same query', () => {
    const q = { rssUrl: 'https://a.example/feed.xml', filterKeywords: ['cat', 'dog'] }
    assert.equal(comicCacheKey(q), comicCacheKey({ ...q }))
  })
})
