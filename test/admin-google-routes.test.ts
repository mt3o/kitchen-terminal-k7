/**
 * The admin surface for connecting Google, tested with Fastify's `.inject()`
 * against an in-memory database and a fake `fetch` — no consent screen, no
 * network.
 *
 * Two properties carry the security of this feature and both are asserted here:
 * a request without the right admin token gets the same 404 an unknown route
 * gets, and the callback — which cannot be admin-guarded, because Google's
 * redirect carries no headers — accepts a `state` exactly once.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import Fastify, { type FastifyInstance } from 'fastify'

import { openDatabase, type Db } from '../src/server/adapters/drizzle/index.ts'
import { runMigrations } from '../src/server/db/migrate.ts'
import { generateSecretKey, parseSecretKey } from '../src/server/crypto/secret-box.ts'
import { createCredentialStore, type CredentialStore } from '../src/server/oauth/credential-store.ts'
import { createGoogleConnection } from '../src/server/oauth/google-connection.ts'
import { buildConsentUrl, buildRedirectUri, createStateStore } from '../src/server/oauth/google-consent.ts'
import { registerAdminGoogleRoutes } from '../src/server/routes/admin-google.ts'

const TOKEN = 'correct-horse-battery-staple'
const KEY = parseSecretKey(generateSecretKey())!
const REDIRECT = 'https://k7.example/api/admin/google/callback'
const AUTH = { 'x-k7-admin-token': TOKEN }

let app: FastifyInstance
let db: Db
let store: CredentialStore
let tokenResponse: unknown
let tokenStatus: number
let revoked: string[]

function fakeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/token')) {
      return new Response(JSON.stringify(tokenResponse), {
        status: tokenStatus,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('userinfo')) {
      return new Response(JSON.stringify({ email: 'dom@example.com' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/revoke')) {
      revoked.push(String(new URLSearchParams(init?.body as string).get('token')))
      return new Response('', { status: 200 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch
}

async function build(overrides: { adminToken?: string; clientId?: string; redirectUri?: string } = {}) {
  db = openDatabase(':memory:')
  runMigrations(db)
  store = createCredentialStore(db, KEY)
  tokenResponse = { refresh_token: 'granted-refresh', access_token: 'access', scope: 'calendar.readonly' }
  tokenStatus = 200
  revoked = []
  app = Fastify()
  await registerAdminGoogleRoutes(app, {
    adminToken: overrides.adminToken ?? TOKEN,
    clientId: 'clientId' in overrides ? overrides.clientId : 'client',
    clientSecret: 'secret',
    redirectUri: 'redirectUri' in overrides ? overrides.redirectUri : REDIRECT,
    store,
    connection: createGoogleConnection(
      { clientId: 'client', clientSecret: 'secret', refreshToken: undefined },
      store,
    ),
    states: createStateStore(),
    reportError: () => {},
    fetchImpl: fakeFetch(),
  })
  await app.ready()
}

/** Walks the real flow: start → callback, returning the callback's response. */
async function connect(): Promise<{ statusCode: number; body: string }> {
  const started = await app.inject({ method: 'POST', url: '/api/admin/google/auth/start', headers: AUTH })
  const url = new URL((started.json() as { url: string }).url)
  const state = url.searchParams.get('state')!
  const res = await app.inject({ method: 'GET', url: `/api/admin/google/callback?code=abc&state=${state}` })
  return { statusCode: res.statusCode, body: res.body }
}

describe('admin guard', () => {
  beforeEach(async () => await build())

  it('answers 404 without a token — the same as an unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/google/status' })
    assert.equal(res.statusCode, 404)
  })

  it('answers 404 for a wrong token, telling a prober nothing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/google/status',
      headers: { 'x-k7-admin-token': 'wrong' },
    })
    assert.equal(res.statusCode, 404)
  })

  it('answers 404 for a token of the same length but different bytes', async () => {
    const sameLength = 'x'.repeat(TOKEN.length)
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/google/status',
      headers: { 'x-k7-admin-token': sameLength },
    })
    assert.equal(res.statusCode, 404)
  })

  it('lets the right token through', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/google/status', headers: AUTH })
    assert.equal(res.statusCode, 200)
  })
})

describe('status', () => {
  beforeEach(async () => await build())

  it('reports not-connected, and never leaks a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/google/status', headers: AUTH })
    const body = res.json() as Record<string, unknown>
    assert.equal(body.connected, false)
    assert.equal(body.source, 'none')
    assert.ok(!JSON.stringify(body).includes('refresh'))
  })

  it('reports the stored account after a connection', async () => {
    await connect()
    const body = (await app.inject({ method: 'GET', url: '/api/admin/google/status', headers: AUTH })).json() as Record<string, unknown>
    assert.equal(body.connected, true)
    assert.equal(body.source, 'db')
    assert.equal(body.accountEmail, 'dom@example.com')
    assert.ok(!JSON.stringify(body).includes('granted-refresh'))
  })

  it('says it cannot connect when no hostname yields a redirect URI', async () => {
    await build({ redirectUri: undefined })
    const body = (await app.inject({ method: 'GET', url: '/api/admin/google/status', headers: AUTH })).json() as Record<string, unknown>
    assert.equal(body.canConnect, false)
  })
})

describe('consent flow', () => {
  beforeEach(async () => await build())

  it('stores what Google returned', async () => {
    const res = await connect()
    assert.equal(res.statusCode, 200)
    const stored = await store.read()
    assert.equal(stored.status === 'ok' && stored.credential.refreshToken, 'granted-refresh')
  })

  it('refuses a callback whose state was never issued', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/google/callback?code=abc&state=invented' })
    assert.equal(res.statusCode, 400)
    assert.deepEqual(await store.read(), { status: 'absent' })
  })

  it('refuses a replayed state — single use, so a resubmitted callback fails', async () => {
    const started = await app.inject({ method: 'POST', url: '/api/admin/google/auth/start', headers: AUTH })
    const state = new URL((started.json() as { url: string }).url).searchParams.get('state')!
    const first = await app.inject({ method: 'GET', url: `/api/admin/google/callback?code=abc&state=${state}` })
    const second = await app.inject({ method: 'GET', url: `/api/admin/google/callback?code=abc&state=${state}` })
    assert.equal(first.statusCode, 200)
    assert.equal(second.statusCode, 400)
  })

  it('refuses a callback with no state at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/google/callback?code=abc' })
    assert.equal(res.statusCode, 400)
  })

  it('reports an exchange that Google rejected, and stores nothing', async () => {
    const started = await app.inject({ method: 'POST', url: '/api/admin/google/auth/start', headers: AUTH })
    const state = new URL((started.json() as { url: string }).url).searchParams.get('state')!
    tokenStatus = 400
    tokenResponse = { error: 'invalid_grant' }
    const res = await app.inject({ method: 'GET', url: `/api/admin/google/callback?code=abc&state=${state}` })
    assert.equal(res.statusCode, 502)
    assert.deepEqual(await store.read(), { status: 'absent' })
  })

  it('reports a consent Google returned without a refresh token', async () => {
    const started = await app.inject({ method: 'POST', url: '/api/admin/google/auth/start', headers: AUTH })
    const state = new URL((started.json() as { url: string }).url).searchParams.get('state')!
    tokenResponse = { access_token: 'access', scope: 'x' }
    const res = await app.inject({ method: 'GET', url: `/api/admin/google/callback?code=abc&state=${state}` })
    assert.equal(res.statusCode, 502)
  })

  it('refuses to start without a redirect URI rather than inventing one', async () => {
    await build({ redirectUri: undefined })
    const res = await app.inject({ method: 'POST', url: '/api/admin/google/auth/start', headers: AUTH })
    assert.equal(res.statusCode, 503)
    assert.equal((res.json() as { code: string }).code, 'no-hostname')
  })
})

describe('disconnect', () => {
  beforeEach(async () => await build())

  it('clears the stored credential and revokes it at Google', async () => {
    await connect()
    const res = await app.inject({ method: 'POST', url: '/api/admin/google/disconnect', headers: AUTH })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(await store.read(), { status: 'absent' })
    assert.deepEqual(revoked, ['granted-refresh'])
  })

  it('is guarded like every other admin route', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/admin/google/disconnect' })
    assert.equal(res.statusCode, 404)
  })
})

describe('consent URL and redirect URI', () => {
  it('asks for offline access and forces a fresh consent', () => {
    const url = new URL(buildConsentUrl({ clientId: 'c', redirectUri: REDIRECT, state: 's' }))
    assert.equal(url.searchParams.get('access_type'), 'offline')
    assert.equal(url.searchParams.get('prompt'), 'consent')
    assert.equal(url.searchParams.get('redirect_uri'), REDIRECT)
    assert.ok(url.searchParams.get('scope')!.includes('calendar.readonly'))
  })

  it('does not ask for a write scope', () => {
    const url = new URL(buildConsentUrl({ clientId: 'c', redirectUri: REDIRECT, state: 's' }))
    const scopes = url.searchParams.get('scope')!.split(' ')
    assert.ok(!scopes.includes('https://www.googleapis.com/auth/calendar'))
  })

  it('omits the port only when it is the scheme default', () => {
    assert.equal(buildRedirectUri('k7.example', 443, 'https'), 'https://k7.example/api/admin/google/callback')
    assert.equal(buildRedirectUri('k7.example', 8443, 'https'), 'https://k7.example:8443/api/admin/google/callback')
    assert.equal(buildRedirectUri('k7.example', 80, 'http'), 'http://k7.example/api/admin/google/callback')
  })
})

describe('state store', () => {
  it('expires a state that was never used', () => {
    let now = 0
    const states = createStateStore(() => now)
    const state = states.mint()
    now = 11 * 60 * 1000
    assert.equal(states.consume(state), false)
  })

  it('accepts one inside the window', () => {
    let now = 0
    const states = createStateStore(() => now)
    const state = states.mint()
    now = 60 * 1000
    assert.equal(states.consume(state), true)
  })
})
