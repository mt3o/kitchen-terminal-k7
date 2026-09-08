# Kitchen Terminal K7

A retro-futurist kitchen dashboard that runs as a fullscreen PWA kiosk on a
wall-mounted iPad Air 2 (iOS 15 / Safari 15). A Node/TypeScript backend on a
machine in the same home LAN serves the built client and a `layout.yaml`-driven
screen config. There is no cloud component — the iPad and the server share a
network, so nothing is exposed to the internet.

## Requirements

| What | Version |
|---|---|
| Node.js | >= 22 (the server runs TypeScript directly via `--experimental-strip-types`, no separate compile step at runtime) |
| npm | whatever ships with Node 22 |
| Target browser | Safari 15.0 (iPad Air 2 / A8X, iPhone 6s) — this is a hard compile floor, not an aspiration |

## Quick start

```bash
npm install
```

### Development (frontend only)

```bash
npm run dev
```

Runs Vite on `http://localhost:5173` with hot reload for the Svelte client.
**This does not serve `/api/layout`.** There is no Fastify process behind port
5173 and no proxy configured for `/api/*` in `vite.config.ts`, so the client's
`fetch('/api/layout')` call fails while running `dev` alone — the shell renders
and shows `STATUS: BLAD` (error) instead of a populated deck. Use `dev` for
iterating on markup/CSS/component structure, not for seeing real layout data.

### Production build + serve (the path that works end to end)

```bash
npm run serve
```

This runs `npm run build` (`tsc --noEmit` + `vite build` into `dist/client`)
followed by `npm start`, which boots the Fastify server. Fastify serves the
built client as static files, answers `/api/layout` and `/api/health`, and
falls back to `index.html` for any unknown path (so the kiosk shell never hits
a bare 404). This is the only command that gives you a fully working page today.

If you only change `layout.yaml`, you do **not** need to rebuild or restart —
the server re-reads it from disk on every request to `/api/layout`. A rebuild
is only needed when client or server source changes.

Server environment variables (see `src/server/index.ts`):

| Variable | Default | Purpose |
|---|---|---|
| `K7_PORT` | `8080` | HTTP port |
| `K7_HOST` | `0.0.0.0` | Bind address — `0.0.0.0` on purpose, so the iPad can reach it over the LAN |

Other useful scripts:

| Script | What |
|---|---|
| `npm run build` | Type-check + build the client into `dist/client` |
| `npm run lint` | ESLint |
| `npm run lint:tokens` | `scripts/check-token-contract.py` — fails if a component hardcodes a colour instead of using a design token |
| `npm run check` | lint + lint:tokens + build, in that order |

## Putting it on the iPad

1. Start the server on the LAN machine: `npm run serve` (or `npm start` after a
   `npm run build`, if you want to rebuild and start separately).
2. Find that machine's LAN IP address, e.g. `hostname -I` on Linux, or check
   your router's client list. It's whatever address the machine has on the same
   Wi-Fi/Ethernet segment as the iPad.
3. On the iPad, open **Safari** and go to `http://<lan-ip>:8080` (or whatever
   `K7_PORT` you set).
4. Tap the Share icon → **Add to Home Screen**. This gives you a standalone,
   chrome-free app icon (the manifest sets `display: standalone` and
   `orientation: landscape`).
5. Launch from the home screen icon, not from Safari directly — the standalone
   mode hides the address bar and matches the kiosk intent.
6. Go to **Settings → Display & Brightness → Auto-Lock** and set it to
   **Never**. A kiosk that locks itself is not a kiosk.

### Known limitation: no HTTPS on the LAN yet

This setup serves plain HTTP. Getting HTTPS working for a self-hosted LAN
service on Safari 15 is unresolved (self-signed certs are painful to trust on
old iPadOS, and mixed content rules bite if any resource assumes HTTPS). This
is flagged as an open problem in `docs/handoff/HANDOFF.md`, not something this
README papers over. Until it's solved, treat this as a LAN-only, unencrypted
deployment — fine for a home network, not for anything exposed further.

## Configuring the screen via `layout.yaml`

`layout.yaml` at the project root is the whole screen definition: grid shape,
theme, and the list of cards. The server re-reads it per request (see above),
so edits are live — reload the iPad page (or wait for the client to re-fetch)
to see a change.

```yaml
version: 1
theme: "design-system/themes/retro-scifi.yaml"
grid:
  columns: 3
  gap: "12px"
cards:
  - id: zegar
    type: clock
    span: { cols: 1, rows: 1 }
    params: { format: "24h", showDate: true, showSeconds: false, locale: "pl-PL" }
```

Card types currently named by the client (`src/client/main.ts`): `clock`,
`weather`, `calendar`, `shopping-list`, `timer`, `chat`, `recipes`,
`comic-of-the-day`, `ascii-art-of-the-day`, `carousel`, `grid`, `slideshow`,
`menu`, `audiometer`. As of now only `clock` renders real content; every other
type shows as a declared, idle slot (`[--] oczekuje na implementacje`) rather
than pretending to have data. The full contract for what each card type's
`params` accepts lives in `docs/handoff/layout.schema.yaml`, with a worked
example in `docs/handoff/layout.example.yaml`.

Point `theme:` at a different file under `design-system/themes/` (currently
`retro-scifi.yaml` and `daylight-lab.yaml`) to swap the entire visual design —
see below.

## Design system and the token contract

Components read **only** CSS custom properties (`var(--*)`) generated from the
active theme file. Nothing in a component hardcodes a colour, font, radius,
border width, or shadow — swapping `layout.yaml`'s `theme:` must be the only
thing needed to reskin the app. `npm run lint:tokens` enforces this by
grepping for raw hex/`rgb()` values in component source.

Read `design-system/USAGE.md` for the full picture; in short:

- `design-system/DESIGN.md` — intent, the amber-is-ink/teal-is-signal rule,
  contrast derivation, the Safari 15 CSS budget (no `color-mix()`, `oklch()`,
  `@container`, `:has()`, `subgrid`, `dvh` — all past the Safari 15.0 baseline).
- `design-system/tokens.css` — the token sheet, imported before any component
  CSS (see `src/client/main.ts`).
- `design-system/kitchen-terminal-k7-kit.html` — the normative component spec;
  it wins over prose when they disagree.
- `design-system/theme.schema.v2.yaml` — the schema the theme loader validates
  against.
- `design-system/themes/*.yaml` — theme instances (`retro-scifi.yaml` is the
  default; `daylight-lab.yaml` is a deliberate stress test — light, rounded,
  cool blue, no HUD frame).

Note: `docs/handoff/theme.schema.yaml` is an earlier/reference copy from the
handoff docs; the schema the app actually loads against is
`design-system/theme.schema.v2.yaml`. Follow the design-system copy.

## Project layout

```
layout.yaml                  screen config (grid, theme, cards)
src/
  server/index.ts            Fastify server: /api/layout, /api/health, static + SPA fallback
  client/                    Svelte 5 client (compiled to custom elements)
    main.ts                  fetches /api/layout, renders <k7-card> per card
    lib/K7Card.svelte
  shared/layout.ts            shared Layout/Card types
design-system/                tokens, theme schema, theme instances, component kit
docs/handoff/                 planning docs (Polish), wireframes, layout/theme schema reference
context/                      graph-workflow change lifecycle (see context/README.md)
scripts/check-token-contract.py   token-contract lint
public/                       PWA manifest, icons
```

## Contributing

- `main` is the only long-lived branch; nothing is pushed to it directly.
- One branch per unit of work: `change/<change-id>` for a graph-workflow
  change, `fix/<slug>` for a bug/regression, `foundation/<slug>` for a
  foundation-doc amendment.
- Every branch reaches `main` through a pull request.
- **Merge commit only.** Squash merging and rebase merging are off. Per-phase
  commits are the readable record of a change; don't collapse them.
- Commit messages: English, imperative, one concern per commit.

Full detail: `context/foundation/git-workflow.md`.

## Where the docs live

| Doc | Contents |
|---|---|
| `docs/handoff/HANDOFF.md` | context, decision log, deferred ideas (Polish) — read first for background |
| `docs/handoff/PLAN.md` | phased build plan |
| `docs/handoff/TECH-STACK.md` | stack choices and open caveats (Polish) |
| `docs/handoff/layout.schema.yaml` | the layout contract (card types, containers) |
| `docs/handoff/theme.schema.yaml` | reference copy of the theme contract — see `design-system/theme.schema.v2.yaml` for the one actually loaded |
| `docs/handoff/*.html` | standalone wireframes, open directly in a browser |
| `design-system/USAGE.md` | design system read order and token rules |
| `context/foundation/git-workflow.md` | branching, PR, and merge policy |
| `context/foundation/tracker.md` | issue-tracker binding |
| `context/README.md` | how the graph-workflow change lifecycle works in this repo |

Foundation docs (`docs/handoff/`, `context/foundation/`) stay in Polish per
project convention; this README, code, and commit messages are English.
