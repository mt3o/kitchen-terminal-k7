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
status: deployed on HTTP; TLS pending a Cloudflare token
```

## Running

**`http://k7.revert-h0m3.co.pl:8080/`** — on `192.168.0.10`, as a systemd user
service, enabled with lingering so it comes back after a reboot with nobody
logged in.

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

## Next, and it needs you

`.env.local` on the box has the hostname and timezone. **Add the Cloudflare API
token to it** (`Zone:DNS:Edit` on `revert-h0m3.co.pl`) and redeploy: the server
will issue a **staging** certificate and move to `:8443`. Staging is not
browser-trusted — that is deliberate, so the first run proves the DNS-01 loop
without spending the production rate limit. Then set `K7_ACME_PRODUCTION=true`.
