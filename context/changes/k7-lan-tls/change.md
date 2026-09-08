# k7-lan-tls

```yaml
change_id: k7-lan-tls
memory_goal: 70d97cb6-59dd-4020-b3e8-2f7bd0bd8c04
change_anchor: c1b00607-b2d5-42eb-aa31-77998b12bcab
parent: 59472cdc-4531-4206-a9fc-968166c52250
epic: faza-0
slice: 5
mode: interactive
branch: change/k7-lan-tls
status: code-complete-pending-credentials
```

## What this delivers

The certificate path, end to end in code, plus the network boundary that a public
DNS name makes worth having.

```
src/server/tls/cloudflare.ts     DNS-01 via the Cloudflare API
src/server/tls/certificate.ts    issue, persist, renew — in this process
src/server/security/network.ts   who may talk to the kiosk
```

Renewal runs **in the Node process**: no certbot, no cron, no system package, no
root. The alternative fails by expiring silently on a machine in a kitchen that
nobody administers, discovered by the household rather than by a log.

## Answering "how do I keep this off the internet"

The structural answer is already true and is the real boundary: no public
address, no port forwarded, and an A record pointing at RFC1918 space that is not
routable from outside. The code adds two checks for the ways a LAN service gets
reached anyway.

| Check | Catches |
|---|---|
| Source address must be private | An accidental port forward, or the machine acquiring a second interface — VPN, container bridge, a public IP |
| `Host` header allowlist | **DNS rebinding** — a page on the open internet resolving *its own* name to a private address and issuing requests from the household's browser. The packets are genuinely local, so a source check sees nothing wrong; the header is what gives it away |

Verified live, including against the mutating endpoint:

```
normal request from LAN      -> 200
real TLS hostname as Host    -> 200
DNS-rebinding Host header    -> 400
rebinding against a mutation -> 400   (no item created)
```

Everything already inside the LAN is trusted. That is a choice for a household
appliance with no accounts, not an oversight — authentication is the answer only
if a guest network or an untrusted device changes the premise.

## Found by accident, and it would have broken everything

**The machine's LAN address changed mid-session**, `192.168.0.114` →
`192.168.1.107`. A `curl` hung, and that is how it surfaced rather than by
deduction.

An A record pointing at a DHCP lease is a kiosk and a certificate that both stop
working at an arbitrary future moment, with a failure that looks like the server
being down. **Pin the address with a DHCP reservation before publishing the
record**, and configure every client with the hostname rather than a literal.

## Staging by default

Let's Encrypt production allows five duplicate certificates per week and throttles
failed validations hard — and setup is exactly when things are wrong. Production
is opt-in via `K7_ACME_PRODUCTION`. A staging certificate is real but not
browser-trusted, which makes the difference visible instead of silent.

Also worth knowing: issuing for a hostname puts that name into public
Certificate Transparency logs. The address is not routable, but the name is
discoverable. A wildcard certificate is the way to keep the specific label out of
CT if that ever matters.

## Verified

| | |
|---|---|
| `npm run check` | exit 0, **29/29** tests |
| Network boundary | live, including a simulated rebinding POST |
| Cloudflare client | 4 tests, no network — including "never leaks the token into an error" |
| Renewal policy | 4 tests, injected clock |

## Not done — needs credentials only

Issuance has **not** been run. It needs a Cloudflare API token scoped
`Zone:DNS:Edit` on `revert-h0m3.co.pl`, which is a secret I must not handle: put
it in `.env.local` yourself. Then `K7_TLS_HOSTNAME`, and a staging run before
flipping production.

The HTTPS listener itself is also not wired yet — the cert has to exist first.
