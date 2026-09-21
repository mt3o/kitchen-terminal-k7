# Plan: k7-google-oauth-connect

**Memory surface unavailable while drafting.** The `agentic-memory` MCP server
failed to connect this session (`Executable not found in $PATH:
agentic-memory-mcp`) and the CLI is not on PATH either, so no `recall_context`,
`impact_of` or `domain_model` call backs this plan. Node ids cited below are the
ones already written into committed files, not fresh recall. Every capture this
plan would have made is queued in `memory-backlog.md` for replay. Treat the
plan-boundary capture as outstanding, not done.

Settled constraints this plan is written against, from the committed record:

- `[node:ab43353e]` — Google bounded to refresh token + API client, **no
  consent-flow UI**. This change reverses it deliberately; see `change.md`.
- `[node:ac006a24]` — the Google refresh token and the Kilo key are server-side
  only and never reach the frontend or the iPad. **Unchanged and binding**: the
  token must not become reachable from the browser just because a browser now
  starts the flow.
- `[node:4a749051]` — no placeholder data presented as real. A connection that
  has failed must say so, not quietly serve mock events as though they were the
  calendar.
- `[node:c129f201]` — the GCAL decision (bidirectional in principle).

## Non-goals

- **No new scopes.** The flow requests exactly what the code uses today,
  `calendar.readonly`. Write access is `[node:c129f201]`'s eventual business and
  a separate consent decision.
- **No multi-account.** One Google connection for the household, as today. A
  second account is still "share the calendar to this one" (the strategy already
  settled for other people's calendars).
- **No button on the kiosk.** The wall display is unauthenticated; the admin
  surface is reachable only by someone who has pasted the admin token into their
  own browser.
- **No replacement of `GOOGLE_OAUTH_REFRESH_TOKEN`.** The env var keeps working
  untouched; this adds a second, higher-precedence source.
- **No secret ever sent to the browser.** The admin UI sees connection *status*
  — connected, account, scope, when — never a token, ciphertext or key.
- **No generic secrets store.** One table, one provider row. A key-value secrets
  cabinet is a different, larger idea and is not sneaked in here.

## Design decisions

### 1. The admin token guards the server, not the button

`K7_ADMIN_TOKEN` (new, `@sensitive @optional` in `.env.schema`, added to
`secretValues()`). Sent as the `X-K7-Admin-Token` **header** — never a query
parameter, which would put the credential in every access log and in the
GlitchTip breadcrumb trail. Compared with `crypto.timingSafeEqual` on equal-length
buffers.

**Unset means the endpoints do not exist** — they answer `404`, the same shape an
unknown route gets, not `403`. A default deployment therefore has no
credential-granting surface at all, which keeps "absent is a supported way to
run" true for this feature the way it is already true for Google credentials
themselves. A wrong token also gets `404`: a `403` confirms to a prober that
there is something there to guess at.

The value the household pastes into `localStorage` on their laptop is this same
token. It gates the button's *visibility* client-side and the route's
*acceptance* server-side — the second is the one that matters, the first is
ergonomics.

### 2. Storage: a dedicated table, encrypted with a key from the environment

**The database is a safe home for this.** `scripts/deploy.sh` resets the checkout
with `git reset --hard` and runs no `git clean`, so gitignored `./data/k7.sqlite`
survives a deploy untouched. That was the open worry when this idea was first
discussed and it resolves in favour of the DB — verified against the script, not
assumed.

New table `oauth_credentials`, one row per provider:

| column | |
|---|---|
| `provider` | text primary key, `'google'` today |
| `ciphertext` | blob — AES-256-GCM over the refresh token |
| `iv` | blob, 12 bytes, fresh per write |
| `auth_tag` | blob, 16 bytes |
| `scope` | text — what was actually granted, for the status view |
| `account_email` | text nullable — for "connected as …", display only |
| `created_at` / `updated_at` | integer epoch ms, matching existing tables |

Encryption is AES-256-GCM from Node's built-in `crypto`, no dependency. The key
is `K7_SECRET_KEY` (new, `@sensitive @optional`, 32 bytes base64), run through
HKDF-SHA256 with a fixed per-purpose info string so this key can serve another
purpose later without reusing the same derived bytes.

**What this does and does not buy, stated plainly.** It protects a database file
that leaks *on its own* — a backup copied off the box, a stray `data/` in a
support bundle, a file handed to someone to debug. It does **not** protect
against an attacker with shell access on the host, because the key lives in
`.env.local` on the same machine, exactly where the plaintext token lives today.
That is a real but bounded improvement and it is the honest description of it.

**Rejected: tying the key to the host** (`/etc/machine-id` or similar). It
defends the same threat, but it silently bricks on a host migration or a
restore-from-backup, and the only recovery is a re-auth the household will
discover at the worst moment. An explicit key in the env file is recoverable,
backupable and visible.

`K7_SECRET_KEY` unset ⇒ the connect flow is **off** (status reports why, the
routes 404), because storing a refresh token in plaintext in the DB would be a
worse posture than the env var it replaces. The already-working env-var path is
unaffected.

### 3. Precedence: the database wins when a row exists

Resolution order for the refresh token: **DB row → `GOOGLE_OAUTH_REFRESH_TOKEN` →
nothing (mock events, as today).**

The DB has to win, and this is the load-bearing choice in the plan. The opposite
rule produces the worst possible failure: the household clicks *connect*, Google
consents, the token is stored — and the calendar keeps using a stale env var,
silently, with the UI reporting success. A connect button that appears to work
and does nothing is worse than no button.

The boot line gains `google_refresh=db|env|unset` so which source is live is
visible without guessing. *Disconnect* deletes the row, and the env var —
if still set — takes over again on the next resolve.

### 4. The callback cannot carry the admin header, so `state` carries the trust

Google redirects the browser to the callback; it will not attach
`X-K7-Admin-Token`. So `GET /api/google/callback` is **not** admin-guarded, and
guarding it with the header would simply break the flow.

Instead `POST /api/google/auth/start` (which *is* guarded) mints a single-use
`state`: 32 random bytes, held in memory with a 10-minute TTL, deleted on first
use. The callback accepts only a `state` that is present, unexpired and unused,
and consumes it. That is both the CSRF defence and the authorisation for the
callback — an unsolicited callback has no valid state and is rejected before the
code is ever exchanged. In-memory is correct here: a restart mid-flow should
invalidate the attempt, not resurrect it.

### 5. Redirect URI — this needs a *new* OAuth client

The client currently in use is a **Desktop app** client, which cannot register an
`https://` redirect. The flow needs a **Web application** client with
`https://<K7_HOSTNAME>/api/google/callback` registered exactly. The redirect URI
the server builds is derived from config, never from the request's `Host` header
— a request-derived redirect is how an attacker points the consent at their own
host.

This is a manual Cloud Console step, and `docs/google-calendar-oauth.md` gains
the section for it. The existing Desktop client keeps working for the manual
procedure; both are documented, neither is deleted.

### 6. Failure is surfaced, never papered over

Per `[node:4a749051]`: when the stored token is rejected (`invalid_grant` —
revoked, password changed, long disuse), the calendar falls back to mock events
*as it already does for absent credentials*, but the connection status turns
`error` with the reason, so the admin view says "disconnected: invalid_grant"
rather than the dashboard looking fine while showing fiction. Google may return a
rotated `refresh_token` on exchange; whatever comes back is stored.

## Phase 1 — Schema, crypto, config

- `src/server/db/schema.ts`: `oauthCredentials` table per §2.
- `drizzle/0002_*.sql` via `npm run db:generate` — not hand-written.
- `src/server/crypto/secret-box.ts` (new): `encryptSecret` / `decryptSecret`,
  HKDF key derivation, and a `hasSecretKey` boundary check in the same shape as
  `hasGoogleCalendarCredentials`.
- `src/server/config.ts` + `.env.schema` + `.env.example`: `K7_ADMIN_TOKEN`,
  `K7_SECRET_KEY`. **Both added to `secretValues()` in the same edit** — this
  project's standing discipline, and the comment there says why.
- Boot line: `admin=set|unset secret_key=set|unset`, values never printed.

**Tests:** round-trip encrypt/decrypt; a tampered `auth_tag` throws rather than
returning plaintext; a wrong key throws; two encryptions of the same input differ
(fresh IV).

## Phase 2 — Credential store and resolution

- `src/server/oauth/credential-store.ts` (new): `read`/`write`/`clear` for the
  provider row, encrypting on the way in and decrypting on the way out. Returns
  a discriminated result (`ok` / `absent` / `undecryptable`) — a row that will
  not decrypt (key rotated, key lost) is **not** an absent row and must not be
  silently overwritten or ignored; it is a reportable state.
- `src/server/oauth/resolve-google-credentials.ts` (new): the §3 precedence rule,
  the single place that answers "what refresh token are we using and from
  where?". `google-calendar.ts` keeps taking credentials as a parameter — its
  boundary check stays exactly as it is.

**Tests:** DB beats env; env used when no row; neither ⇒ absent; `undecryptable`
does not fall through to env (it reports, because falling back would hide a
misconfigured key behind a working-looking dashboard).

## Phase 3 — Routes

All under `/api/admin/google/`, all behind the §1 guard except the callback:

- `GET  status` — `{ connected, source: 'db'|'env'|'none', scope, accountEmail,
  updatedAt, error? }`. No secret, no ciphertext.
- `POST auth/start` — mints `state`, returns the consent URL
  (`access_type=offline`, `prompt=consent`, the readonly scope).
- `GET  callback` — consumes `state`, exchanges the code, fetches the account
  email for display, stores, redirects back to the admin view with a result
  flag.
- `POST disconnect` — clears the row; best-effort `POST` to Google's revoke
  endpoint, whose failure is logged and does not fail the request (local state
  is what this route promises).

**Tests:** 404 when `K7_ADMIN_TOKEN` unset; 404 on a wrong token; callback
rejects an unknown, expired or already-used `state`; a successful exchange
stores what Google returned, including a rotated refresh token.

## Phase 4 — Admin surface

A separate page at `/admin`, **not** a card in `layout.yaml` — the kiosk is
unchanged and nothing new appears on the wall display. The page reads
`localStorage['k7.adminToken']`; with no token it shows only how to set one,
because a login form on an open LAN page is theatre.

Obeys the token contract — every colour, radius and font from `var(--*)`
(`npm run lint:tokens` enforces it). Polish UI copy, matching the rest of the
dashboard.

## Phase 5 — Docs and changelog

- `docs/google-calendar-oauth.md`: the Web-application-client section, the
  `/admin` route, the two env vars, and the manual procedure retained as the
  fallback it still is.
- `README.md`: the connect flow named in the existing Google Calendar section.
- **`changelog.yaml`: an entry dated 2026-09-20, in this change** — the standing
  rule, and this is user-facing.

## Verification

`npm run check` (lint + token contract + tokens:check + tests + build). Live
verification needs the new Web client in Cloud Console, which is the household's
step — the manual path stays working throughout, so a half-finished console step
cannot take the calendar down.
