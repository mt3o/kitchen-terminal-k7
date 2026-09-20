# Getting the Google Calendar OAuth2 refresh token

This project reads Google Calendar with a **long-lived refresh token pasted
into `.env.local` by hand**. There is no consent-flow UI in the codebase and
there is not going to be one: the household owns the calendar, the token is
minted once, and `src/server/upstream/google-calendar.ts` only ever exchanges
it for short-lived access tokens (`https://oauth2.googleapis.com/token`) and
calls `events.list`.

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
