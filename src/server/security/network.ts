/**
 * Who is allowed to talk to the kiosk.
 *
 * The structural answer is already good: the server has no public address and
 * the DNS record points at an RFC1918 address, which is not routable from the
 * internet. Nothing here replaces that. What it defends against is the ways a
 * LAN service gets reached anyway:
 *
 *   1. **DNS rebinding.** A page on the open internet resolves a name it
 *      controls to 192.168.x.x and then makes requests from *the household's
 *      own browser*, which is inside the network. The packets are local, so a
 *      source-address check sees nothing wrong. What catches it is the `Host`
 *      header: the attacker's page must send its own hostname, not ours. This
 *      is the attack this file mostly exists for.
 *   2. **An accidental port forward**, or the machine acquiring a second
 *      interface — a VPN, a container bridge, a public IP. A source-address
 *      check turns that from an exposure into a 403.
 *   3. **Anything else already on the LAN** — a guest phone, an IoT device with
 *      firmware from 2019. This file does *not* solve that: everything inside
 *      is trusted, which is a deliberate choice for a household appliance and
 *      not an oversight. Authentication is the answer if that ever changes.
 */

function isPrivateIPv4Parts(a: number, b: number): boolean {
  if (a === 127 || a === 10 || a === 0) return true // 0.0.0.0/8 binds/routes to local listeners
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

/** `1.2.3.4` → `[1,2,3,4]`, or `null` if not a plain dotted-quad. */
function parseIPv4(address: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address)
  if (!m) return null
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  return parts.some((n) => Number.isNaN(n) || n > 255) ? null : parts
}

/**
 * Expands any valid IPv6 literal (`::` compression, a zone id, the whole
 * range of equivalent forms `fd00::1` / `fd00:0:0:0:0:0:0:1` / `FD00::1`)
 * into its 8 hextets, or `null` if the string is not a syntactically valid
 * IPv6 address. Needed because every private-range check below depends on
 * comparing actual hextet values, and a compressed or re-cased form defeats
 * a prefix-string check the way `URL#hostname`'s own canonical output
 * (`::ffff:7f00:1`, not `::ffff:127.0.0.1`) defeated the previous version
 * of this file — found live, 2026-09-15, by the peer session that also
 * caught the IPv4-mapped, ULA, and link-local forms this now handles, and
 * a bracketed literal (`[::1]`, exactly what `URL#hostname` produces for
 * any IPv6 host) being checked against `::1` and never matching at all.
 *
 * Handles both IPv4-embedded notations: the canonical all-hex form
 * `URL#hostname` itself produces (`::ffff:7f00:1`) and the legacy dotted
 * form Node reports for a dual-stack socket's `req.ip` (`::ffff:192.168.1.2`,
 * RFC 4291 §2.2 item 3) — this file's own original comment already relied
 * on the second form for the inbound check, and a first pass at this fix
 * broke it by only handling the first.
 */
function expandIPv6(address: string): number[] | null {
  const zoneIdx = address.indexOf('%')
  const noZone = zoneIdx === -1 ? address : address.slice(0, zoneIdx)
  const halves = noZone.split('::')
  if (halves.length > 2) return null
  const hextets = (s: string): number[] | null => {
    if (s === '') return []
    const segments = s.split(':')
    const last = segments[segments.length - 1] ?? ''
    if (last.includes('.')) {
      const v4 = parseIPv4(last)
      if (!v4) return null
      const [a, b, c, d] = v4 as [number, number, number, number]
      const head = segments.slice(0, -1).map((h) => (/^[0-9a-f]{1,4}$/i.test(h) ? parseInt(h, 16) : NaN))
      if (head.some((h) => Number.isNaN(h))) return null
      return [...head, (a << 8) | b, (c << 8) | d]
    }
    const out: number[] = []
    for (const h of segments) {
      if (!/^[0-9a-f]{1,4}$/i.test(h)) return null
      out.push(parseInt(h, 16))
    }
    return out
  }
  const head = hextets(halves[0] ?? '')
  const tail = halves.length === 2 ? hextets(halves[1] ?? '') : []
  if (!head || !tail) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const missing = 8 - head.length - tail.length
  return missing < 0 ? null : [...head, ...Array(missing).fill(0), ...tail]
}

function isPrivateIPv6(hextets: number[]): boolean {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets as [number, number, number, number, number, number, number, number]
  if (hextets.every((h) => h === 0)) return true // :: (unspecified) and ::1 differ only in h7, both caught here or below
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0 && h6 === 0 && h7 === 1) return true // ::1 loopback
  if ((h0 & 0xfe00) === 0xfc00) return true // fc00::/7 — unique local
  if ((h0 & 0xffc0) === 0xfe80) return true // fe80::/10 — link-local
  // ::ffff:0:0/96 — an IPv4-mapped address; decode the embedded IPv4 and
  // apply the IPv4 rules to it rather than treating the wrapper as public.
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
    return isPrivateIPv4Parts((h6 >> 8) & 0xff, h6 & 0xff)
  }
  return false
}

/** Loopback, RFC1918, link-local, CGNAT, 0.0.0.0/8, and every IPv6 equivalent (bracketed or not, compressed or not, mapped or not). */
export function isPrivateAddress(address: string): boolean {
  if (!address) return false
  // `URL#hostname` wraps any IPv6 literal in brackets (`[::1]`); a raw
  // socket address (Fastify's `req.ip`) never is — stripping is a no-op there.
  const unbracketed = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address
  // A trailing dot is the DNS-root notation for the same name — RFC 1035 — and
  // resolves identically; `localhost.` must not slip past a bare `localhost` check.
  const ip = unbracketed.endsWith('.') ? unbracketed.slice(0, -1) : unbracketed

  if (ip === 'localhost') return true

  const v4 = parseIPv4(ip)
  if (v4) return isPrivateIPv4Parts(v4[0] as number, v4[1] as number)

  const v6 = expandIPv6(ip)
  if (v6) return isPrivateIPv6(v6)

  return false
}

/**
 * The other direction: not who may reach the kiosk, but where the kiosk's
 * own server may be sent to fetch on a client's say-so — `rssUrl` on
 * `/api/comic`, an imported recipe's source page, anywhere a route takes a
 * URL from the request rather than from `layout.yaml`. Only http/https, and
 * only a public-looking host: a literal private/loopback address is caught,
 * a hostname that *resolves* to one is not, since that needs a DNS lookup
 * this function does not perform — full DNS-rebinding protection for
 * outbound fetches is a deliberate, disclosed gap, not an oversight (see
 * `recipes/import.ts`'s original `assertImportable`, which this generalizes).
 * A URL a household member typed into `layout.yaml` is not this function's
 * concern — that file is trusted config, not request input.
 */
export function isFetchableUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return !isPrivateAddress(url.hostname)
}

/**
 * A `Host` header is acceptable if its name is one we answer to. The port is
 * ignored — it is not a security boundary and varies with how the kiosk is
 * reached — and an IP literal is accepted only when it is private, so
 * `Host: evil.example.com` aimed at our address is rejected while
 * `Host: 192.168.0.114:8080` from the iPad is not.
 */
export function isAllowedHost(host: string | undefined, allowed: readonly string[]): boolean {
  if (!host) return false
  const name = host.startsWith('[')
    ? (host.split(']')[0] ?? '').slice(1)
    : (host.split(':')[0] ?? '')
  if (!name) return false
  const lower = name.toLowerCase()
  if (allowed.some((a) => a.toLowerCase() === lower)) return true
  if (lower === 'localhost') return true
  return isPrivateAddress(lower)
}
