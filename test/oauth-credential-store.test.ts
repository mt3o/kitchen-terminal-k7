/**
 * The stored credential: encryption at rest, and the precedence rule that
 * decides which refresh token the calendar actually uses.
 *
 * The precedence tests are the load-bearing ones. "Database wins over the
 * environment variable" is what makes a successful browser consent visible; get
 * it backwards and the connect button appears to work while the calendar keeps
 * reading a stale token, which is the failure this whole design exists to
 * avoid.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { openDatabase, type Db } from '../src/server/adapters/drizzle/index.ts'
import { runMigrations } from '../src/server/db/migrate.ts'
import { generateSecretKey, openSecret, parseSecretKey, sealSecret } from '../src/server/crypto/secret-box.ts'
import { createCredentialStore, type CredentialStore } from '../src/server/oauth/credential-store.ts'
import { resolveGoogleCredentials } from '../src/server/oauth/resolve-google-credentials.ts'

const KEY = parseSecretKey(generateSecretKey())!
const ENV = { clientId: 'client', clientSecret: 'secret', refreshToken: 'from-env' }

describe('parseSecretKey', () => {
  it('accepts 32 bytes of base64 and rejects the wrong length', () => {
    assert.equal(parseSecretKey(generateSecretKey())!.length, 32)
    assert.throws(() => parseSecretKey(Buffer.alloc(16).toString('base64')), /32 bytes/)
  })

  it('treats absent as absent rather than as an error', () => {
    assert.equal(parseSecretKey(undefined), undefined)
    assert.equal(parseSecretKey(''), undefined)
  })
})

describe('secret box', () => {
  it('round-trips', () => {
    const sealed = sealSecret('token', KEY, 'test')
    assert.equal(openSecret(sealed, KEY, 'test'), 'token')
  })

  it('uses a fresh IV, so the same input never seals to the same bytes', () => {
    const a = sealSecret('token', KEY, 'test')
    const b = sealSecret('token', KEY, 'test')
    assert.notEqual(a.iv.toString('hex'), b.iv.toString('hex'))
    assert.notEqual(a.ciphertext.toString('hex'), b.ciphertext.toString('hex'))
  })

  it('refuses a tampered ciphertext instead of returning plausible bytes', () => {
    const sealed = sealSecret('token', KEY, 'test')
    sealed.ciphertext[0]! ^= 0xff
    assert.throws(() => openSecret(sealed, KEY, 'test'))
  })

  it('refuses the wrong key, and the wrong purpose with the right key', () => {
    const sealed = sealSecret('token', KEY, 'test')
    assert.throws(() => openSecret(sealed, parseSecretKey(generateSecretKey())!, 'test'))
    assert.throws(() => openSecret(sealed, KEY, 'other-purpose'))
  })
})

describe('credential store', () => {
  let db: Db
  let store: CredentialStore

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db)
    store = createCredentialStore(db, KEY)
  })

  it('reports absent before anything is written', async () => {
    assert.deepEqual(await store.read(), { status: 'absent' })
  })

  it('round-trips a credential', async () => {
    await store.write({ refreshToken: 'from-db', scope: 'calendar.readonly', accountEmail: 'a@b.c' })
    const result = await store.read()
    assert.equal(result.status, 'ok')
    assert.equal(result.status === 'ok' && result.credential.refreshToken, 'from-db')
    assert.equal(result.status === 'ok' && result.credential.accountEmail, 'a@b.c')
  })

  it('does not store the token in the clear', async () => {
    await store.write({ refreshToken: 'from-db', scope: 's', accountEmail: null })
    const rows = db.$client.prepare('select * from oauth_credentials').all() as { ciphertext: Buffer }[]
    assert.equal(rows.length, 1)
    assert.ok(!rows[0]!.ciphertext.toString('utf8').includes('from-db'))
  })

  it('replaces rather than duplicating on reconnect', async () => {
    await store.write({ refreshToken: 'first', scope: 's', accountEmail: null })
    await store.write({ refreshToken: 'second', scope: 's', accountEmail: null })
    const result = await store.read()
    assert.equal(result.status === 'ok' && result.credential.refreshToken, 'second')
  })

  it('reports undecryptable — not absent — when the key no longer matches', async () => {
    await store.write({ refreshToken: 'from-db', scope: 's', accountEmail: null })
    const other = createCredentialStore(db, parseSecretKey(generateSecretKey())!)
    const result = await other.read()
    assert.equal(result.status, 'undecryptable')
  })

  it('clears', async () => {
    await store.write({ refreshToken: 'from-db', scope: 's', accountEmail: null })
    await store.clear()
    assert.deepEqual(await store.read(), { status: 'absent' })
  })
})

describe('credential precedence', () => {
  let db: Db
  let store: CredentialStore

  beforeEach(() => {
    db = openDatabase(':memory:')
    runMigrations(db)
    store = createCredentialStore(db, KEY)
  })

  it('prefers the stored credential over the environment variable', async () => {
    await store.write({ refreshToken: 'from-db', scope: 's', accountEmail: null })
    const resolved = await resolveGoogleCredentials(ENV, store)
    assert.equal(resolved.source, 'db')
    assert.equal(resolved.source !== 'none' && resolved.credentials.refreshToken, 'from-db')
  })

  it('falls back to the environment variable when nothing is stored', async () => {
    const resolved = await resolveGoogleCredentials(ENV, store)
    assert.equal(resolved.source, 'env')
    assert.equal(resolved.source !== 'none' && resolved.credentials.refreshToken, 'from-env')
  })

  it('uses the environment variable when the store is disabled entirely', async () => {
    const resolved = await resolveGoogleCredentials(ENV, undefined)
    assert.equal(resolved.source, 'env')
  })

  it('does not fall back to the environment variable when a row will not decrypt', async () => {
    await store.write({ refreshToken: 'from-db', scope: 's', accountEmail: null })
    const wrongKey = createCredentialStore(db, parseSecretKey(generateSecretKey())!)
    const resolved = await resolveGoogleCredentials(ENV, wrongKey)
    // Silently using the env var here would hide a misconfigured key until the
    // day the env var was removed and nobody could explain the failure.
    assert.equal(resolved.source, 'none')
    assert.equal(resolved.source === 'none' && resolved.reason, 'undecryptable')
  })

  it('reports no-client when the app credentials are missing', async () => {
    const resolved = await resolveGoogleCredentials({ clientId: undefined, clientSecret: undefined, refreshToken: 'x' }, store)
    assert.equal(resolved.source === 'none' && resolved.reason, 'no-client')
  })

  it('reports no-credentials when only the client is configured', async () => {
    const resolved = await resolveGoogleCredentials({ ...ENV, refreshToken: undefined }, store)
    assert.equal(resolved.source === 'none' && resolved.reason, 'no-credentials')
  })
})
