/**
 * Authenticated encryption for the few secrets this project stores at rest.
 *
 * AES-256-GCM from Node's own `crypto` — no dependency, and GCM because a
 * credential that decrypts to *something* after the file was tampered with is
 * worse than one that refuses. The auth tag is stored alongside the ciphertext
 * and verified on every read; a tampered row throws rather than returning
 * plausible bytes.
 *
 * **What this buys, precisely.** It protects a database file that leaks on its
 * own: a backup copied off the box, a `data/` directory handed to someone for
 * debugging. It does *not* protect against an attacker with shell access on the
 * host, because `K7_SECRET_KEY` lives in `.env.local` on that same host —
 * exactly where the plaintext refresh token lives today. That is a real but
 * bounded improvement, and overstating it would be worse than not having it.
 *
 * The key is not used raw: HKDF-SHA256 with a per-purpose `info` string derives
 * the actual AES key, so the same `K7_SECRET_KEY` can key something else later
 * without the two purposes sharing derived bytes.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
/** 96 bits is GCM's specified nonce size; anything else costs an extra hash. */
const IV_BYTES = 12
const HKDF_SALT = 'kitchen-terminal-k7'

export interface SealedSecret {
  ciphertext: Buffer
  iv: Buffer
  authTag: Buffer
}

/**
 * A `K7_SECRET_KEY` this module will accept: 32 bytes, base64. Anything else
 * fails at boot rather than at the first write, because a key that is wrong in
 * a way nobody noticed is a credential store that cannot be read back.
 */
export function parseSecretKey(raw: string | undefined): Buffer | undefined {
  if (!raw) return undefined
  let decoded: Buffer
  try {
    decoded = Buffer.from(raw, 'base64')
  } catch {
    throw new Error('K7_SECRET_KEY is not valid base64')
  }
  if (decoded.length !== KEY_BYTES) {
    throw new Error(`K7_SECRET_KEY must decode to ${KEY_BYTES} bytes, got ${decoded.length}`)
  }
  return decoded
}

/** `openssl rand -base64 32` in one line, for the docs and for tests. */
export function generateSecretKey(): string {
  return randomBytes(KEY_BYTES).toString('base64')
}

function deriveKey(key: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', key, HKDF_SALT, purpose, KEY_BYTES))
}

export function sealSecret(plaintext: string, key: Buffer, purpose: string): SealedSecret {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, deriveKey(key, purpose), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { ciphertext, iv, authTag: cipher.getAuthTag() }
}

/**
 * Throws when the key is wrong or the row was tampered with. The caller is
 * expected to treat that as a reportable state, not as "no credential" — see
 * `oauth/credential-store.ts`, where the difference is the whole point.
 */
export function openSecret(sealed: SealedSecret, key: Buffer, purpose: string): string {
  const decipher = createDecipheriv(ALGORITHM, deriveKey(key, purpose), sealed.iv)
  decipher.setAuthTag(sealed.authTag)
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8')
}
