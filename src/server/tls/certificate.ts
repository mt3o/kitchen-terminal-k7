/**
 * Certificate lifecycle for the kiosk.
 *
 * The reason any of this exists: a Service Worker requires a secure context, and
 * a LAN IP over plain HTTP is not one — `navigator.serviceWorker` is simply
 * undefined. So the appliance needs a real certificate for a real name, and
 * DNS-01 is the only challenge type that works when nothing is exposed inbound.
 *
 * Renewal runs **in this process**. The alternative is certbot plus a cron entry
 * plus a system package plus root, on a machine in a kitchen that nobody
 * administers; the failure mode there is a silently expired certificate and a
 * blank wall, discovered by the household rather than by a log.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import acme from 'acme-client'

import type { CloudflareDns } from './cloudflare.ts'

export interface CertificateBundle {
  certificate: string
  privateKey: string
  notAfter: Date
  /** Which ACME directory issued it — a staging cert is not browser-trusted. */
  staging: boolean
}

export interface CertificateOptions {
  hostname: string
  email: string
  dns: CloudflareDns
  /** Directory for the cert, its key and the ACME account key. */
  dir: string
  /**
   * Let's Encrypt production allows five duplicate certificates per week and
   * throttles failed validations hard. A retry loop against production during
   * setup burns the week's budget in an afternoon and the only cure is waiting,
   * so production is opt-in and staging is what you get by default.
   */
  production?: boolean
}

/** Renew with this much life left: comfortably inside Let's Encrypt's 90 days. */
export const RENEW_BEFORE_DAYS = 30

export function daysUntil(notAfter: Date, now: Date = new Date()): number {
  return (notAfter.getTime() - now.getTime()) / 86_400_000
}

/**
 * Pure, so the policy is testable without a network or a clock.
 *
 * `wantProduction` is not optional decoration. Expiry alone is the wrong test the
 * moment somebody flips staging to production: the staging certificate on disk
 * has 89 days left, so an expiry-only check keeps it, and the kiosk goes on
 * serving an untrusted certificate while the configuration insists it is
 * production. The mismatch has to force a reissue.
 */
export function shouldRenew(
  cert: CertificateBundle | undefined,
  now: Date = new Date(),
  wantProduction?: boolean,
): boolean {
  if (!cert) return true
  if (wantProduction !== undefined && cert.staging !== !wantProduction) return true
  return daysUntil(cert.notAfter, now) < RENEW_BEFORE_DAYS
}

const paths = (dir: string) => ({
  cert: join(dir, 'fullchain.pem'),
  key: join(dir, 'privkey.pem'),
  account: join(dir, 'account.key'),
  meta: join(dir, 'meta.json'),
})

/** Read what is on disk, or undefined. A missing or unreadable cert is not an
 *  error — it is the state before the first issuance. */
export async function loadCertificate(dir: string): Promise<CertificateBundle | undefined> {
  const p = paths(dir)
  try {
    const [certificate, privateKey, metaRaw] = await Promise.all([
      readFile(p.cert, 'utf8'),
      readFile(p.key, 'utf8'),
      readFile(p.meta, 'utf8').catch(() => '{}'),
    ])
    const info = await acme.crypto.readCertificateInfo(certificate)
    const meta = JSON.parse(metaRaw) as { staging?: boolean }
    return {
      certificate,
      privateKey,
      notAfter: new Date(info.notAfter),
      staging: meta.staging ?? true,
    }
  } catch {
    return undefined
  }
}

/**
 * The ACME account key is persisted deliberately. Generating a fresh one each
 * boot registers a new account every time, and new-account registrations are
 * themselves rate limited — a restart loop would lock the household out of
 * issuance for a week.
 */
async function accountKey(dir: string): Promise<Buffer> {
  const p = paths(dir)
  try {
    return await readFile(p.account)
  } catch {
    const key = await acme.crypto.createPrivateKey()
    await mkdir(dirname(p.account), { recursive: true })
    await writeFile(p.account, key, { mode: 0o600 })
    return key
  }
}

export async function issueCertificate(options: CertificateOptions): Promise<CertificateBundle> {
  const { hostname, email, dns, dir } = options
  const production = options.production ?? false
  const p = paths(dir)

  const client = new acme.Client({
    directoryUrl: production ? acme.directory.letsencrypt.production : acme.directory.letsencrypt.staging,
    accountKey: await accountKey(dir),
  })

  const [key, csr] = await acme.crypto.createCsr({ commonName: hostname })

  // Records created for the challenge are deleted in challengeRemoveFn, which
  // acme-client calls even when validation fails. Leaking TXT records into the
  // zone on every failed attempt is how a DNS-01 setup quietly becomes a mess.
  const created = new Map<string, string>()

  const certificate = await client.auto({
    csr,
    email,
    termsOfServiceAgreed: true,
    challengePriority: ['dns-01'],
    challengeCreateFn: async (authz, _challenge, keyAuthorization) => {
      const name = `_acme-challenge.${authz.identifier.value}`
      created.set(name, await dns.createTxtRecord(name, keyAuthorization))
    },
    challengeRemoveFn: async (authz) => {
      const name = `_acme-challenge.${authz.identifier.value}`
      const id = created.get(name)
      if (id) {
        await dns.deleteTxtRecord(id)
        created.delete(name)
      }
    },
  })

  const pem = certificate.toString()
  const info = await acme.crypto.readCertificateInfo(pem)

  await mkdir(dir, { recursive: true })
  await Promise.all([
    writeFile(p.cert, pem, { mode: 0o600 }),
    // 0600 is not decoration: this key is the whole of the kiosk's identity.
    writeFile(p.key, key, { mode: 0o600 }),
    writeFile(p.meta, JSON.stringify({ staging: !production, hostname }, null, 2)),
  ])

  return { certificate: pem, privateKey: key.toString(), notAfter: new Date(info.notAfter), staging: !production }
}

/** Load, and issue only if there is nothing usable. The common path is a read. */
export async function ensureCertificate(options: CertificateOptions): Promise<CertificateBundle> {
  const existing = await loadCertificate(options.dir)
  const production = options.production ?? false
  if (existing && !shouldRenew(existing, new Date(), production)) return existing
  return issueCertificate(options)
}
