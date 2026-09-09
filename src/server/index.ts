// The backend: one Fastify process on the LAN machine, serving the built client
// and the layout it renders. Not on the cloud VPS — the iPad and the server are
// on the same network, so nothing needs exposing.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { parse } from 'yaml'

import { normaliseLayout, type Layout, type NormalisedLayout } from '../shared/layout.ts'
import { createRepositories, openDatabase } from './adapters/drizzle/index.ts'
import { describeConfig, loadConfig, secretValues } from './config.ts'
import { runMigrations } from './db/migrate.ts'
import { initObservability, Sentry } from './observability.ts'
import { generateTokensCss, type Theme } from './theme/generate.ts'
import { isAllowedHost, isPrivateAddress } from './security/network.ts'
import { createCloudflareDns } from './tls/cloudflare.ts'
import { ensureCertificate } from './tls/certificate.ts'
import { createFreshnessService } from './upstream/freshness.ts'
import { fetchWeather, weatherCacheKey } from './upstream/open-meteo.ts'
import { asciiArtCacheKey, createAsciiArtGenerator } from './upstream/ascii-art.ts'
import { comicCacheKey, fetchComic } from './upstream/comic-rss.ts'
import { createKiloGatewayClient, createModelCatalog } from './upstream/kilo.ts'
import { createConversationService } from './ai/conversation-service.ts'
import { registerChatRoutes } from './routes/chat.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const config = loadConfig()

// Wired before the server exists, so a crash during startup is reported too.
const reporting = initObservability({
  dsn: config.glitchtipDsn,
  environment: config.environment,
  secrets: secretValues(config),
})

// Migrations run here, not in a deploy step: nobody is standing at the LAN
// machine when it restarts, and a server that boots against an unmigrated
// schema fails later and less clearly than one that refuses to boot.
const db = openDatabase(config.databasePath)
runMigrations(db)
const repos = createRepositories(db)
const fetchThrough = createFreshnessService(repos.upstreamCache)

// AI chat (Faza 4) and ascii-art-of-the-day (Faza 5) share one Kilo Gateway
// client and model catalogue — see routes/chat.ts for why the chat routes
// themselves live in their own module.
const kiloClient = createKiloGatewayClient({ apiKey: config.kiloGatewayKey })
const modelCatalog = createModelCatalog(fetchThrough, kiloClient)
const conversationService = createConversationService({
  conversations: repos.conversations,
  aiCalls: repos.aiCalls,
  modelCatalog,
  gateway: kiloClient,
})
// Absent means the card fails honestly with a clear cause rather than every
// request racing to discover a missing key — see the /api/ascii-art route.
const generateAndRecordAsciiArt = config.kiloGatewayKey
  ? createAsciiArtGenerator(repos.aiCalls, kiloClient, modelCatalog)
  : undefined

/**
 * TLS is all-or-nothing and decided before Fastify exists, because the server's
 * https options are constructor arguments. Missing configuration is not an
 * error: plain HTTP is a supported way to run, it just means no Service Worker.
 */
async function resolveTls(): Promise<{ key: string; cert: string } | undefined> {
  if (!config.hostname || !config.cloudflareApiToken) return undefined
  const bundle = await ensureCertificate({
    hostname: config.hostname,
    email: config.acmeEmail ?? `admin@${config.hostname}`,
    dns: createCloudflareDns(config.cloudflareApiToken),
    dir: config.certDir,
    production: config.acmeProduction,
  })
  return { key: bundle.privateKey, cert: bundle.certificate }
}

let tls: { key: string; cert: string } | undefined
try {
  tls = await resolveTls()
} catch (error) {
  // A certificate failure must not take the kitchen display down. Falling back
  // to HTTP keeps the wall alive and loses only the Service Worker, which is
  // strictly better than a blank screen while somebody debugs ACME.
  Sentry.captureException(error)
  process.stderr.write(`TLS setup failed, continuing on HTTP: ${error instanceof Error ? error.message : String(error)}\n`)
}

const req_log_error = (err: unknown): void => {
  Sentry.captureException(err)
}

const app = Fastify({
  logger: { transport: undefined },
  ...(tls ? { https: { key: tls.key, cert: tls.cert } } : {}),
})

/** The Layout is read per request: editing layout.yaml should not need a restart. */
async function loadLayout(): Promise<NormalisedLayout> {
  const raw = await readFile(resolve(ROOT, 'layout.yaml'), 'utf8')
  const layout = parse(raw) as Layout
  if (layout.version !== 1) throw new Error(`unsupported layout version ${layout.version}`)
  if (!layout.theme) throw new Error('layout has no theme')
  if (!layout.pages?.length && !layout.cards?.length) throw new Error('layout has neither pages nor cards')
  // Normalised here so the renderer has one shape to handle. Two code paths
  // through a layout is how the single-page case quietly stops being tested.
  return normaliseLayout(layout)
}

/**
 * The token stylesheet, generated from the theme the layout names.
 *
 * Served from the root rather than under /api because it is part of the shell:
 * the service worker must be able to keep it for an offline paint, and /api is
 * never cached by design. It is still generated per request, so editing a theme
 * file needs no restart — the same rule the layout follows.
 */
app.get('/theme.css', async (_req, reply) => {
  try {
    const layout = await loadLayout()
    const themePath = resolve(ROOT, layout.theme)
    const theme = parse(await readFile(themePath, 'utf8')) as Theme
    return reply
      .type('text/css; charset=utf-8')
      // No long cache: the whole point is that changing the file changes the
      // design. The service worker holds a copy for the offline case.
      .header('cache-control', 'no-cache')
      .send(generateTokensCss(theme))
  } catch (err) {
    // A stylesheet that 500s leaves an unstyled kiosk, which is worse than an
    // old one; but there is nothing to fall back to here, so say it plainly.
    req_log_error(err)
    return reply.code(500).type('text/css').send(`/* theme unavailable: ${err instanceof Error ? err.message : 'unknown'} */`)
  }
})

app.get('/api/health', async () => ({
  ok: true,
  service: 'kitchen-terminal-k7',
  // Whether reporting is on is operational state, not a secret. Saying it out
  // loud is how you find out the DSN was never set.
  reporting,
}))

app.get('/api/layout', async (_req, reply) => {
  try {
    return await loadLayout()
  } catch (err) {
    // The message is safe to return: it names a file and a field, never a value.
    // Secrets live in the Varlock schema and never reach a response body.
    return reply.code(500).send({ error: err instanceof Error ? err.message : 'layout unreadable' })
  }
})

// Nothing on this box is authenticated, so the network boundary is the boundary.
// Two checks, guarding two different attacks — see security/network.ts.
const allowedHosts = [config.hostname, config.host].filter((h): h is string => Boolean(h))

app.addHook('onRequest', async (req, reply) => {
  if (!isPrivateAddress(req.ip)) {
    req.log.warn({ ip: req.ip, url: req.url }, 'rejected non-private client')
    return reply.code(403).send({ error: 'forbidden' })
  }
  if (!isAllowedHost(req.headers.host, allowedHosts)) {
    // Almost certainly DNS rebinding: the packets are local but the name is not
    // ours, which is what a rebinding page looks like from in here.
    req.log.warn({ host: req.headers.host, url: req.url }, 'rejected unexpected Host header')
    return reply.code(400).send({ error: 'unexpected host' })
  }
})

/**
 * Weather, served through the cache and always with its age.
 *
 * The freshness window is 15 minutes because that is roughly how often the
 * upstream itself updates; asking more often would return the same numbers and
 * spend somebody else's rate limit for nothing.
 */
app.get('/api/weather', async (req, reply) => {
  const q = req.query as { lat?: string; lon?: string; units?: string }
  const latitude = Number(q.lat ?? 52.2297)
  const longitude = Number(q.lon ?? 21.0122)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return reply.code(400).send({ error: 'lat and lon must be numbers' })
  }
  const query = {
    latitude,
    longitude,
    timezone: process.env.K7_TIMEZONE ?? 'Europe/Warsaw',
    units: q.units === 'imperial' ? ('imperial' as const) : ('metric' as const),
  }

  try {
    return await fetchThrough({
      key: weatherCacheKey(query),
      upstream: 'open-meteo',
      freshForSeconds: 900,
      fetcher: () => fetchWeather(query),
      onFallback: (error, ageSeconds) => {
        // Worth a log line but not an error report: the household internet being
        // down is an expected condition the design already accounts for.
        req.log.warn({ err: error, ageSeconds }, 'open-meteo unreachable, serving last good')
      },
    })
  } catch (error) {
    // Nothing cached and the upstream is unreachable: there is no honest answer,
    // so say so rather than returning an empty shape the card would render as
    // real data.
    return reply.code(503).send({
      error: 'weather unavailable and nothing cached',
      detail: error instanceof Error ? error.message : undefined,
    })
  }
})

app.get('/api/ascii-art', async (req, reply) => {
  const q = req.query as {
    prompt?: string
    model?: string
    cacheDurationHours?: string
    seed?: string
    maxWidthChars?: string
    maxHeightLines?: string
  }
  if (!q.prompt || q.prompt.trim() === '') return reply.code(400).send({ error: 'prompt is required' })
  if (!generateAndRecordAsciiArt) {
    return reply.code(503).send({ error: 'ascii art unavailable', detail: 'Kilo Gateway key is not configured' })
  }
  const model = q.model?.trim() || 'kilo-auto/free'
  const seed = q.seed !== undefined && q.seed !== '' ? Number(q.seed) : undefined
  if (seed !== undefined && !Number.isInteger(seed)) return reply.code(400).send({ error: 'seed must be an integer' })
  const maxWidthChars = q.maxWidthChars !== undefined && q.maxWidthChars !== '' ? Number(q.maxWidthChars) : undefined
  const maxHeightLines = q.maxHeightLines !== undefined && q.maxHeightLines !== '' ? Number(q.maxHeightLines) : undefined
  const cacheDurationHours = Number(q.cacheDurationHours ?? 24)
  const freshForSeconds = (Number.isFinite(cacheDurationHours) && cacheDurationHours > 0 ? cacheDurationHours : 24) * 3600
  const query = { prompt: q.prompt, model, seed, maxWidthChars, maxHeightLines }

  try {
    return await fetchThrough({
      key: asciiArtCacheKey(query),
      upstream: 'kilo-gateway',
      freshForSeconds,
      fetcher: () => generateAndRecordAsciiArt(query),
      onFallback: (error, ageSeconds) => {
        req.log.warn({ err: error, ageSeconds }, 'kilo gateway unreachable, serving last good ascii art')
      },
    })
  } catch (error) {
    // Nothing cached and the gateway is unreachable: the client's fallbackArt
    // param covers this locally rather than the server inventing placeholder art.
    return reply.code(503).send({
      error: 'ascii art unavailable and nothing cached',
      detail: error instanceof Error ? error.message : undefined,
    })
  }
})

app.get('/api/comic', async (req, reply) => {
  const q = req.query as { rssUrl?: string; itemSelector?: string; filterKeywords?: string; cacheDurationHours?: string }
  if (!q.rssUrl || q.rssUrl.trim() === '') return reply.code(400).send({ error: 'rssUrl is required' })
  const filterKeywords = q.filterKeywords ? q.filterKeywords.split(',').map((k) => k.trim()).filter(Boolean) : []
  const cacheDurationHours = Number(q.cacheDurationHours ?? 24)
  const freshForSeconds = (Number.isFinite(cacheDurationHours) && cacheDurationHours > 0 ? cacheDurationHours : 24) * 3600
  const query = { rssUrl: q.rssUrl, itemSelector: q.itemSelector, filterKeywords }

  try {
    return await fetchThrough({
      key: comicCacheKey(query),
      upstream: 'rss',
      freshForSeconds,
      fetcher: () => fetchComic(query),
      onFallback: (error, ageSeconds) => {
        req.log.warn({ err: error, ageSeconds }, 'comic feed unreachable, serving last good comic')
      },
    })
  } catch (error) {
    // The client's fallbackImageUrl param covers a total miss locally rather
    // than the server inventing a placeholder image.
    return reply.code(503).send({
      error: 'comic unavailable and nothing cached',
      detail: error instanceof Error ? error.message : undefined,
    })
  }
})

// The shopping list is the first card wired end to end — a thin cut through
// HTTP, port, adapter and SQLite that proves the seam rather than describing it.
app.get('/api/shopping-list', async (req) => {
  const includeChecked = (req.query as { checked?: string }).checked === 'all'
  return repos.shoppingList.list({ includeChecked })
})

app.post('/api/shopping-list', async (req, reply) => {
  const body = req.body as { label?: unknown; category?: unknown }
  if (typeof body?.label !== 'string' || body.label.trim() === '') {
    return reply.code(400).send({ error: 'label is required' })
  }
  const item = await repos.shoppingList.add({
    label: body.label.trim(),
    category: typeof body.category === 'string' ? body.category : null,
  })
  return reply.code(201).send(item)
})

app.patch('/api/shopping-list/:id', async (req, reply) => {
  const { id } = req.params as { id: string }
  const { checked } = req.body as { checked?: unknown }
  if (typeof checked !== 'boolean') return reply.code(400).send({ error: 'checked must be a boolean' })
  const item = await repos.shoppingList.setChecked(id, checked)
  return item ?? reply.code(404).send({ error: 'no such item' })
})

// AI chat (Faza 4): model catalogue, conversation CRUD, the SSE turn endpoint
// and the cost-history view — see routes/chat.ts.
await registerChatRoutes(app, {
  conversations: repos.conversations,
  aiCalls: repos.aiCalls,
  modelCatalog,
  conversationService,
  reportError: (err, extra) => Sentry.captureException(err, { extra }),
})

// Every unhandled error reaches GlitchTip through the same scrubber as the rest.
app.setErrorHandler((err, req, reply) => {
  Sentry.captureException(err, { extra: { url: req.url, method: req.method } })
  req.log.error({ err }, 'request failed')
  reply.code(500).send({ error: 'internal error' })
})

await app.register(fastifyStatic, { root: resolve(ROOT, 'dist/client'), index: ['index.html'] })

// The kiosk is a single-page shell added to the home screen; any unknown path is
// still the shell rather than a 404 the user cannot navigate away from.
app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'))

const address = await app.listen({ port: config.port, host: config.host })
app.log.info(`kitchen-terminal-k7 on ${address} — ${describeConfig(config)} scheme=${tls ? 'https' : 'http'}`)
