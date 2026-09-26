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


## Epic: k7-recipe-widget-upgrade

**Outcome:** the recipe widget keeps a record of failed add/import attempts so
they can be fixed and retried, tracks and exposes the recipe's source, carries a
free-text description, scales past a handful of saved recipes with an infinite
list, and can be searched by title/tags/ingredients/steps/description/url with
tags also usable as an explicit filter.

| # | slice | mode | blocked by | delivers |
|---|---|---|---|---|
| 1 | `k7-recipe-description-field` | interactive | — | free-text `description` field: domain type, markdown format, API, review form, detail view |
| 2 | `k7-recipe-source-editable` | interactive | — | source URL clickable in the detail view, editable in the review form |
| 3 | `k7-recipe-rejection-log` | interactive | — | failed add/import attempts (validation rejections, import errors) logged and listable, with a retry action that reopens the review form pre-filled |
| 4 | `k7-recipe-auto-tags` | headless | 1 | empty tags at save time trigger a model call, prompted from title/ingredients/steps/description, to generate them |
| 5 | `k7-recipe-list-all` | interactive | — | widget shows every saved recipe's title instead of the `maxVisible`-capped fetch; full detail fetched only on open |
| 6 | `k7-recipe-infinite-scroll` | interactive | 5 | the all-titles list becomes cursor-paginated, loading more as the household scrolls |
| 7 | `k7-recipe-search-fulltext` | interactive | 1, 6 | search box over title/tags/ingredients/steps/description/url, ranked in that priority order |
| 8 | `k7-recipe-search-tag-filter` | interactive | 7 | tags usable as an explicit filter facet layered on top of full-text search |

**Why this order.** Description (1) has to exist before anything searches it
(7) or feeds it to the tagging prompt (4). The list has to stop being
capped (5) before it can be paginated (6), and paginated before search (7)
extends the same endpoint with a query — searching a capped list would have
meant redoing the endpoint contract twice. Tag-filtering (8) sits on top of
working full-text search (7) rather than beside it, since both live in the
same search box. Source-editing (2) and the rejection log (3) touch the
review/detail views but not the list-fetching path, so neither blocks or is
blocked by anything else here.

**Modes.** Only slice 4 is headless: a bounded backend behavior change (empty
tags → model call → populate) with no new UI surface, verifiable with a
mocked gateway client. Every other slice changes what the household sees or
can do in the widget, so all of them run interactive.

**Deliberately not in this epic:** bulk-retry of multiple failed attempts at
once (slice 3 covers one-at-a-time retry only), and any change to how the
recipe *collection itself* is stored (still one Markdown file per recipe —
see `src/server/adapters/files/recipes.ts`) — search and pagination are
built as a read-time concern over that same store, not a reason to replace
it.
