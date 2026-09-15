/**
 * DNS-rebinding-safe resolution for a URL that genuinely must come from the
 * request (recipe import) — the one case `isFetchableUrl`'s hostname check
 * (`network.ts`) cannot close on its own, since it validates a literal
 * address, not a name. A name that *resolves* to a private address (the
 * household's own LAN A records, `localtest.me`, `127.0.0.1.nip.io`) sails
 * straight past a hostname-only check; confirmed live, 2026-09-15, by the
 * peer session running on the actual home server, against a real canary
 * listener.
 *
 * The two-step version of this (resolve, check, then let `fetch` resolve
 * again to actually connect) is itself attackable: a DNS answer that is
 * public at check time and private a moment later swaps the target between
 * the check and the connection. This resolves ONCE, rejects if ANY returned
 * address is private, and pins the actual TCP connection to exactly that
 * vetted address via an undici `Agent` whose connector never resolves the
 * hostname again — only the vetted IP is ever dialled. The hostname itself
 * is untouched for TLS SNI and the `Host` header; only the raw connection
 * target is pinned.
 */
import { lookup as dnsLookup } from 'node:dns'

import { Agent } from 'undici'

import { isPrivateAddress } from './network.ts'

export class UnresolvableHostError extends Error {}
export class UnsafeAddressError extends Error {}

export interface Address {
  address: string
  family: number
}

/** The real `node:dns` lookup, wrapped to match `LookupAllFn` — the default, and the only production caller. */
function nodeLookupAll(hostname: string): Promise<Address[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err)
      else resolve(addresses)
    })
  })
}

export type LookupAllFn = (hostname: string) => Promise<Address[]>

export interface PinnedResolution {
  /** Pass as `fetch`'s own `dispatcher` option. Connects only to the vetted address, never re-resolving `hostname`. */
  dispatcher: Agent
  vettedAddress: string
  close(): void
}

/**
 * Builds a `net.connect`-compatible `lookup` override that always answers
 * with `vetted`, ignoring whatever hostname/options it is actually asked to
 * resolve — the whole point is that nothing downstream of this ever
 * performs a second, unvetted DNS lookup. Exported on its own so the
 * pinning behaviour itself is directly testable, not just inferred from
 * `resolvePinned`'s return value.
 *
 * The callback's array form (not a bare `address, family` pair) is what
 * Node's own happy-eyeballs connect path actually expects — verified live:
 * the flat form threw `ERR_INVALID_IP_ADDRESS` deep inside `node:net`, not
 * a type error, so this was not obvious from the types alone.
 */
export function pinnedLookup(vetted: Address): NodeNetLookupFunction {
  return (_hostname, _options, callback) => {
    callback(null, [{ address: vetted.address, family: vetted.family }])
  }
}

/** Matches `node:net`'s own `LookupFunction` shape without importing it — that type lives behind `net.SocketConnectOpts`, a much larger surface than this file needs. */
type NodeNetLookupFunction = (
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address: string | Address[], family?: number) => void,
) => void

/**
 * Resolves `hostname` once. Rejects (throws) if it does not resolve, or if
 * *any* returned address is private — not just the first — since a mixed
 * answer (one public, one private) invites exactly the inconsistent-use bug
 * a partial check would miss.
 *
 * `lookupAll` is injectable (default: real `node:dns`) so tests can drive
 * this with fixture DNS answers — deterministic and offline, the same
 * discipline `createFreshnessService`'s injectable `now()` and recipe
 * import's own injectable `fetcher` already follow in this codebase — rather
 * than this module's tests depending on live DNS resolution.
 */
export async function resolvePinned(hostname: string, lookupAll: LookupAllFn = nodeLookupAll): Promise<PinnedResolution> {
  let records: Address[]
  try {
    records = await lookupAll(hostname)
  } catch (error) {
    throw new UnresolvableHostError(`${hostname} did not resolve: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
  if (records.length === 0) throw new UnresolvableHostError(`${hostname} did not resolve to any address`)

  const unsafe = records.find((r) => isPrivateAddress(r.address))
  if (unsafe) {
    throw new UnsafeAddressError(`${hostname} resolves to a private or local address (${unsafe.address}); refusing to connect`)
  }

  const vetted = records[0] as Address
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(vetted) } })
  return { dispatcher, vettedAddress: vetted.address, close: () => void dispatcher.close() }
}
