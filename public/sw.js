/*
 * Kitchen Terminal K7 — service worker.
 *
 * Hand-rolled rather than workbox, deliberately: the project's rule is that the
 * cache never lies about freshness, and no stock strategy surfaces the age of
 * what it served. Wrapping workbox in enough custom plugins to do that costs
 * more than these eighty lines and ships ~12 KB to a device with 2 GB of RAM.
 *
 * Scope is narrow on purpose. This worker caches the **app shell only**. Data
 * freshness lives in the backend, in SQLite, because the common failure is the
 * household internet being down while the LAN is up — the server still answers,
 * and a worker cannot help with what is not missing. So /api is never cached
 * here; when it fails the page shows the reconnect scrim instead.
 *
 * A classic script, not a module: Safari 15 cannot register a module service
 * worker, and this is the browser the whole project is built for. It therefore
 * lives in public/ and is copied verbatim rather than bundled.
 */

const MANIFEST = '/precache.json'

/** Set at install time from the manifest, so a new build gets a new cache. */
let cacheName = 'k7-shell'

async function precache() {
  const res = await fetch(MANIFEST, { cache: 'no-store' })
  if (!res.ok) throw new Error('precache manifest unavailable')
  const manifest = await res.json()
  cacheName = `k7-shell-${manifest.revision}`
  const cache = await caches.open(cacheName)
  // addAll is atomic: one 404 and nothing is cached, which is the behaviour we
  // want. A half-populated shell cache is worse than none, because it fails at
  // some later moment nobody connects to this install.
  await cache.addAll(manifest.assets)
}

self.addEventListener('install', (event) => {
  // Take over immediately. This is a kiosk with exactly one client; waiting for
  // every tab to close means waiting until somebody power-cycles the iPad.
  event.waitUntil(precache().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith('k7-shell') && k !== cacheName).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never cache the API. The backend owns freshness and answers with an age;
  // a second cache in front of it would answer with a lie.
  if (url.pathname.startsWith('/api/')) return

  // Navigations go to the network first, and fall back to the cached shell.
  //
  // Cache-first here is the trap: the build empties its output directory, so
  // asset filenames change and the old ones stop existing. A cached index.html
  // therefore points at scripts that are gone from both the server and the new
  // cache, and the kiosk keeps booting a shell that cannot load — indefinitely,
  // because nothing about a cache hit ever expires.
  //
  // Network-first costs one request on a healthy LAN and gives the current
  // shell every time; the cached copy is still there for the case it exists
  // for, which is the backend being down.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(cacheName).then((cache) => cache.put('/index.html', copy))
          }
          return res
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((res) => {
        // Only successful, basic responses are worth keeping; caching an opaque
        // or error response poisons the shell until the next deploy.
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(cacheName).then((cache) => cache.put(request, copy))
        }
        return res
      })
    }),
  )
})
