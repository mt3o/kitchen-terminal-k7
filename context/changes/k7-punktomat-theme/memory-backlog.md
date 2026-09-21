# Memory backlog — k7-punktomat-theme

Degraded mode per CLAUDE.md: `agentic-memory-mcp` ENOENT and the
`agentic-memory` CLI is not on PATH — the store is unreachable by both
transports. Queued for replay.

## Would-be create_change
- change_id: k7-punktomat-theme; parent: foundation goal
  59472cdc-4531-4206-a9fc-968166c52250; related: k7-steampunk-theme.

## Would-be captures (ABOUT the `Theme` entity)

1. **Decision** — Card outline is its own optional role (`colors.cardBorder`
   → `--card-border`, default borderStrong) rather than lowering
   borderStrong: borderStrong also outlines buttons, active tabs and focused
   inputs (Timer, Carousel, Menu, Chat, Calendar) and must reach 3:1, while a
   cork-board theme sets cards apart by their fill. Rejected: a solid-colour
   `border-image` for cards (ignores border-radius — square border round a
   rounded fill). Facets: theming, accessibility.

2. **Decision** — The header band's ink is a scoped palette: the generator
   emits `header.colors` as custom properties on `[data-region="header"]`
   (dark unqualified, light/night qualified by `[data-mode]`), so every
   token-reading component inside the header follows without code changes.
   Rejected: per-element header colour tokens. The pull-to-refresh tab lives
   inside the header and inherits it, so `surfaceRaised` is part of the header
   palette. Facets: theming, architecture.

3. **Constraint** — Header ink must reach 4.5:1 against every colour stop of
   the band's gradient, not its average: the status text sits at the lighter
   right-hand end. Enforced in test/theme.test.ts for every theme with a band.
   Facets: accessibility, theming.

## Would-be journal events
- USED: the ornament/asset slots from k7-steampunk-theme (second consumer).
- CONFIRMED: TOKENCONTRACT — a fourth theme with a header band and a new card
  outline, no component naming a value.
