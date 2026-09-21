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

Two environment variables switch this on. Without either one, `/admin` and its
API routes answer as though they do not exist — which is the point: a
deployment that has not opted in has no credential-granting surface on an
unauthenticated kitchen LAN.

```
K7_ADMIN_TOKEN=...      # openssl rand -base64 32
K7_SECRET_KEY=...       # openssl rand -base64 32, exactly 32 bytes
```

`K7_ADMIN_TOKEN` guards every admin route; `K7_SECRET_KEY` encrypts the stored
refresh token (AES-256-GCM). A missing key means the flow is **off** rather than
a token written to the database in the clear.

### Setup

1. **Create a Web application OAuth client.** The Desktop-app client from §2
   cannot register an `https://` redirect, so this needs a second client:
   Cloud Console → Credentials → Create credentials → OAuth client ID → **Web
   application**. Register exactly:

   ```
   https://<K7_HOSTNAME>/api/admin/google/callback
   ```

   (with the port, if the kiosk does not serve on 443 — `/admin` shows the exact
   URI the server will send, which is the one to paste). Put this client's id and
   secret in `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.

2. **Set the two variables above** in `.env.local` and restart. The boot line
   reports `admin=set secret_key=set`.

3. **Open `https://<K7_HOSTNAME>/admin` on a laptop**, paste the admin token
   once (it is kept in that browser's `localStorage`), and press
   *[ POŁĄCZ KONTO ]*. Consent as the calendar's owner; Google returns to the
   callback, which stores the token and says which account was connected.

Do this on a laptop, not on the kitchen iPad — Safari 15 in kiosk mode is not
where anyone wants to type a Google password.

### Precedence, and why

Resolution order is **database row → `GOOGLE_OAUTH_REFRESH_TOKEN` → nothing
(mock events)**. The database has to win: under the opposite rule, connecting
through the browser would succeed, report success, and change nothing, because a
stale environment variable would keep being used. The boot line says which
source is live (`google_refresh=db|env|unset`), and so does `/admin`.

*[ ROZŁĄCZ ]* deletes the row and asks Google to revoke the token. If
`GOOGLE_OAUTH_REFRESH_TOKEN` is still set, it takes over again immediately —
which is what makes the manual path a genuine fallback rather than a leftover.

### What the encryption is and is not

The stored token is encrypted with a key derived from `K7_SECRET_KEY`. That
protects a database file that leaks **on its own** — a backup copied off the
box, a `data/` directory handed to someone for debugging. It does **not**
protect against an attacker with shell access on the host, because the key is in
`.env.local` on that same host, exactly where the plaintext token lives today.

The key is not host-derived on purpose: a machine-id-based key defends the same
threat but breaks silently on a restore or a hardware change, with a re-auth
nobody expects as the only way out.

### If a stored credential stops working

- **`/admin` says the credential cannot be decrypted** — `K7_SECRET_KEY` changed
  or was lost. The row is deliberately *not* ignored in favour of the
  environment variable, because that would hide the misconfiguration. Disconnect
  and connect again, or restore the old key.
- **The panel 404s with a token you believe is right** — a wrong token and a
  disabled panel answer identically by design. Check the boot line for
  `admin=set`.

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
