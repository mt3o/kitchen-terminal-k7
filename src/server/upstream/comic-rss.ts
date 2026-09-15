/**
 * comic-of-the-day: an image pulled from a third-party RSS/Atom feed, kept
 * separate from `ascii-art.ts` on purpose. This is someone else's content —
 * attribution, keyword filtering and copyright exposure all follow from that,
 * none of which apply to the AI-generated card.
 */
import * as cheerio from 'cheerio'
import Parser from 'rss-parser'

import { resolvePinned, type LookupAllFn } from '../security/dns-pin.ts'
import { fetchWithTimeout } from './freshness.ts'

export interface ComicQuery {
  rssUrl: string
  /**
   * CSS selector only. The schema names "XPath/CSS selector" but a full XPath
   * engine was judged disproportionate for one feed-image field — flagged in
   * plan.md for a human call on whether to add one later.
   */
  itemSelector?: string
  filterKeywords?: string[]
  timeoutMs?: number
  /**
   * Test injection, matching recipe import's own `fetcher` escape hatch —
   * bypasses DNS-pinning and the dispatcher-based fetch entirely, straight
   * to a fake response. Needed because a DNS-pinned fetch goes through
   * undici's own `fetch` (`freshness.ts`'s own doc comment explains why),
   * which a `globalThis.fetch` stub cannot intercept — feed-parsing tests
   * have nothing to do with DNS safety and shouldn't need real dispatcher
   * machinery at all. Never part of the cache key.
   */
  fetcher?: (url: string) => Promise<{ text(): Promise<string> }>
  /** Only relevant without `fetcher` — a fixture DNS answer for exercising the real DNS-pinned path's own accept/reject behaviour. Defaults to real `node:dns` resolution. */
  lookupAll?: LookupAllFn
}

export interface ComicResult {
  imageUrl: string
  sourceUrl?: string
  title?: string
}

interface ComicItem {
  'media:content'?: { $?: { url?: string } }
  /**
   * rss-parser keeps `<content:encoded>` under its own literal key rather than
   * folding it into `.content` (which for plain RSS 2.0 is the `<description>`
   * text instead) — verified against the library's `lib/parser.js`. The full
   * HTML body an entry's image usually lives in is here, not in `.content`.
   */
  'content:encoded'?: string
}

const PARSER_OPTIONS: Parser.ParserOptions<Record<string, never>, ComicItem> = { customFields: { item: ['media:content'] } }

export function comicCacheKey(q: ComicQuery): string {
  const keywords = (q.filterKeywords ?? []).join('|')
  return `rss-comic:${q.rssUrl}:${q.itemSelector ?? ''}:${keywords}`
}

function matchesKeywords(item: { title?: string; contentSnippet?: string; content?: string; 'content:encoded'?: string }, keywords: string[]): boolean {
  if (keywords.length === 0) return true
  const haystack = `${item.title ?? ''} ${item.contentSnippet ?? item.content ?? ''} ${item['content:encoded'] ?? ''}`.toLowerCase()
  return keywords.some((k) => haystack.includes(k.toLowerCase()))
}

/** The first `<img src="...">` found in a blob of entry HTML, or undefined. */
function firstImgSrc(html: string): string | undefined {
  const $ = cheerio.load(html)
  return $('img').first().attr('src')
}

/** Applies `itemSelector` as a CSS selector against the entry's own HTML. */
function extractViaSelector(html: string, selector: string): string | undefined {
  const $ = cheerio.load(html)
  const el = $(selector).first()
  if (el.length === 0) return undefined
  const direct = el.attr('src')
  if (direct) return direct
  return el.find('img').first().attr('src')
}

export async function fetchComic(query: ComicQuery): Promise<ComicResult> {
  let xml: string
  if (query.fetcher) {
    // Test injection — no real network, no DNS resolution.
    const res = await query.fetcher(query.rssUrl)
    xml = await res.text()
  } else {
    // rssUrl arrived in a request — the route's own isFetchableUrl only
    // checks a literal address, not a hostname that *resolves* to one (the
    // household's own LAN A records, localtest.me, 127.0.0.1.nip.io — found
    // live, 2026-09-15, against the deployed server via a real canary
    // listener). resolvePinned closes that: one DNS lookup, reject if any
    // answer is private, then connect only to the vetted address — never
    // re-resolving, so a later DNS answer can't swap the target after the
    // check (DNS rebinding). 'error' rather than the default 'follow' for
    // the same reason: a public URL could still 3xx to an internal one.
    const { dispatcher, close } = await resolvePinned(new URL(query.rssUrl).hostname, query.lookupAll)
    try {
      const res = await fetchWithTimeout(query.rssUrl, query.timeoutMs, undefined, 'error', dispatcher)
      // Read the body before closing: the dispatcher owns the connection
      // the response body streams over, and closing it too early would cut
      // that stream off mid-read rather than just freeing an idle
      // connection.
      xml = await res.text()
    } finally {
      close()
    }
  }
  const parser = new Parser<Record<string, never>, ComicItem>(PARSER_OPTIONS)
  const feed = await parser.parseString(xml)

  const keywords = query.filterKeywords ?? []
  const item = feed.items.find((it) => matchesKeywords(it, keywords))
  if (!item) throw new Error(keywords.length > 0 ? 'no feed entry matched filterKeywords' : 'feed has no entries')

  const html = item['content:encoded'] ?? item.content ?? item.contentSnippet ?? item.summary ?? ''
  const imageUrl =
    item.enclosure?.url ??
    item['media:content']?.$?.url ??
    (query.itemSelector ? extractViaSelector(html, query.itemSelector) : undefined) ??
    firstImgSrc(html)

  if (!imageUrl) throw new Error('no image found in the matched feed entry')

  return { imageUrl, sourceUrl: item.link, title: item.title }
}
