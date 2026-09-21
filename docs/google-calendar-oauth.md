# Getting the Google Calendar OAuth2 refresh token

There are two ways to give this project a Google Calendar refresh token.

- **From a browser, at `/admin`** — the admin panel runs the consent flow and
  stores the result encrypted in the database. Set up once (§6), used by
  clicking. This is the easier path and the one to prefer.
- **By hand, into `.env.local`** — §§1–5 below. Needs shell access on the
  server, and is what the browser flow falls back to. It is also the only path
  that works before `K7_HOSTNAME` and a certificate exist.

Both end at the same place: a long-lived refresh token that
`src/server/upstream/google-calendar.ts` exchanges for short-lived access
tokens (`https://oauth2.googleapis.com/token`) in order to call `events.list`.
When both are configured, **the database wins** — see §6.

Three variables come out of this procedure, all `@sensitive` in `.env.schema`:

| Variable | Where it comes from |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | the OAuth client you create in step 2 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | the same client |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | the one-off consent in step 3 |

They belong in `.env.local` on the server machine, never in the repo and never
in anything the iPad downloads. Leaving them unset is a supported way to run —
a calendar configured with `source.mode: google` then falls back to the
client's mock events instead of erroring.

## 1. Enable the Calendar API

1. Open the [Google Cloud Console](https://console.cloud.google.com/) with the
   account that owns the calendar.
2. Create a project (or reuse one) — name it something like `kitchen-terminal-k7`.
3. **APIs & Services → Library → Google Calendar API → Enable**.

## 2. Create an OAuth client

1. **APIs & Services → OAuth consent screen**. Pick **External** unless the
   account is on Google Workspace, fill in the app name and your own address
   for both support contacts, and save. Scopes can be left empty here — the
   authorization request in step 3 asks for what it needs.
2. Add your own Google account under **Audience → Test users**. A consent
   screen left in *Testing* is fine and is what you want: the only thing it
   costs is that refresh tokens issued to a testing app expire after 7 days.
   **Publish the app** (Audience → Publish) before minting the real token, so
   the refresh token does not silently die a week later.
3. **Credentials → Create credentials → OAuth client ID → Desktop app**.
   Copy the client id and client secret.

A Desktop-app client is the right shape here: it has no redirect URI to host,
and Google allows the loopback / out-of-band style redirect the one-off flow in
step 3 uses.

## 3. Mint the refresh token

Only a read scope is needed for what is implemented today:

```
https://www.googleapis.com/auth/calendar.readonly
```

(The longer-term intent recorded in `context/foundation/foundation.md` is a
bidirectional integration. Ask for `.../auth/calendar` instead if you would
rather not redo this when write support lands — but then the token can also
delete events, so do that deliberately.)

Use whatever flow you find least annoying. Two that work:

**Option A — OAuth 2.0 Playground** (no code):

1. Open <https://developers.google.com/oauthplayground/>.
2. Gear icon → tick **Use your own OAuth credentials**, paste the client id
   and secret from step 2.
3. Add `https://developers.google.com/oauthplayground` as an **Authorized
   redirect URI** on that client in the Cloud Console (Credentials → your
   client → edit). This is the one thing a Desktop-app client cannot do, so
   for this option create a **Web application** client instead.
4. In the left panel enter the scope above, **Authorize APIs**, consent as the
   calendar owner, then **Exchange authorization code for tokens**.
5. Copy the `refresh_token` from the response.

**Option B — a one-off local script** (keeps the Desktop-app client):

1. Build the consent URL, replacing `CLIENT_ID`:

   ```
   https://accounts.google.com/o/oauth2/v2/auth?client_id=CLIENT_ID&redirect_uri=http://127.0.0.1:8765&response_type=code&scope=https://www.googleapis.com/auth/calendar.readonly&access_type=offline&prompt=consent
   ```

   `access_type=offline` is what makes Google issue a refresh token at all,
   and `prompt=consent` forces a fresh one even if you have consented before.

2. Add `http://127.0.0.1:8765` to the client's authorized redirect URIs, open
   the URL in a browser, consent, and read the `code=` parameter off the
   redirect (the browser will show a connection error — the code is still in
   the address bar).

3. Exchange it:

   ```bash
   curl -s https://oauth2.googleapis.com/token \
     -d client_id=CLIENT_ID \
     -d client_secret=CLIENT_SECRET \
     -d code=THE_CODE \
     -d grant_type=authorization_code \
     -d redirect_uri=http://127.0.0.1:8765
   ```

   The `refresh_token` field of the JSON response is what you want. It is
   returned **only on this first exchange** — if you lose it, re-run the
   consent URL with `prompt=consent`.

## 4. Put it in `.env.local`

On the server machine, in the deployed checkout's `.env.local`:

```
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REFRESH_TOKEN=1//...
```

Restart the server. Nothing else needs configuring for credentials — the
per-card calendar selection is layout data, not secrets.

## 5. Point a calendar card at it

The calendar id is the address of the calendar as Google reports it under
**Calendar settings → Integrate calendar → Calendar ID** — your own address
for the primary calendar, or a `...@group.calendar.google.com` string for a
secondary one. Because it identifies the household, it belongs in the
gitignored `layout.local.yaml`, not in `layout.yaml`:

```yaml
source:
  mode: google
  calendarId: "you@gmail.com"
```

Calendars owned by *other* people are shared to this account and then listed
the same way; a calendar that cannot be shared is an `.ics` URL with
`mode: ics` instead. Neither needs a second OAuth client.

## 6. The browser flow (`/admin`)

The panel ships with every deploy but is **off until you switch it on**. Two
environment variables do that, and without both of them the server registers
neither `/admin` nor its API routes — a deployment that has not opted in has no
credential-granting surface on an unauthenticated kitchen LAN.

| Variable | Does |
|---|---|
| `K7_ADMIN_TOKEN` | guards every admin route; the same value is pasted into the panel |
| `K7_SECRET_KEY` | encrypts the stored refresh token (AES-256-GCM); exactly 32 bytes, base64 |

A missing key keeps the flow **off** rather than writing a token to the database
in the clear.

### Switching it on

Everything below happens on the server machine except step 5.

**1. Create a Web application OAuth client.** The Desktop-app client from §2
cannot register an `https://` redirect, so the browser flow needs a second
client: Cloud Console → **Credentials → Create credentials → OAuth client ID →
Web application**, with this authorised redirect URI:

```
https://<K7_HOSTNAME>:8443/api/admin/google/callback
```

Include the port whenever the kiosk is not on 443 — Google matches the URI
byte for byte, and a missing `:8443` fails the consent with
`redirect_uri_mismatch`. Once the panel is up it prints the exact URI the server
sends; if in doubt, paste that one.

**2. Read this before swapping the client.** A refresh token is bound to the
client that issued it. The moment `GOOGLE_OAUTH_CLIENT_ID` and
`GOOGLE_OAUTH_CLIENT_SECRET` point at the new Web client, the existing
`GOOGLE_OAUTH_REFRESH_TOKEN` — minted against the Desktop client — stops
working, and Google answers every refresh with `unauthorized_client`. So:

- from the restart in step 4 until you finish step 5, every refresh fails:
  the calendar keeps serving its last cached week, marked stale, and falls to
  its error state once that runs out — so do the two steps back to back;
- afterwards the env var is no longer a fallback. Either delete it, or re-mint
  it against the *Web* client (§3 Option A works: add
  `https://developers.google.com/oauthplayground` as a second redirect URI on
  that same client).

**3. Put the new client and the two variables in `.env.local`.**

```bash
printf 'K7_ADMIN_TOKEN=%s\nK7_SECRET_KEY=%s\n' "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" >> ~/kitchen-terminal-k7/.env.local
```

Then edit `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` to the Web
client's values by hand. Keep a copy of `K7_SECRET_KEY` wherever you keep your
backups — without it a restored database's credential cannot be read (see
below).

**4. Restart and check the boot line.**

```bash
systemctl --user restart k7
```

```bash
journalctl --user -u k7 -n 1 --no-pager | grep -o 'admin=[a-z]*\|secret_key=[a-z]*\|google_refresh=[a-z]*'
```

You want `admin=set` and `secret_key=set`. A malformed `K7_SECRET_KEY` (not 32
bytes once decoded) stops the server at boot on purpose, instead of failing
later at the first write.

**5. Connect, from a laptop.** Open `https://<K7_HOSTNAME>:8443/admin`, paste
`K7_ADMIN_TOKEN` into the field (the panel keeps it in that browser's
`localStorage`), and press *[ POŁĄCZ KONTO ]*. Consent as the calendar's owner.
Google returns you to a page that says *Google: połączono* and names the account;
back on `/admin` the status reads *POŁĄCZONE — z bazy*.

Use a laptop rather than the kitchen iPad: Safari 15 in kiosk mode is not where
anyone wants to type a Google password, and the panel is deliberately left out
of the iPad's offline cache.

### What happens under the hood

```
laptop  POST /api/admin/google/auth/start   (X-K7-Admin-Token header)
server  → mints a single-use state, 10 min TTL, kept in memory
        ← consent URL (calendar.readonly + userinfo.email, offline, prompt=consent)
laptop  → Google consent screen → "Allow"
Google  → GET /api/admin/google/callback?code=…&state=…
server  → consumes the state (a replay or a forged one gets 400)
        → exchanges the code for a refresh token
        → asks Google for the account e-mail (display only)
        → encrypts the token and writes the oauth_credentials row
        ← "Google: połączono"
```

Every admin route checks `X-K7-Admin-Token` in constant time — except the
callback, because Google's redirect cannot carry that header. The `state` is what
authorises the callback instead: only a request that started at the guarded
`auth/start` can finish there. The redirect URI is built from `K7_HOSTNAME`,
never from the incoming `Host` header.

The token pasted into `localStorage` only decides whether the panel draws its
buttons. Anyone can edit their own `localStorage`; the server-side check is the
part that protects anything.

### Precedence, and why

Resolution order is **database row → `GOOGLE_OAUTH_REFRESH_TOKEN` → nothing
(mock events)**. The database has to win: under the opposite rule, connecting
through the browser would succeed, report success, and change nothing, because a
stale environment variable would keep being used. The boot line says which
source is live (`google_refresh=db|env|unset`), and so does `/admin`.

*[ ROZŁĄCZ ]* deletes the row and asks Google to revoke the token. If
`GOOGLE_OAUTH_REFRESH_TOKEN` is still set it takes over again at once — provided
it was minted against the same client (step 2).

### What the encryption is and is not

The stored token is encrypted with a key derived from `K7_SECRET_KEY`. That
protects a database file that leaks **on its own** — a backup copied off the
box, a `data/` directory handed to someone for debugging. It does **not**
protect against an attacker with shell access on the host, because the key is in
`.env.local` on that same host, exactly where the plaintext token lives today.

The key is not host-derived on purpose: a machine-id-based key defends the same
threat but breaks silently on a restore or a hardware change, with a re-auth
nobody expects as the only way out.

### Telling the states apart

| What you see | What it means |
|---|---|
| `/admin` shows the **kitchen dashboard**, not the panel | the panel is off — `admin` or `secret_key` is `unset` in the boot line. Unknown paths fall back to the dashboard shell, so a disabled panel looks like any other unknown URL |
| the panel loads but says *Token odrzucony* | the panel is on; the token in this browser's `localStorage` is wrong. Press *[ ZAPOMNIJ TOKEN ]* and paste it again |
| *[ POŁĄCZ KONTO ]* is greyed out | client id/secret or `K7_HOSTNAME` is missing — the panel's status line says so |
| Google shows `redirect_uri_mismatch` | the URI registered in step 1 differs from the one the panel prints — usually the port |
| status *NIEPOŁĄCZONE* with *nie da się odszyfrować* | `K7_SECRET_KEY` changed or was lost. The row is deliberately *not* skipped in favour of the env var, which would hide the misconfiguration. Restore the old key, or disconnect and connect again |
| calendar stale, then erroring, right after switching clients | step 2: the env-var token belongs to the old client. Finish step 5 |

## Failure modes worth knowing

- **`invalid_grant` after about a week** — the token was minted while the
  consent screen was still in *Testing*. Publish the app and mint a new one.
- **`invalid_grant` out of nowhere** — the account's password changed, or the
  app's access was revoked at <https://myaccount.google.com/permissions>.
  Re-run step 3.
- **No `refresh_token` in the response** — `access_type=offline` was missing,
  or Google had already issued one for this client and account. Re-run with
  `prompt=consent`.
- **Calendar card shows mock events** — the server sees no credentials. That
  is the designed fallback, not an error; check the server's boot line and
  `.env.local`.
