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
| 1 | `k7-walking-skeleton` | interactive | — | repo, Safari-15 build target, Fastify serving a Svelte custom element that renders Cards from `layout.yaml` in the real tokens, green CI including the hardcoded-colour grep. Openable on the iPad. |
| 2 | `k7-secrets-and-errors` | headless | 1 | Varlock `.env.schema` + GlitchTip init; a deliberate test error proves the trace arrives and the secret does not |
| 3 | `k7-persistence` | interactive | 1 | the SQLite access-layer decision, the five tables, migrations, one repository port with a working adapter |
| 4 | `k7-storybook` | headless | 1 | Storybook build and the first component story |
| 5 | `k7-offline-shell` | interactive | 1 | the Service Worker strategy decision plus app-shell offline caching, proven by pulling the network |

**Modes are a check, not an opinion.** Slice 1 puts a UI surface on screen and slices
3 and 5 each turn on an architectural decision with real alternatives — all three will
want `/gw-grill`, which is never headless. Slices 2 and 4 are verifiable by command
with no surface and no argument, so they are genuinely headless.

**Deliberately not in this epic:** the theme *loader* (Faza 1 — slice 1 links
`tokens.css` directly rather than generating it), and dynamic-data caching, which
`SWCACHE` says cannot be decided until the invalidation strategy is designed.
