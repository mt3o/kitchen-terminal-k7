/**
 * The stored half of the Google credential: a refresh token the household
 * granted through the browser, encrypted at rest.
 *
 * `read` returns a discriminated result rather than `T | undefined` on purpose.
 * A row that will not decrypt — the key was rotated, or lost, or the file was
 * tampered with — is **not** the same thing as no row, and collapsing the two
 * would let a misconfigured key look exactly like "not connected yet": the
 * dashboard would quietly fall back and nobody would learn that a credential is
 * sitting there unreadable. It is reported instead.
 */
import { eq } from 'drizzle-orm'
import type { Db } from '../adapters/drizzle/index.ts'
import * as schema from '../db/schema.ts'
import { openSecret, sealSecret } from '../crypto/secret-box.ts'

/** HKDF `info`: binds these derived bytes to this one use of the key. */
const PURPOSE = 'oauth-refresh-token'

export interface StoredCredential {
  refreshToken: string
  scope: string
  accountEmail: string | null
  updatedAt: Date
}

export type CredentialReadResult =
  | { status: 'ok'; credential: StoredCredential }
  | { status: 'absent' }
  /** A row exists but the key cannot open it. Reportable, never silently skipped. */
  | { status: 'undecryptable'; updatedAt: Date }

export interface CredentialStore {
  read(): Promise<CredentialReadResult>
  write(input: { refreshToken: string; scope: string; accountEmail: string | null }): Promise<void>
  clear(): Promise<void>
}

export function createCredentialStore(db: Db, key: Buffer): CredentialStore {
  const provider = 'google' as const

  return {
    async read() {
      const [row] = await db
        .select()
        .from(schema.oauthCredentials)
        .where(eq(schema.oauthCredentials.provider, provider))
        .limit(1)
      if (!row) return { status: 'absent' }
      try {
        const refreshToken = openSecret(
          { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag },
          key,
          PURPOSE,
        )
        return {
          status: 'ok',
          credential: {
            refreshToken,
            scope: row.scope,
            accountEmail: row.accountEmail,
            updatedAt: row.updatedAt,
          },
        }
      } catch {
        return { status: 'undecryptable', updatedAt: row.updatedAt }
      }
    },

    async write({ refreshToken, scope, accountEmail }) {
      const sealed = sealSecret(refreshToken, key, PURPOSE)
      const values = {
        provider,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        scope,
        accountEmail,
        updatedAt: new Date(),
      }
      await db
        .insert(schema.oauthCredentials)
        .values(values)
        .onConflictDoUpdate({ target: schema.oauthCredentials.provider, set: values })
    },

    async clear() {
      await db.delete(schema.oauthCredentials).where(eq(schema.oauthCredentials.provider, provider))
    },
  }
}
