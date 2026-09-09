# Roadmap — epic registry

Read by `/gw-new`, `/gw-slice`, `/gw-implement` and `/gw-archive`. Slice lists live
here because they change as reality arrives; *why* the order is what it is lives in
the graph.

## Epic: faza-0

**Outcome:** the project scaffolds, builds for Safari 15, serves itself from the LAN
machine, and can be opened on the iPad — with the design system's own tokens on
screen and CI enforcing the rules the graph already settled.

| # | slice | mode | blocked by | delivers |
|---|---|---|---|---|
| 1 | `k7-walking-skeleton` | interactive | — | ✅ repo, Safari-15 target, Fastify serving `<k7-card>` from `layout.yaml` in real tokens, green CI |
| 2 | `k7-secrets-and-errors` | headless | 1 | ✅ Varlock schema, GlitchTip, scrubbing proven on the wire |
| 3 | `k7-persistence` | interactive | 1 | ✅ Drizzle over SQLite behind repository ports, five tables, boot-time migrations |
| 4 | `k7-storybook` | headless | 1 | ✅ Storybook on the web-components renderer, three luminance modes |
| 5 | `k7-lan-tls` | interactive | 1 | ✅ real certificate via DNS-01, Fastify on HTTPS — **live and trusted** at `https://k7.revert-h0m3.co.pl:8443/` |
| 6 | `k7-backend-freshness` | headless | 3 | ✅ last-good responses cached in SQLite and served with their age; Open-Meteo wired |
| 7 | `k7-offline-shell` | interactive | 5, 6 | Service Worker for the shell, plus the reconnect scrim over the blurred stale grid — **unblocked: the secure context is confirmed live** |

**The order changed on 2026-09-08, and the reason is worth keeping.** The original
list had `k7-offline-shell` as slice 5 blocked only on slice 1, with HTTPS sitting in
Faza 6 — five phases later. That is backwards: a Service Worker requires a secure
context, and a LAN IP over plain HTTP is not one, so `navigator.serviceWorker` is
undefined and there is nothing to configure. Measured, not assumed. TLS was therefore
promoted into this epic as slice 5, and the offline work split in two: the freshness
policy that does **not** need a certificate (slice 6, in the backend) and the shell
cache that does (slice 7).

**Modes are a check, not an opinion.** Slices 3, 5 and 7 each turn on an
architectural decision or put a surface on screen, so none can run unattended.
Slices 2, 4 and 6 are verifiable by command with no surface and no argument.

**Deliberately not in this epic:** the theme *loader* (Faza 1 — slice 1 links
`tokens.css` directly rather than generating it), and the thirteen unimplemented card
types.

**Open input needed for slice 5:** which domain and DNS provider. The DNS-01 challenge
needs API access to the zone; everything else about that slice is decided.


## Epic: faza-1

**Outcome:** the design is genuinely swappable and the cards that exist have
stories, so the token contract stops being a claim and becomes something a
command demonstrates.

| # | slice | mode | blocked by | delivers |
|---|---|---|---|---|
| 1 | `k7-theme-loader` | interactive | — | the server reads the theme file `layout.yaml` names, generates the custom properties, and serves them; the client stops importing `tokens.css` directly |
| 2 | `k7-calendar-week` | headless | 1 | the week view against mocked events — no OAuth, so it is buildable today |
| 3 | `k7-component-stories` | headless | 1 | stories for weather, timer, shopping list and audiometer |

**Why this order.** The loader changes how every component receives its values,
so building more components first means building them twice. It is also the only
slice that turns an existing lifetime constraint from a claim into a
demonstration: `daylight-lab.yaml` was written to prove the swap works and has
never once been loaded.

Weather and the timer are already built — Faza 1 lists them, and they landed
early because the backend was ready before the loader was.

**Not in this epic:** anything needing OAuth2, the Kilo Gateway or the recipe
importer. Those are Faza 2-4 and their integrations do not exist.
