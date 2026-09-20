/**
 * The browser consent flow: the part of OAuth2 that cannot be automated,
 * wrapped in the smallest amount of server that makes it safe.
 *
 * Two things here are load-bearing and easy to get subtly wrong.
 *
 * **The redirect URI is built from configuration, never from the request.**
 * Deriving it from the `Host` header would let anyone who can reach this server
 * point the consent at a host of their choosing and collect the code.
 *
 * **`state` is the callback's only authorisation.** Google redirects the
 * browser back to us, and that redirect will not carry `X-K7-Admin-Token`, so
 * the callback cannot be guarded by the admin header the way every other admin
 * route is. Instead the guarded `auth/start` mints a single-use state, and the
 * callback accepts only a state that is present, unexpired and unused. That is
 * both the CSRF defence and the authorisation. Held in memory deliberately: a
 * restart mid-flow should invalidate the attempt, not resurrect it.
 */
import { randomBytes } from 'node:crypto'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo'

/**
 * Exactly what the code uses today. Widening this is a separate decision with a
 * separate consent screen, not a default to drift upwards.
 */
export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
/** Only so the admin view can say *which* account is connected. */
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'

const STATE_TTL_MS = 10 * 60 * 1000

export interface StateStore {
  mint(): string
  consume(state: string | undefined): boolean
}

export function createStateStore(now: () => number = Date.now): StateStore {
  const issued = new Map<string, number>()

  function sweep() {
    const cutoff = now()
    for (const [value, expiresAt] of issued) if (expiresAt <= cutoff) issued.delete(value)
  }

  return {
    mint() {
      sweep()
      const value = randomBytes(32).toString('base64url')
      issued.set(value, now() + STATE_TTL_MS)
      return value
    },
    consume(state) {
      sweep()
      if (!state) return false
      const expiresAt = issued.get(state)
      if (expiresAt === undefined) return false
      // Single use: delete on the first successful consume, so a replayed
      // callback finds nothing.
      issued.delete(state)
      return expiresAt > now()
    },
  }
}

export function buildRedirectUri(hostname: string, port: number, scheme: 'http' | 'https'): string {
  const authority = (scheme === 'https' && port === 443) || (scheme === 'http' && port === 80)
    ? hostname
    : `${hostname}:${port}`
  return `${scheme}://${authority}/api/admin/google/callback`
}

export function buildConsentUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: `${CALENDAR_READONLY_SCOPE} ${EMAIL_SCOPE}`,
    // Without `access_type=offline` Google issues no refresh token at all, and
    // without `prompt=consent` it declines to issue a second one to an account
    // that has already consented — which is exactly the re-connect case.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: input.state,
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

export interface ExchangedCode {
  refreshToken: string
  accessToken: string
  scope: string
}

export async function exchangeCode(input: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
  fetchImpl?: typeof fetch
}): Promise<ExchangedCode> {
  const doFetch = input.fetchImpl ?? fetch
  const res = await doFetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    // The body can echo the client secret back in some error shapes, so only
    // the status is propagated — the scrubber is a safety net, not a licence.
    throw new Error(`Google code exchange responded ${res.status}`)
  }
  const json = (await res.json()) as { refresh_token?: string; access_token?: string; scope?: string }
  if (!json.refresh_token) {
    throw new Error('Google returned no refresh_token — the consent was not offline, or was already granted')
  }
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token ?? '',
    scope: json.scope ?? CALENDAR_READONLY_SCOPE,
  }
}

/** Display only. A failure here must not fail the connection. */
export async function fetchAccountEmail(accessToken: string, fetchImpl?: typeof fetch): Promise<string | null> {
  if (!accessToken) return null
  try {
    const res = await (fetchImpl ?? fetch)(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { email?: string }
    return json.email ?? null
  } catch {
    return null
  }
}

/**
 * Best effort by design: this route promises to forget the credential locally,
 * and it has already done that by the time this is called. Google being
 * unreachable must not turn a successful disconnect into an error.
 */
export async function revokeToken(refreshToken: string, fetchImpl?: typeof fetch): Promise<boolean> {
  try {
    const res = await (fetchImpl ?? fetch)(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    })
    return res.ok
  } catch {
    return false
  }
}
