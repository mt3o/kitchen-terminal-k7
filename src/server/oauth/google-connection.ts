/**
 * The live Google connection: which credential is in force right now, and the
 * API client built from it.
 *
 * This exists because the credential is no longer fixed at boot. A household
 * that connects or disconnects through the browser changes the answer while the
 * process is running, so the client cannot be a `const` decided once — but it
 * must not be rebuilt per request either, since each instance caches its access
 * token and a fresh one re-authenticates against Google every time.
 *
 * So: resolve on each ask (a local SQLite read), and keep the existing client
 * whenever the refresh token has not changed. Identity of the token is the
 * cache key — nothing else about a client instance depends on anything else.
 */
import {
  createGoogleCalendarClient,
  type GoogleCalendarClient,
} from '../upstream/google-calendar.ts'
import type { CredentialStore } from './credential-store.ts'
import {
  resolveGoogleCredentials,
  type CredentialEnvironment,
  type CredentialSource,
} from './resolve-google-credentials.ts'

export interface GoogleConnectionStatus {
  connected: boolean
  source: CredentialSource
  accountEmail?: string | null
  scope?: string
  /** Why there is no usable credential. Absent when connected. */
  reason?: 'no-credentials' | 'undecryptable' | 'no-client'
}

export interface GoogleConnection {
  /** The client to call Google with, or undefined when nothing is configured. */
  client(): Promise<GoogleCalendarClient | undefined>
  /** What the admin view reports. Never includes a token. */
  status(): Promise<GoogleConnectionStatus>
}

export function createGoogleConnection(
  env: CredentialEnvironment,
  store: CredentialStore | undefined,
): GoogleConnection {
  let cached: { refreshToken: string; client: GoogleCalendarClient } | undefined

  async function resolve() {
    return resolveGoogleCredentials(env, store)
  }

  return {
    async client() {
      const resolved = await resolve()
      if (resolved.source === 'none') {
        cached = undefined
        return undefined
      }
      const { refreshToken } = resolved.credentials
      if (cached?.refreshToken !== refreshToken) {
        cached = { refreshToken, client: createGoogleCalendarClient(resolved.credentials) }
      }
      return cached.client
    },

    async status() {
      const resolved = await resolve()
      if (resolved.source === 'none') {
        return { connected: false, source: 'none', reason: resolved.reason }
      }
      return {
        connected: true,
        source: resolved.source,
        accountEmail: resolved.accountEmail ?? null,
        scope: resolved.scope,
      }
    },
  }
}
