/**
 * Cloudflare DNS API v4 client, scoped to exactly what ACME DNS-01 needs:
 * create a TXT record, delete it again, and find which zone a hostname
 * belongs to. Deliberately dependency-free — this runs once per cert
 * renewal, so pulling in an SDK for three endpoints is not worth the
 * supply-chain surface.
 *
 * Auth is a scoped API token (`Authorization: Bearer <token>`), not the
 * legacy `X-Auth-Email` / `X-Auth-Key` global-key pair — the token can be
 * restricted to `Zone.DNS: Edit` on a single zone, which is the least this
 * process can get away with holding.
 */

const API_BASE = 'https://api.cloudflare.com/client/v4'

/** Shape Cloudflare wraps every response in, success or failure. */
interface CloudflareEnvelope<T> {
  success: boolean
  errors: ReadonlyArray<{ code: number; message: string }>
  messages: ReadonlyArray<{ code: number; message: string }>
  result: T
}

interface CloudflareZone {
  id: string
  name: string
}

interface CloudflareDnsRecord {
  id: string
}

export interface CloudflareDns {
  /** Create a TXT record, return its record id. */
  createTxtRecord(name: string, value: string): Promise<string>
  /** Delete by record id. Must not throw if already gone. */
  deleteTxtRecord(recordId: string): Promise<void>
  /** Find the zone id for a hostname, walking up the labels. */
  resolveZoneId(hostname: string): Promise<string>
}

/**
 * Turns a failed envelope into an error message worth reading at 3am: the
 * Cloudflare error codes and text, never the token. `fetch` failures (network,
 * DNS, TLS) surface through the normal thrown error from `fetch`/`res.json()`
 * and are not touched here.
 */
function describeErrors(errors: CloudflareEnvelope<unknown>['errors']): string {
  if (errors.length === 0) return 'no error detail returned'
  return errors.map((e) => `[${e.code}] ${e.message}`).join('; ')
}

export function createCloudflareDns(apiToken: string, opts?: { fetchImpl?: typeof fetch }): CloudflareDns {
  const doFetch = opts?.fetchImpl ?? fetch

  // Cloudflare's delete endpoint is nested under a zone id, but our own
  // interface only hands deleteTxtRecord a bare record id (ACME clients don't
  // carry the zone around). Remembering the zone from creation covers the
  // normal same-process create-then-delete flow; the fallback in
  // deleteTxtRecord covers a delete called after a restart with no cache.
  const recordZoneCache = new Map<string, string>()

  async function call<T>(path: string, init?: RequestInit): Promise<CloudflareEnvelope<T>> {
    const res = await doFetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        // Bearer token auth only — the legacy X-Auth-Email/X-Auth-Key pair
        // grants account-wide access and has no place in a system that is
        // supposed to hold a single-zone-scoped credential.
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })
    // Cloudflare returns a JSON envelope on both success and most failure
    // paths (including 4xx), so parse before checking `success` rather than
    // branching on res.ok first.
    return (await res.json()) as CloudflareEnvelope<T>
  }

  async function resolveZoneId(hostname: string): Promise<string> {
    // The token may only be scoped to the exact zone (e.g. `revert-h0m3.co.pl`),
    // not to whatever subdomain the certificate is for (`k7.revert-h0m3.co.pl`),
    // so we can't just query the full hostname — we have to walk up label by
    // label until Cloudflare's zone list answers with a match.
    const labels = hostname.split('.')
    for (let i = 0; i < labels.length - 1; i++) {
      const candidate = labels.slice(i).join('.')
      const envelope = await call<CloudflareZone[]>(`/zones?name=${encodeURIComponent(candidate)}`)
      if (!envelope.success) {
        throw new Error(`Cloudflare zone lookup for "${candidate}" failed: ${describeErrors(envelope.errors)}`)
      }
      const zone = envelope.result[0]
      if (zone) return zone.id
    }
    throw new Error(`No Cloudflare zone found for hostname "${hostname}" or any of its parent domains`)
  }

  async function createTxtRecord(name: string, value: string): Promise<string> {
    const zoneId = await resolveZoneId(name)
    const envelope = await call<CloudflareDnsRecord>(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'TXT',
        name,
        content: value,
        // 60s, not Cloudflare's "Auto" (300s): the ACME challenge record is
        // deleted within seconds of the CA validating it, and a long TTL only
        // slows down retries against stale resolver caches, never helps.
        ttl: 60,
      }),
    })
    if (!envelope.success) {
      throw new Error(`Cloudflare TXT record creation for "${name}" failed: ${describeErrors(envelope.errors)}`)
    }
    recordZoneCache.set(envelope.result.id, zoneId)
    return envelope.result.id
  }

  /** Cloudflare-reported "record does not exist" — deleteTxtRecord's contract
   *  is to treat this as success, not failure. */
  const RECORD_NOT_FOUND_CODE = 81044

  async function deleteInZone(zoneId: string, recordId: string): Promise<CloudflareEnvelope<CloudflareDnsRecord | null>> {
    return call<CloudflareDnsRecord | null>(`/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' })
  }

  async function deleteTxtRecord(recordId: string): Promise<void> {
    const cachedZoneId = recordZoneCache.get(recordId)
    if (cachedZoneId) {
      const envelope = await deleteInZone(cachedZoneId, recordId)
      recordZoneCache.delete(recordId)
      if (envelope.success) return
      if (envelope.errors.some((e) => e.code === RECORD_NOT_FOUND_CODE)) return
      throw new Error(`Cloudflare TXT record deletion for id "${recordId}" failed: ${describeErrors(envelope.errors)}`)
    }

    // No cached zone (e.g. process restarted between create and delete): the
    // token is normally scoped to one zone anyway, so ask Cloudflare which
    // zones this token can see at all and try the record in each. A 404/81044
    // in a zone just means "not there" — only exhausting every zone without
    // finding it, or a non-404 error, is a real failure worth surfacing.
    const zonesEnvelope = await call<CloudflareZone[]>('/zones')
    if (!zonesEnvelope.success) {
      throw new Error(`Cloudflare zone listing while deleting record "${recordId}" failed: ${describeErrors(zonesEnvelope.errors)}`)
    }

    for (const zone of zonesEnvelope.result) {
      const envelope = await deleteInZone(zone.id, recordId)
      if (envelope.success) return
      const notFoundHere = envelope.errors.some((e) => e.code === RECORD_NOT_FOUND_CODE)
      if (!notFoundHere) {
        throw new Error(`Cloudflare TXT record deletion for id "${recordId}" failed: ${describeErrors(envelope.errors)}`)
      }
    }
    // Not found in any zone the token can see — already gone, which is the
    // outcome this method promises to swallow rather than throw on.
  }

  return { createTxtRecord, deleteTxtRecord, resolveZoneId }
}
