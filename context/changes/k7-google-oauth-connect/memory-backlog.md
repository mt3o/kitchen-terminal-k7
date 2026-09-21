# Memory backlog — k7-google-oauth-connect

The store was unreachable for this change's planning session: the
`agentic-memory` MCP server failed to connect (`ENOENT: Executable not found in
$PATH: agentic-memory-mcp`) and `agentic-memory` is not on PATH either, so the
CLI transport was not available as a fallback. Per the standing rule, the
operations are queued here rather than skipped, and replayed when the surface
returns.

## 1. create_change (outstanding)

`change.md` has no `memory_goal` or `change_anchor`. Both must be minted before
any capture below is replayed — goal-mandatory writes.

## 2. Captures

**a. decision — DB-stored OAuth credential takes precedence over the env var.**
Resolution order is DB row → `GOOGLE_OAUTH_REFRESH_TOKEN` → absent. The opposite
rule makes a successful consent flow silently inert against a stale env var, so
the UI would report success while the calendar kept using the old token.
Facets: backend, security, integration. `ABOUT` → `Calendar`.
Parent: `[node:ab43353e]`.

**b. decision — the admin token guards the routes; localStorage only reveals the
button.** `K7_ADMIN_TOKEN` unset ⇒ the routes answer 404, so a default
deployment exposes no credential-granting surface; a wrong token gets 404 too,
not 403. The client-side flag is ergonomics on an unauthenticated kiosk LAN, and
is not load-bearing.
Facets: backend, security. Parent: `[node:ac006a24]`.

**c. decision — refresh token encrypted at rest with an env-supplied key, not a
host-derived one.** AES-256-GCM, key from `K7_SECRET_KEY` via HKDF. Defends a
database file that leaks on its own (backups, support copies); does **not**
defend against shell access on the host, since the key sits in `.env.local`
beside where the plaintext lives today. A host-tied key was rejected: same
threat covered, but it bricks on restore or host migration with re-auth as the
only recovery.
Facets: backend, security. `ABOUT` → `Calendar`.

**d. constraint — the OAuth callback is authorised by a single-use `state`, not
by the admin header.** Google's redirect cannot carry `X-K7-Admin-Token`, so the
state minted by the guarded `auth/start` (32 random bytes, 10-minute TTL,
deleted on first use, in memory) is both the CSRF defence and the callback's
authorisation.
Facets: backend, security.

**e. constraint — the redirect URI is derived from config, never from the
request `Host` header**, and requires a Web-application OAuth client; the
existing Desktop client cannot register an `https://` redirect.
Facets: backend, security, integration.

## 3. CONTRADICTS edge — record, do not resolve

`[node:ab43353e]` ("Google bounded to refresh-token + API client, no consent-flow
UI") is contradicted by this change. The node is not wrong on its own terms: its
two supports — no registrable redirect URI, and no authenticated surface on an
open kiosk — were both removed by the LAN TLS work and by `K7_ADMIN_TOKEN`
respectively. Flag for human review; this is a human's call, not the agent's.

## 4. Events (append_events)

- `USED` — `[node:ab43353e]`, `[node:ac006a24]`, `[node:4a749051]`,
  `[node:c129f201]` while drafting this plan.
- `CONTRADICTED` — `[node:ab43353e]`, per §3.
- `NOTED` — `scripts/deploy.sh` runs `git reset --hard` with no `git clean`, so
  a gitignored `data/k7.sqlite` survives deploys; that is what makes the DB a
  valid home for a credential. Verified against the script on 2026-09-20.

## 5. Not for the graph

The prose how-to in `docs/google-calendar-oauth.md` is documentation, not
knowledge: it fails the three-part test (reversible, unsurprising, no trade-off).
