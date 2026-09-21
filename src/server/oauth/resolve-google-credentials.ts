/**
 * The one place that answers "which refresh token are we using, and where did
 * it come from?".
 *
 * Order: **database row → `GOOGLE_OAUTH_REFRESH_TOKEN` → nothing.**
 *
 * The database has to win, and this is the load-bearing decision of the whole
 * browser-consent feature. Under the opposite rule the household clicks
 * *connect*, consents, the token is stored — and the calendar keeps using a
 * stale environment variable, silently, while the admin view reports success. A
 * connect button that appears to work and does nothing is worse than no button
 * at all.
 *
 * An `undecryptable` row does **not** fall through to the environment variable.
 * A wrong or rotated `K7_SECRET_KEY` is a misconfiguration to surface, and
 * papering over it with a still-working env var is exactly how it would stay
 * hidden until the env var was removed one day and the calendar died for
 * reasons nobody could connect to a key changed months earlier.
 */
import type { GoogleCalendarCredentials } from '../upstream/google-calendar.ts'
import type { CredentialStore } from './credential-store.ts'

export type CredentialSource = 'db' | 'env' | 'none'

export type ResolvedCredentials =
  | { source: 'db' | 'env'; credentials: GoogleCalendarCredentials; accountEmail?: string | null; scope?: string }
  | { source: 'none'; reason: 'no-credentials' | 'undecryptable' | 'no-client' }

export interface CredentialEnvironment {
  clientId: string | undefined
  clientSecret: string | undefined
  refreshToken: string | undefined
}

export async function resolveGoogleCredentials(
  env: CredentialEnvironment,
  store: CredentialStore | undefined,
): Promise<ResolvedCredentials> {
  // The client id/secret identify the app and come from the environment in
  // both paths — only the *grant* is ever stored in the database.
  if (!env.clientId || !env.clientSecret) return { source: 'none', reason: 'no-client' }

  if (store) {
    const stored = await store.read()
    if (stored.status === 'undecryptable') return { source: 'none', reason: 'undecryptable' }
    if (stored.status === 'ok') {
      return {
        source: 'db',
        credentials: {
          clientId: env.clientId,
          clientSecret: env.clientSecret,
          refreshToken: stored.credential.refreshToken,
        },
        accountEmail: stored.credential.accountEmail,
        scope: stored.credential.scope,
      }
    }
  }

  if (env.refreshToken) {
    return {
      source: 'env',
      credentials: { clientId: env.clientId, clientSecret: env.clientSecret, refreshToken: env.refreshToken },
    }
  }

  return { source: 'none', reason: 'no-credentials' }
}
