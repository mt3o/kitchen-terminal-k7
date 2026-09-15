/**
 * unsplash-carousel: a set of photos from the Unsplash API, for a card that
 * rotates through them.
 *
 * Kept server-side for the same reason as every other upstream here: the
 * access key never reaches the iPad. The browser gets hotlinked image URLs and
 * the attribution that goes with them — Unsplash's API guidelines require both
 * (images are served from their CDN, not re-hosted; every photo credits its
 * photographer and Unsplash, each linked with `utm_source`/`utm_medium`).
 *
 * The demo tier allows 50 requests an hour. One `/photos/random?count=N` call
 * fetches a whole set, and the route caches it for hours, so a kiosk that
 * reloads all day spends a handful of requests, not a budget.
 */
import { fetchWithTimeout } from './freshness.ts'

const API_BASE = 'https://api.unsplash.com'
/** `/photos/random` caps `count` at 30. */
export const UNSPLASH_MAX_COUNT = 30

export type UnsplashOrientation = 'landscape' | 'portrait' | 'squarish'

export interface UnsplashQuery {
  /** Free-text topic, e.g. "kitchen" or "cats". Ignored by Unsplash when `collections` is set. */
  query?: string
  /** Comma-separated collection ids. */
  collections?: string
  orientation?: UnsplashOrientation
  count: number
  /** Width the imgix CDN resizes to; the card never needs the 5000px original. */
  widthPx: number
}

export interface UnsplashPhoto {
  id: string
  imageUrl: string
  altText: string
  photographerName: string
  photographerUrl: string
  photoUrl: string
}

export interface UnsplashOptions {
  accessKey: string
  appName: string
  timeoutMs?: number
}

/** The subset of Unsplash's photo object this module reads. */
interface ApiPhoto {
  id: string
  alt_description?: string | null
  description?: string | null
  urls: { raw: string; regular: string }
  links: { html: string; download_location: string }
  user: { name: string; links: { html: string } }
}

export function unsplashCacheKey(q: UnsplashQuery): string {
  return `unsplash:${q.query ?? ''}:${q.collections ?? ''}:${q.orientation ?? ''}:${q.count}:${q.widthPx}`
}

function authHeaders(accessKey: string): Record<string, string> {
  return { Authorization: `Client-ID ${accessKey}`, 'Accept-Version': 'v1' }
}

/** Appends the referral parameters Unsplash requires on attribution links. */
export function withReferral(url: string, appName: string): string {
  const u = new URL(url)
  u.searchParams.set('utm_source', appName)
  u.searchParams.set('utm_medium', 'referral')
  return u.toString()
}

/**
 * Sizes an image through Unsplash's imgix CDN. Built off `urls.raw`, which keeps
 * the `ixid` Unsplash uses to count views — dropping it is how hotlinking
 * silently stops counting.
 */
function sizedImageUrl(photo: ApiPhoto, widthPx: number): string {
  const u = new URL(photo.urls.raw)
  u.searchParams.set('w', String(widthPx))
  u.searchParams.set('fit', 'max')
  u.searchParams.set('q', '80')
  u.searchParams.set('auto', 'format')
  return u.toString()
}

export function randomPhotosUrl(q: UnsplashQuery): string {
  const u = new URL(`${API_BASE}/photos/random`)
  u.searchParams.set('count', String(Math.min(Math.max(1, q.count), UNSPLASH_MAX_COUNT)))
  if (q.collections) u.searchParams.set('collections', q.collections)
  else if (q.query) u.searchParams.set('query', q.query)
  if (q.orientation) u.searchParams.set('orientation', q.orientation)
  u.searchParams.set('content_filter', 'high')
  return u.toString()
}

/**
 * Tells Unsplash the photo was used, which their guidelines ask for.
 *
 * Only ever sent to Unsplash's own API host: the URL comes out of a response
 * body, and it carries the access key in a header — a response that pointed it
 * anywhere else would otherwise be handed the key.
 */
async function trackDownload(downloadLocation: string, options: UnsplashOptions): Promise<void> {
  if (!downloadLocation.startsWith(`${API_BASE}/`)) return
  await fetchWithTimeout(downloadLocation, options.timeoutMs, authHeaders(options.accessKey))
}

export async function fetchUnsplashPhotos(q: UnsplashQuery, options: UnsplashOptions): Promise<UnsplashPhoto[]> {
  const res = await fetchWithTimeout(randomPhotosUrl(q), options.timeoutMs, authHeaders(options.accessKey))
  const body = (await res.json()) as ApiPhoto[] | ApiPhoto
  const photos = Array.isArray(body) ? body : [body]
  // An empty set is a failure, not a success: caching it would replace the last
  // good photos with a blank card for the whole cache window.
  if (photos.length === 0) throw new Error('unsplash returned no photos')

  // Fired only on a live fetch — a cache hit is not a new use — and never
  // allowed to fail the photos themselves.
  void Promise.allSettled(photos.map((p) => trackDownload(p.links.download_location, options)))

  return photos.map((p) => ({
    id: p.id,
    imageUrl: sizedImageUrl(p, q.widthPx),
    altText: p.alt_description ?? p.description ?? '',
    photographerName: p.user.name,
    photographerUrl: withReferral(p.user.links.html, options.appName),
    photoUrl: withReferral(p.links.html, options.appName),
  }))
}
