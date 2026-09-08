# k7-walking-skeleton

```yaml
change_id: k7-walking-skeleton
memory_goal: f6891e4a-1a43-4d86-925c-cc0ef0b218d7
change_anchor: 73716ffb-625f-4745-9032-65658cd2e691
parent: 59472cdc-4531-4206-a9fc-968166c52250   # foundation
epic: faza-0
slice: 1
mode: interactive
tracker: github
branch: change/k7-walking-skeleton
```

## What this delivers

A thin vertical path through every layer, so everything after it hangs off a thing
that already runs: build target → server → custom element → real tokens → CI.

- **Build** — Vite 8 + Svelte 5, `build.target: ['safari15','es2021']`, `cssTarget:
  safari15`. TypeScript pinned to 6.0.3 (see below).
- **Server** — Fastify 5 on `0.0.0.0:8080`, serving `dist/client`, `GET /api/health`
  and `GET /api/layout`. The Layout is read per request, so editing `layout.yaml`
  needs no restart. Unknown paths fall back to the shell — a home-screen kiosk must
  never strand someone on a 404 with no way back.
- **Client** — `<k7-card>` as a real custom element, one Card per `layout.yaml`
  entry. `clock` renders live; the other five declare themselves `[--]` rather than
  spinning forever.
- **CI** — lint, the token-contract check, typecheck and build, on push and PR.

## Verified, not assumed

| | |
|---|---|
| `npm ci` on a wiped tree | exit 0, 243 packages |
| `npm run check` | exit 0 — ESLint clean, 10/10 contract rules, build green |
| `/api/health`, `/api/layout`, `/`, `/manifest.webmanifest`, SPA fallback | all 200 |
| Rendered headlessly at 1024×768 | 6 cards, live clock, `STATUS: ONLINE` |

## Three things the green build was hiding

1. **The custom element was never registered.** `vite-plugin-svelte` resolves
   `svelte.config.js` against the *Vite root* (`src/client`), not the project root,
   so `customElement: true` was silently dropped and `<k7-card>` never defined. The
   build stayed green and the screen would have been blank. The config file is now
   passed explicitly.
2. **`tsc` was pointed at `.svelte` files**, which it cannot parse. `svelte-check`
   does that job; the tsconfig `include` was wrong.
3. **The shell did not contain the deck.** `min-height: 100vh` let the cards push
   the footer — and the status line, the one thing that says whether the terminal is
   alive — off the bottom of a 768px screen. Only visible in a screenshot; the DOM
   dump looked perfect.

## TypeScript is pinned to 6, deliberately

7 is GA at 7.0.2, but `typescript-eslint@8` peers `<6.1.0` and *throws at import*
rather than warning, and `svelte-check` peers `^5 || ^6`. 6.0.3 is what the whole
toolchain accepts. `--legacy-peer-deps` would have bought a lint setup that loads a
parser its own dependency rejects.

## Left for later, on purpose

- Five of six card types are declared and idle. Implementing them is Faza 1+.
- The **theme loader** is Faza 1: `tokens.css` is linked directly rather than
  generated from `layout.yaml`'s `theme:`. The indirection exists in the config and
  is not yet honoured — the token contract holds either way, and CI proves it.
- **HTTPS on the LAN** is untouched and still the open question `HANDOFF.md` flags.
- **Not verified on the real iPad.** Everything here is a headless Chrome at the
  right viewport, which is not the same as Safari 15 on an A8X.
