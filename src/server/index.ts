// The backend: one Fastify process on the LAN machine, serving the built client
// and the layout it renders. Not on the cloud VPS — the iPad and the server are
// on the same network, so nothing needs exposing.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { parse } from 'yaml'

import type { Layout } from '../shared/layout.ts'
import { createRepositories, openDatabase } from './adapters/drizzle/index.ts'
import { describeConfig, loadConfig, secretValues } from './config.ts'
import { runMigrations } from './db/migrate.ts'
import { initObservability, Sentry } from './observability.ts'

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

const app = Fastify({ logger: { transport: undefined } })

/** The Layout is read per request: editing layout.yaml should not need a restart. */
async function loadLayout(): Promise<Layout> {
  const raw = await readFile(resolve(ROOT, 'layout.yaml'), 'utf8')
  const layout = parse(raw) as Layout
  if (layout.version !== 1) throw new Error(`unsupported layout version ${layout.version}`)
  if (!layout.theme) throw new Error('layout has no theme')
  return layout
}

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
app.log.info(`kitchen-terminal-k7 on ${address} — ${describeConfig(config)}`)
