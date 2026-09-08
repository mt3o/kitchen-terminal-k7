/**
 * Fetch through the cache, and never lie about how old the answer is.
 *
 * The household's common failure is the internet being down while the LAN is up.
 * The server still answers; what matters is that it answers with the last
 * weather it saw, clearly marked as old, rather than an error or — worse — an
 * old number presented as current. A wall display that silently shows yesterday's
 * temperature is more harmful than one that shows nothing, because nobody
 * doubts it.
 *
 * Age is therefore computed from the stored timestamp on every read and is never
 * reset by a cache hit. `Aged<T>` has no variant without it.
 */
import type { Aged, Upstream } from '../domain/types.ts'
import type { UpstreamCacheRepository } from '../ports/repositories.ts'

export interface FetchThroughOptions<T> {
  /** Stable per request shape: same location and units, same row. */
  key: string
  upstream: Upstream
  /** Within this many seconds, the stored copy is used without a network call. */
  freshForSeconds: number
  fetcher: () => Promise<T>
  /** Injectable so the tests do not depend on the wall clock. */
  now?: () => Date
  /** Reported when the upstream fails and a stale copy is served instead. */
  onFallback?: (error: unknown, ageSeconds: number) => void
}

const seconds = (from: Date, to: Date): number => Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000))

export function createFreshnessService(cache: UpstreamCacheRepository) {
  return async function fetchThrough<T>(options: FetchThroughOptions<T>): Promise<Aged<T>> {
    const now = options.now ?? (() => new Date())
    const stored = await cache.get(options.key)
    const at = now()

    // Inside the window the stored copy is simply the answer. Its provenance is
    // still `cache` and its age is still real — "fresh enough to use" and "was
    // just fetched" are different claims and the caller may care about both.
    if (stored) {
      const age = seconds(stored.fetchedAt, at)
      if (age < options.freshForSeconds) {
        return { data: stored.payload as T, fetchedAt: stored.fetchedAt, ageSeconds: age, source: 'cache', stale: false }
      }
    }

    try {
      const data = await options.fetcher()
      const entry = await cache.put(options.key, options.upstream, data, now())
      return { data, fetchedAt: entry.fetchedAt, ageSeconds: 0, source: 'live', stale: false }
    } catch (error) {
      if (!stored) throw error // Nothing to fall back to: the caller must see this.
      const age = seconds(stored.fetchedAt, now())
      options.onFallback?.(error, age)
      return { data: stored.payload as T, fetchedAt: stored.fetchedAt, ageSeconds: age, source: 'cache', stale: true }
    }
  }
}

export type FreshnessService = ReturnType<typeof createFreshnessService>

/**
 * A fetch with a deadline.
 *
 * Without one, an upstream that accepts the connection and then never answers
 * holds the request open until Node's default timeout — and on a kiosk that
 * refreshes on a timer, those pile up. Falling back to a stale copy after a few
 * seconds is strictly better than a card that never resolves.
 */
export async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`upstream responded ${res.status}`)
    return res
  } finally {
    clearTimeout(timer)
  }
}
