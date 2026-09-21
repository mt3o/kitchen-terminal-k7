/**
 * Admin routes for connecting the household's Google account from a browser,
 * instead of pasting a refresh token into `.env.local` over SSH.
 *
 * **The guard is here, on the server.** The admin UI hides its button unless a
 * token is present in that browser's `localStorage`, but that is ergonomics on
 * an unauthenticated kitchen LAN — anyone can open devtools, and anyone can
 * call a URL without ever loading the page. What actually protects this surface
 * is {@link requireAdmin}: a header compared in constant time against
 * `K7_ADMIN_TOKEN`.
 *
 * **Unconfigured means these routes do not exist.** With no `K7_ADMIN_TOKEN`
 * (or no `K7_SECRET_KEY`, since a credential that cannot be encrypted must not
 * be stored) nothing is registered at all, so the default deployment has no
 * credential-granting surface. A *wrong* token gets the same 404 a
 * nonexistent route gets: a 403 tells a prober there is something here worth
 * guessing at.
 *
 * The one exception to the guard is the callback, which Google's redirect
 * cannot authenticate — see `oauth/google-consent.ts` for why the single-use
 * `state` carries that job instead.
 */
import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import type { CredentialStore } from '../oauth/credential-store.ts'
import type { GoogleConnection } from '../oauth/google-connection.ts'
import {
  buildConsentUrl,
  exchangeCode,
  fetchAccountEmail,
  revokeToken,
  type StateStore,
} from '../oauth/google-consent.ts'

export const ADMIN_TOKEN_HEADER = 'x-k7-admin-token'

export interface AdminGoogleRouteDeps {
  adminToken: string
  clientId: string | undefined
  clientSecret: string | undefined
  /** Built from configuration, never from the request's Host header. */
  redirectUri: string | undefined
  store: CredentialStore
  connection: GoogleConnection
  states: StateStore
  reportError: (err: unknown, extra?: Record<string, unknown>) => void
  fetchImpl?: typeof fetch
}

/**
 * Constant-time, and length-safe: `timingSafeEqual` throws on unequal lengths,
 * which would both leak the length and turn a wrong guess into a 500.
 */
function tokenMatches(expected: string, supplied: unknown): boolean {
  if (typeof supplied !== 'string') return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(supplied, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function registerAdminGoogleRoutes(app: FastifyInstance, deps: AdminGoogleRouteDeps): Promise<void> {
  const requireAdmin = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (tokenMatches(deps.adminToken, req.headers[ADMIN_TOKEN_HEADER])) return true
    reply.code(404).send({ error: 'not found' })
    return false
  }

  app.get('/api/admin/google/status', async (req, reply) => {
    if (!requireAdmin(req, reply)) return reply
    const status = await deps.connection.status()
    return reply.send({
      ...status,
      // What the household has to fix, if anything, before the button can work.
      canConnect: Boolean(deps.clientId && deps.clientSecret && deps.redirectUri),
      redirectUri: deps.redirectUri ?? null,
    })
  })

  app.post('/api/admin/google/auth/start', async (req, reply) => {
    if (!requireAdmin(req, reply)) return reply
    if (!deps.clientId || !deps.clientSecret) {
      return reply.code(503).send({ error: 'google oauth client is not configured', code: 'no-client' })
    }
    if (!deps.redirectUri) {
      // Without K7_HOSTNAME there is no URL Google could be told to come back
      // to — and inventing one from the request would be the vulnerability
      // this whole module is careful to avoid.
      return reply.code(503).send({ error: 'no hostname configured for the redirect', code: 'no-hostname' })
    }
    const state = deps.states.mint()
    return reply.send({
      url: buildConsentUrl({ clientId: deps.clientId, redirectUri: deps.redirectUri, state }),
    })
  })

  app.get('/api/admin/google/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string }
    // Deliberately not admin-guarded: Google's redirect carries no header.
    if (!deps.states.consume(q.state)) {
      return reply.code(400).type('text/html; charset=utf-8').send(resultPage('błąd', 'Nieznany lub wygasły state — rozpocznij połączenie od nowa.'))
    }
    if (q.error) {
      return reply.code(400).type('text/html; charset=utf-8').send(resultPage('anulowano', `Google zwrócił: ${escapeHtml(q.error)}`))
    }
    if (!q.code || !deps.clientId || !deps.clientSecret || !deps.redirectUri) {
      return reply.code(400).type('text/html; charset=utf-8').send(resultPage('błąd', 'Brak kodu autoryzacji.'))
    }
    try {
      const exchanged = await exchangeCode({
        code: q.code,
        clientId: deps.clientId,
        clientSecret: deps.clientSecret,
        redirectUri: deps.redirectUri,
        fetchImpl: deps.fetchImpl,
      })
      const accountEmail = await fetchAccountEmail(exchanged.accessToken, deps.fetchImpl)
      await deps.store.write({
        refreshToken: exchanged.refreshToken,
        scope: exchanged.scope,
        accountEmail,
      })
      return reply.type('text/html; charset=utf-8').send(
        resultPage('połączono', accountEmail ? `Konto: ${escapeHtml(accountEmail)}` : 'Konto połączone.'),
      )
    } catch (error) {
      deps.reportError(error, { route: 'admin/google/callback' })
      return reply
        .code(502)
        .type('text/html; charset=utf-8')
        .send(resultPage('błąd', escapeHtml(error instanceof Error ? error.message : 'Wymiana kodu nie powiodła się.')))
    }
  })

  app.post('/api/admin/google/disconnect', async (req, reply) => {
    if (!requireAdmin(req, reply)) return reply
    const stored = await deps.store.read()
    await deps.store.clear()
    // Local state is what this route promises, and it is already done. Google
    // being unreachable must not report a disconnect that did happen as failed.
    const revoked = stored.status === 'ok' ? await revokeToken(stored.credential.refreshToken, deps.fetchImpl) : false
    return reply.send({ disconnected: true, revokedAtGoogle: revoked })
  })
}

function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/**
 * The callback lands in a browser tab the household opened, so it answers with
 * a page rather than JSON. Deliberately dependency-free and unstyled by the
 * design system: it is served before any app shell, and a token-contract
 * violation here would be a colour hardcoded in a file the linter checks.
 */
function resultPage(title: string, detail: string): string {
  return `<!doctype html>
<html lang="pl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Google — ${escapeHtml(title)}</title>
<body style="font-family: system-ui, sans-serif; padding: 2rem; line-height: 1.5">
<h1>Google: ${escapeHtml(title)}</h1>
<p>${detail}</p>
<p>Możesz zamknąć tę kartę i wrócić do panelu.</p>
</body>
</html>`
}
