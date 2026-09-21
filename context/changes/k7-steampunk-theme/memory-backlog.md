# Memory backlog — k7-steampunk-theme

Degraded mode per CLAUDE.md: `agentic-memory-mcp` failed to connect (ENOENT) and
the `agentic-memory` CLI is not on PATH — the store is unreachable by both
transports. Queued here for replay.

## Would-be create_change
- change_id: k7-steampunk-theme
- goal: "A steampunk theme: script title face, background pictures, decorative
  borders — plus the optional theme-contract slots it needs."
- parent: foundation goal 59472cdc-4531-4206-a9fc-968166c52250

## Would-be recall_context (at change start)
- "theme loader tokens generated theme.css swap" (goal_ref: this change)
- "design system typography one family display face"
- "Safari 15 border-image backdrop-filter composite A8X"

## Would-be captures (each ABOUT the `Theme` entity)

1. **Decision** — Theme files (fonts, pictures, ornaments) are served by a
   dedicated `/theme-assets/*` route that serves only the paths the active theme
   names (`themeAssetPaths`), each URL carrying a content-hash `?v=`; immutable
   caching only when `v` matches the current bytes.
   Alternatives rejected: (a) data: URIs inlined into `/theme.css` — offline by
   construction, but `/theme.css` is `no-cache` and regenerated per request, so
   ~500 KB would travel on every load; (b) copying assets into `public/` — splits
   a theme across two directories and ties a server-side swap to a rebuild.
   Facets: architecture, theming, security, caching.

2. **Decision** — `ornament` slots are raw CSS strings (with `asset("path")`
   rewritten by the generator), not structured YAML like the v1 `background`
   block. The structured form could not express px-stopped gradient bands (for
   header/footer text legibility over a photo at any `cover` crop) or a
   `border-image` shorthand, and was not mode-aware.
   Facets: theming, schema.

3. **Invariant** — Every optional theme slot's default is the exact value the
   components used before it existed (titles = HUD label tokens, `--page-bg` =
   `--bg`, `--card-bg` = `--surface`, frame/rule `none`, `--font-mono` =
   `var(--font-ui)`), so an undecorated theme renders pixel-identically. Checked
   by screenshot diff and asserted in test/theme.test.ts.
   Facets: theming, contract.

4. **Decision** — Titles are authored uppercase in components
   (`LOG.WYDARZENIA`); a script face is unreadable in capitals. Themes set
   `display.case: lowercase` and every title rule adds `::first-letter {
   text-transform: uppercase }` (a no-op for uppercase themes), instead of
   rewriting every label to natural case across ~15 components.
   Facets: theming, typography, i18n-copy.

5. **Issue** — Inside each widget's shadow root `box-sizing` is `content-box`
   (app.css's `border-box` rule does not cross the boundary), so every card is
   cell height + 2×padding + 2×border and its bottom edge is clipped by
   `.page > * { overflow: hidden }`. All themes. Measured: 345px card in a 293px
   cell. Spun off as its own task.
   Facets: layout, shadow-dom, bug.

6. **Issue** — daylight-lab's `borderStrong` fails 3:1 in dark (2.26) and night
   (1.90); its comment measured light only. Named known exception in
   test/theme.test.ts's AA suite.
   Facets: theming, accessibility, bug.

7. **Decision** — Backdrop rotation is chosen on the client from the local
   clock (interval from local midnight, `backdropEveryMinutes`), not by the
   server per request: the kiosk is a PWA that stays open for days and loads
   `/theme.css` once, so a server-side pick would change only on reload. The
   generator emits every variant as a `[data-backdrop="n"]` rule; the client
   finds the next variant's URLs by computing `--page-bg` on a detached probe
   element carrying the same attributes (so it never hard-codes a path), decodes
   them, then flips the attribute. Clock-based rather than per-load random so
   every screen agrees and a reload does not change the picture.
   Alternatives rejected: per-page backdrops (pictures inside the transformed
   pager track — more layer memory on the A8X, and the gaps show little of
   each); a CSS transition between backdrops (background repaint every frame).
   Facets: theming, client, performance.

## Would-be journal events (end of session)
- USED: `Theme` domain entity (proposed) as the ABOUT target for all captures.
- CONFIRMED: the theming contract (TOKENCONTRACT) — a third theme with a new
  face, pictures and frames swapped in by pointing `theme:` elsewhere, no
  restart, no component naming a value.
- NOTED: `layout.local.yaml` overrides plain top-level keys such as `theme:`
  (config-layers deep merge), though layout.local.yaml.example previously said
  only `calendarAdditions` was supported — example updated.
- NOTED: `typography.fontSourceWoff2` in retro-scifi.yaml was never emitted;
  the kiosk has been rendering the system monospace, not Source Code Pro.
