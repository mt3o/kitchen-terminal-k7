/**
 * Serve the built client with canned data, so a theme can be looked at without
 * the backend.
 *
 * `npm start` boots the real server, which opens SQLite through a native
 * module (better-sqlite3). That module needs a C toolchain, which a machine
 * doing design work may not have — and none of it matters for a theme. What
 * matters is that the *real* built client, the *real* components and the
 * *real* generated token sheet render together, which is what this serves:
 *
 *   /theme.css[?theme=<id>]  the project's own generator (src/server/theme)
 *   /theme-assets/<path>     that theme's own files
 *   /api/themes              the catalogue, so the header menu works
 *   /api/layout              layout.yaml, normalised as the server does
 *   /api/changelog           the real changelog/ directory
 *   everything else under /api → 503, so each card shows the fallback it
 *   shows on a kiosk with no credentials (demo data or a fail badge)
 *
 * Usage:
 *   npx vite build                      # once, and after any client change
 *   node scripts/theme-preview.mjs      # → http://127.0.0.1:8791
 *   node scripts/theme-preview.mjs --port 9000
 *
 * Pick the theme in the header menu, or add ?theme=<id> to /theme.css. The id
 * is the YAML's basename in design-system/themes/.
 *
 * This is a preview, not a test double: it never proves the backend works, and
 * nothing outside scripts/ may import it.
 */
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { parse } from 'yaml'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = resolve(ROOT, 'dist/client')
const portArg = process.argv.indexOf('--port')
const PORT = portArg > -1 ? Number(process.argv[portArg + 1]) : 8791

const load = (rel) => import(pathToFileURL(resolve(ROOT, rel)).href)
const { generateTokensCss, themeAssetPaths } = await load('src/server/theme/generate.ts')
const { listThemes, pickThemePath, themeId, THEMES_DIR } = await load('src/server/theme/catalogue.ts')
const { normaliseLayout } = await load('src/shared/layout.ts')

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}

const layoutDoc = parse(await readFile(resolve(ROOT, 'layout.yaml'), 'utf8'))
const layout = normaliseLayout(layoutDoc)

const day = (offset) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

/** Enough shape to render; the numbers are obviously made up on purpose. */
const CANNED = {
  '/api/health': { ok: true, service: 'theme-preview', reporting: false },
  '/api/layout': layout,
  '/api/issues': { issues: [] },
  '/api/recipes': { recipes: [] },
  '/api/shopping-list': { items: [{ id: '1', label: 'mleko', done: false }, { id: '2', label: 'chleb', done: true }] },
  '/api/ascii-art': { data: { art: [' /\\_/\\', '( o.o )', ' > ^ <'].join('\n'), seed: 4821, prompt: 'kot' }, ageSeconds: 300, stale: false },
  '/api/weather': {
    data: {
      now: { temperature: 12, apparentTemperature: 9, humidity: 84, windSpeed: 22, weatherCode: 3 },
      units: { temperature: '°C', windSpeed: 'km/h' },
      daily: [0, 1, 2, 3].map((i) => ({ date: day(i), temperatureMin: 9 + i, temperatureMax: 14 + (i % 3), weatherCode: i === 1 ? 61 : 3 })),
    },
    ageSeconds: 240,
    stale: false,
  },
}

async function themeCss(requested) {
  const catalogue = requested ? await listThemes(resolve(ROOT, THEMES_DIR)) : []
  const path = pickThemePath(ROOT, layoutDoc.theme, requested, catalogue)
  const theme = parse(await readFile(path, 'utf8'))
  const dir = dirname(path)
  const versions = new Map()
  for (const rel of themeAssetPaths(theme)) {
    try {
      versions.set(rel, createHash('sha256').update(await readFile(resolve(dir, rel))).digest('hex').slice(0, 12))
    } catch {
      // a theme may name a file that is not there yet; the URL then 404s visibly
    }
  }
  const override = requested && catalogue.some((t) => t.id === requested) ? requested : undefined
  return generateTokensCss(theme, {
    assetUrl: (p) => `/theme-assets/${p}?v=${versions.get(p) ?? '0'}${override ? `&theme=${override}` : ''}`,
  })
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (code, type, body) => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-cache' })
    res.end(body)
  }
  try {
    if (url.pathname === '/theme.css') return send(200, TYPES['.css'], await themeCss(url.searchParams.get('theme') ?? undefined))

    if (url.pathname === '/api/themes') {
      const themes = await listThemes(resolve(ROOT, THEMES_DIR))
      return send(200, TYPES['.json'], JSON.stringify({ default: themeId(layoutDoc.theme), themes }))
    }

    if (url.pathname === '/api/changelog') {
      const dir = resolve(ROOT, 'changelog')
      const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort().reverse()
      const entries = []
      for (const f of files) entries.push(parse(await readFile(join(dir, f), 'utf8')))
      return send(200, TYPES['.json'], JSON.stringify({ entries }))
    }

    if (url.pathname.startsWith('/theme-assets/')) {
      const requested = url.searchParams.get('theme') ?? undefined
      const catalogue = requested ? await listThemes(resolve(ROOT, THEMES_DIR)) : []
      const dir = dirname(pickThemePath(ROOT, layoutDoc.theme, requested, catalogue))
      const rel = decodeURIComponent(url.pathname.slice('/theme-assets/'.length))
      return send(200, TYPES[extname(rel).toLowerCase()] ?? 'application/octet-stream', await readFile(resolve(dir, rel)))
    }

    // The calendar's own answer to "no credentials": the card then draws the
    // demo week it draws on a kiosk that has never been connected.
    if (url.pathname.startsWith('/api/calendar/')) return send(503, TYPES['.json'], JSON.stringify({ code: 'not-configured' }))

    for (const [path, body] of Object.entries(CANNED)) {
      if (url.pathname === path) return send(200, TYPES['.json'], JSON.stringify(body))
    }
    if (url.pathname.startsWith('/api/')) return send(503, TYPES['.json'], JSON.stringify({ error: 'theme-preview has no backend' }))

    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    try {
      return send(200, TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', await readFile(join(DIST, file)))
    } catch {
      return send(200, TYPES['.html'], await readFile(join(DIST, 'index.html')))
    }
  } catch (err) {
    send(500, 'text/plain; charset=utf-8', String(err?.stack ?? err))
  }
}).listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`theme preview on http://127.0.0.1:${PORT}  (build first: npx vite build)\n`)
})
