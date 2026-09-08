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

/** Loopback, RFC1918, link-local, CGNAT, and IPv6 loopback/ULA. */
export function isPrivateAddress(address: string): boolean {
  if (!address) return false
  // Node reports IPv4 clients on a dual-stack socket as ::ffff:192.168.0.5.
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address

  if (ip === '::1' || ip === 'localhost') return true
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true
  if (/^fe80:/i.test(ip)) return true

  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return false
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  if (parts.some((n) => Number.isNaN(n) || n > 255)) return false
  const a = parts[0] as number
  const b = parts[1] as number

  if (a === 127 || a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
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
