# k7-deploy

```yaml
change_id: k7-deploy
memory_goal: 430c9542-7dd1-4b78-bfa1-760e6afcee1d
change_anchor: 095a9bf5-61d6-4cd5-b805-72a25527c104
parent:
  - 70d97cb6-59dd-4020-b3e8-2f7bd0bd8c04   # k7-lan-tls
  - 59472cdc-4531-4206-a9fc-968166c52250   # foundation
epic: faza-0
branch: change/k7-deploy
status: deployed on HTTPS with a trusted certificate
```

## Running

**`https://k7.revert-h0m3.co.pl:8443/`** — on `192.168.0.10`, as a systemd user
service, enabled with lingering so it comes back after a reboot with nobody
logged in. Trusted certificate, `Verify return code: 0`.

`./scripts/deploy.sh [ref]` is the only way it is updated.

## The target is not what the plan assumed

`HANDOFF.md` describes "a physical machine in the home LAN" as if it were
dedicated. It is a **shared household server**: nginx already owns `:80` for
other names, docker runs paperless, portainer and invidious, and this account has
**no passwordless sudo**.

That settles the shape rather than being an obstacle:

| | |
|---|---|
| systemd **user** unit, not system | No root needed; lingering is already on, so it starts at boot |
| High port, not 443 | Binding 443 needs a capability only root grants |
| Its own certificate | The nginx that is already there terminates no TLS at all today |

Putting K7 behind that nginx would give it `:443` and a clean URL. It needs a
human with sudo to add a vhost, and it is a genuine option — not a decision this
change should make silently.

## Three bugs the first real deploy found

None of these were visible locally.

1. **The kiosk returned 400 for its own hostname.** The Host allowlist was keyed
   off a variable named `K7_TLS_HOSTNAME`; TLS was not configured yet, so it was
   unset, so the name was not allowed — while the IP worked fine. On a tablet
   that is indistinguishable from broken DNS. The name a kiosk answers to is not
   a TLS detail: renamed `K7_HOSTNAME`, one name for one thing, regression test
   added.
2. **`StartLimitIntervalSec` was under `[Service]`**, where systemd ignores it
   with a warning that scrolls past in a deploy log. It belongs in `[Unit]`, and
   it is what stops a display that dies at 03:00 from hitting a restart limit and
   waiting for a human.
3. **The deploy reported an empty listening set.** It polled `systemctl
   is-active`, which is true the moment the process starts and before Node binds.
   A deploy is finished when a port is bound; it now polls for that and fails
   loudly if none appears.

## Verified against the deployed instance

| | |
|---|---|
| `http://k7.revert-h0m3.co.pl:8080/api/health` | 200 |
| By IP | 200 |
| `Host: rebind.evil.example` | **400** — the boundary holds in production |
| `/api/weather` | live, 22.3 °C |
| Rendered at 1024×768 | six cards, live clock, `STATUS: ONLINE` |
| `systemctl --user is-enabled` / linger | enabled / yes |

## TLS, done

Staging first, then production, which is what the policy is for.

| | |
|---|---|
| Staging issuance | ~25 s, `(STAGING) Dastardly Durum YR1`, untrusted as expected |
| Challenge TXT | created and removed — verified at the **authoritative** nameserver |
| Production issuance | `Let's Encrypt YR2`, valid to 7 Dec 2026 |
| Chain | `Verification: OK`, `Verify return code: 0` |
| **The point of all of it** | `isSecureContext: true`, `serviceWorker: true`, `caches: true` on the real origin |

### Two things caught between staging and production

**A staging certificate would have survived the flip.** `ensureCertificate` asked
only whether the stored certificate had expired, and a staging one with 89 days
left passes that test — so `K7_ACME_PRODUCTION=true` would have changed nothing
and the kiosk would have kept serving an untrusted certificate while the config
claimed otherwise. The only symptom is a browser warning, which is the warning
everyone has just spent an hour learning to click through. The gate now compares
the stored certificate's environment against the configured one.

**The challenge record had not leaked.** A recursive query still returned it and
the cleanup code was about to be rewritten; the authoritative nameserver had
already dropped it and the resolver was serving a 25-second-old cache entry. A
cache is not evidence about the state of a zone.

## Left open

- The renewal path has not been *observed* — it is tested as policy and will not
  actually run for ~60 days.

## Update 2026-09-14 — `:443`/`:80`, done outside this repo

The `:8443` item above is resolved, entirely on the server side — no commit in
this repo did it, which is why this change.md and `changelog.yaml` had gone
stale on it. Done by a session working directly on `192.168.0.10` as root, per
mt3o's direction, not by a `/gw-*` change here:

- **2026-09-10** — nginx added an SNI-passthrough stream (`ssl_preread`) for
  `k7.revert-h0m3.co.pl`: `:80` redirects to https, `:443` relays the still-
  encrypted TLS straight to K7's own `:8443`, so K7 kept issuing and terminating
  its own certificate. `https://k7.revert-h0m3.co.pl/` has worked with no port
  since that date.
- **2026-09-14** — switched to nginx terminating TLS itself with the box's
  wildcard Let's Encrypt cert (certbot, `*.revert-h0m3.co.pl`), reverse-proxying
  plaintext to K7's `:8443` over loopback with `proxy_protocol` carrying the real
  client IP. K7 does not yet read that header — see below.

**Left open by this switch, paused on mt3o's instruction (2026-09-14):**

- K7's Fastify instance needs `trustProxy` pointed at the loopback address so
  `req.ip` comes from the PROXY-protocol/`X-Forwarded-For` info nginx now sends,
  instead of seeing every request as `127.0.0.1`. Until this lands, the
  LAN-source check in `security/network.ts` is effectively blind (still safe —
  everything still reads as private — just no longer meaningful as the
  "accidental exposure" check the file's docstring describes).
- K7 is still bound to `0.0.0.0:8443`, so a LAN client can still reach it
  directly, bypassing nginx (and, until `trustProxy` lands, could in principle
  spoof its own forwarded-for value by talking to K7 directly). Binding K7 to
  `127.0.0.1` was suggested alongside the above.
- Whether K7 keeps its own in-process ACME/Cloudflare-DNS-01 client at all, now
  that nginx terminates TLS with its own wildcard cert, is an open question —
  not decided, not started.
