# k7-google-oauth-connect

status: planned
created: 2026-09-20
memory_goal: UNASSIGNED — see memory-backlog.md
change_anchor: UNASSIGNED — see memory-backlog.md

## Goal
Let the household connect (and disconnect) the Google Calendar account from a
browser instead of pasting a refresh token into `.env.local` by hand: an
admin-guarded consent flow whose resulting refresh token is stored encrypted in
the application database, taking precedence over the environment variable when
present.

## Why now
The manual procedure is documented (`docs/google-calendar-oauth.md`, PR #61) and
works, but it requires shell access to the deployed host to redo. The LAN TLS
work gave this project a real hostname and a valid certificate, which is what a
registrable OAuth redirect URI needs — the blocker that made a consent flow
impractical is gone.

## Reverses a recorded decision
`[node:ab43353e]` ("Google bounded to refresh-token + API client, no consent-flow
UI") is the settled constraint this change overturns, and the doc comment at the
top of `src/server/upstream/google-calendar.ts` states it in prose. The
constraint is not being declared wrong: the *reason* it held — no registrable
redirect URI, and no authenticated surface on an open kiosk — has changed on
both counts. Recorded as a contradiction for human review, not resolved here.
