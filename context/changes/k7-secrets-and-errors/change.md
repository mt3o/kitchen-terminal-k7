# k7-secrets-and-errors

```yaml
change_id: k7-secrets-and-errors
memory_goal: 3d1ec55c-f161-4684-a999-5d485a0e6bf8
change_anchor: 998475a7-56e8-40b5-bf27-1325fecfd34e
parent:
  - f6891e4a-1a43-4d86-925c-cc0ef0b218d7   # k7-walking-skeleton
  - 59472cdc-4531-4206-a9fc-968166c52250   # foundation
epic: faza-0
slice: 2
mode: headless
tracker: github
branch: change/k7-secrets-and-errors
```

## What this delivers

The `SECRETS` constraint, turned from a sentence into something a machine checks.

- **`.env.schema`** — the Varlock schema: three secrets (`KILO_GATEWAY_KEY`,
  `GOOGLE_OAUTH_REFRESH_TOKEN`, `GLITCHTIP_DSN`) marked `@sensitive`, two public
  settings with defaults. Committed, readable by agents, holds no values.
- **`.env.example`** — obviously-fake placeholders. `.env.local` is gitignored.
- **`src/server/config.ts`** — the only place that reads `process.env`, so there
  is one list of what counts as a secret rather than two that drift.
- **`src/server/redact.ts`** — two-layer scrubbing, exact values plus credential
  shapes.
- **`src/server/observability.ts`** — GlitchTip via the Sentry SDK, with the
  scrubber wired into `beforeSend` and `beforeBreadcrumb` rather than at call
  sites, because a rule enforced at call sites lasts until the first busy
  afternoon.
- **9 tests** and a CI step that runs them.

## Verified

| | |
|---|---|
| `npm run check` (lint, tokens, tests, build) | exit 0 |
| Tests | 9/9 |
| Boot with real-shaped secrets | log reads `kilo_key=set`, never a value |
| Secrets in any log line or response body | none |
| `/api/health` | reports `reporting: true` when a DSN is set |

The load-bearing test drives the **real Sentry client** through a transport that
captures the envelope on its way out, and asserts on the bytes that would have
reached GlitchTip. A unit test of the scrubber would prove the function works, not
that it is wired in — and a redactor that is never called is worse than none,
because it makes everyone confident.

It also asserts the error message *survives*. A redactor that passes by destroying
the evidence has not passed.

## The test found a real hole

The URL-credential pattern was written `https?://`, so `postgres://user:hunter2@db`
went straight through — a database URL is exactly the kind of string that ends up
in a crash report. Widened to any scheme.

## Node 24 is now the floor

Was `>=22`. Type stripping is stable on 24 and needs no flag; on 22 every script
carries `--experimental-strip-types`, which interacts badly with the test runner's
argument ordering and fails reporting a *missing module* rather than a missing
flag. CI and the LAN machine both run 24.

## Not done

- **Varlock is not yet in the runtime path.** The schema is authoritative and the
  CLI validates it, but the server still reads `process.env` directly rather than
  booting under `varlock run`. That wiring is its own decision — it changes how the
  service is started — and it belongs with the deployment slice, not here.
- No GlitchTip instance has actually received an event. The envelope is asserted at
  the transport boundary, which proves the payload; it does not prove the DSN.
