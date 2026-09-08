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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PORT = Number(process.env.K7_PORT ?? 8080)
// 0.0.0.0 on purpose: the iPad reaches this over the LAN, not over loopback.
const HOST = process.env.K7_HOST ?? '0.0.0.0'

const app = Fastify({ logger: { transport: undefined } })

/** The Layout is read per request: editing layout.yaml should not need a restart. */
async function loadLayout(): Promise<Layout> {
  const raw = await readFile(resolve(ROOT, 'layout.yaml'), 'utf8')
  const layout = parse(raw) as Layout
  if (layout.version !== 1) throw new Error(`unsupported layout version ${layout.version}`)
  if (!layout.theme) throw new Error('layout has no theme')
  return layout
}

app.get('/api/health', async () => ({ ok: true, service: 'kitchen-terminal-k7' }))

app.get('/api/layout', async (_req, reply) => {
  try {
    return await loadLayout()
  } catch (err) {
    // The message is safe to return: it names a file and a field, never a value.
    // Secrets live in the Varlock schema and never reach a response body.
    return reply.code(500).send({ error: err instanceof Error ? err.message : 'layout unreadable' })
  }
})

await app.register(fastifyStatic, { root: resolve(ROOT, 'dist/client'), index: ['index.html'] })

// The kiosk is a single-page shell added to the home screen; any unknown path is
// still the shell rather than a 404 the user cannot navigate away from.
app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'))

const address = await app.listen({ port: PORT, host: HOST })
app.log.info(`kitchen-terminal-k7 on ${address}`)
