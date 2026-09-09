# Plan — k7-image-widgets

Recall used: `[node:e24b75ab]` (comic vs ascii-art split), `[node:822d1381]` +
`[node:8f453152]` (freshness/age is the backend's job), `[node:279d73e0]` (Kilo
Gateway addressing/cost logging), `[node:ac006a24]` (secrets server-side only),
`[node:240ae1c0]` (shared Card shell), `[node:79662ce5]`/`[node:61c0030d]`/
`[node:6d6046fc]`/`[node:9b0e63ee]` (theming/contrast/glyph rules), plus the
research-phase captures `[node:e38c12d4]` (Upstream enum gap), `[node:6a05648a]`
(no Kilo Gateway client exists yet), `[node:1dd47195]` (no RSS parser installed).
No `impact_of` trace was needed — nothing here supersedes a recalled decision;
the two enum additions and the new client are purely additive.

`domain_model(status="confirmed")` was checked: neither widget needs a new
entity. Weather — the closest precedent — isn't modelled as an entity either;
both are simple upstream-backed Card params, not things with independent
identity or lifecycle. No `/gw-domain` proposal needed.

## Non-goals

- No shared abstraction between the two widgets beyond the existing
  `fetchThrough`/`UpstreamCacheRepository` — per `[node:e24b75ab]` they stay
  separate services because the legal/content questions differ.
- No real XPath support for `itemSelector` — only CSS selectors via `cheerio`.
  XPath is named in the schema description but a full XPath engine is
  disproportionate for one feed field; flagged for human decision in the PR.
- No touching `layout.yaml`'s card entries beyond what's already declared (both
  cards already exist with placeholder params) — avoids collisions with the two
  sibling branches also editing that file.
- No changes to `src/shared/layout.ts`'s `IMPLEMENTED` set — it's already stale
  (omits weather/timer/shopping-list, which are live) and unused anywhere in the
  codebase; touching it is out of scope and noted as a flag, not fixed here.
- Exact Kilo Gateway request/response shape for art generation is not verified
  against a live gateway (Faza 4 hasn't landed, no reachable gateway in this
  sandbox) — built OpenAI-chat-compatible per the addressing scheme HANDOFF.md
  documents, flagged explicitly for human verification.

## Phase 1 — shared plumbing: cache enum, RSS/HTML deps, Kilo Gateway client

Files: `src/server/domain/types.ts`, `src/server/db/schema.ts`, `drizzle/`
(new migration), `package.json`, `src/server/upstream/kilo-gateway.ts` (new),
`test/upstream-kilo-gateway.test.ts` (new).

1. Add `'rss'` to `Upstream` (`domain/types.ts:65`) and to
   `upstreamCache.upstream`'s enum (`schema.ts:120`). Run `npm run db:generate`
   for the migration; confirm `runMigrations` applies it against `:memory:` in a
   test.
2. Add `rss-parser` (feed parsing, enclosure/media:content support) and
   `cheerio` (CSS-selector image extraction) to `dependencies`.
3. `src/server/upstream/kilo-gateway.ts`, modelled on `open-meteo.ts`'s
   free-function shape:
   - `kiloGatewayBaseUrl()` — `https://api.kilo.ai/api/gateway` per
     `docs/handoff/HANDOFF.md`, overridable via `K7_KILO_GATEWAY_URL` (matches
     `open-meteo.ts`'s `K7_OPEN_METEO_URL` precedent).
   - `generateAsciiArt({ prompt, model, apiKey, seed, maxWidthChars,
     maxHeightLines, timeoutMs })` — `POST {base}/chat/completions`
     (OpenAI-chat-compatible, per the `provider/model-name` addressing and
     `usage.prompt_tokens`/`completion_tokens` HANDOFF.md documents), one user
     message built from the prompt plus width/height constraints, `Authorization:
     Bearer {apiKey}`. Returns `{ art: string, usage: { promptTokens,
     completionTokens }, seed }`. `seed` is generated with `crypto.randomInt`
     when the caller doesn't supply one (the schema's `seed` field is optional,
     "for reproducibility/debugging").
   - Uses `fetchWithTimeout` from `upstream/freshness.ts` for the HTTP call.
   - No cost computation inside the client — that's the caller's job (Phase 2),
     kept out so a client mock doesn't also have to fake a pricing table.
4. Test with an injected `fetch` (constructor param or module-level override
   matching how `freshness.test.ts` injects `now`), asserting request shape and
   response mapping — no live network call.

Verification: `npm run typecheck` clean on the new files; the new test passes
standalone (`node --test test/upstream-kilo-gateway.test.ts`).

## Phase 2 — ascii-art-of-the-day

Files: `src/server/upstream/ascii-art.ts` (new), `src/server/index.ts`
(route), `src/client/lib/K7AsciiArt.svelte` (new), `K7AsciiArt.stories.ts`
(new), `src/client/main.ts` (register + switch case), `test/ascii-art.test.ts`
(new).

1. `ascii-art.ts`: `asciiArtCacheKey({ prompt, model, seed })` (all
   cache-relevant params folded in, per `[node:822d1381]`'s "units are part of
   it" precedent from `weatherCacheKey`); `generateAndRecord(params, repos,
   config)` calls `generateAsciiArt`, then `repos.aiCalls.record({ purpose:
   'ascii-art', model, promptTokens, completionTokens, estimatedCostUsd,
   conversationId: null, messageId: null })`. Cost: best-effort from `GET
   /models` pricing (fetched once, best-effort — if pricing isn't resolvable,
   log `estimatedCostUsd: 0` rather than fail the whole card; the art itself
   is the product, not the cost line).
2. `GET /api/ascii-art` route in `index.ts`, same shape as `/api/weather`:
   query `prompt` (required, 400 if missing), `model` (default
   `kilo-auto/free`), `cacheDurationHours` (default 24 → `freshForSeconds`),
   `seed` (optional passthrough). `fetchThrough({ key: asciiArtCacheKey(...),
   upstream: 'kilo-gateway', freshForSeconds, fetcher: () =>
   generateAndRecord(...), onFallback: warn-log })`. 503 with `{error, detail}`
   on total failure, matching weather's contract exactly — the client's
   `fallbackArt` param covers that case locally.
3. `K7AsciiArt.svelte` (`k7-ascii-art`), modelled directly on
   `K7Weather.svelte`'s `$effect`/`AbortController`/`setInterval` poll loop
   (refresh interval defaults to a full day in seconds, since this is a
   once-a-day generation, not a 15-minute upstream): props `prompt`, `model`,
   `cacheDurationHours`, `maxWidthChars`, `maxHeightLines`, `colorized`,
   `seed`, `fallbackArt`, `label` (default `ASCII.DNIA` — matches `main.ts`'s
   existing `LABELS` entry). Renders the art in a `<pre>` inside `Card`;
   `colorized` toggles `var(--fg)` vs `var(--fg-muted)` (no per-character
   colour engine — the schema param is honoured honestly without inventing
   scope). Meta line shows the seed (`ziarno: {seed}`) for prompt debugging,
   per the task's explicit ask. On persistent failure with no cached art,
   shows `fallbackArt` if given, else the `[X]`/fail state with no fabricated
   content — matches `[node:4a749051]`'s "must not present placeholder data as
   real" rule.
4. Register in `main.ts`: import, `LABELS.ascii-art-of-the-day` already
   present, add a `case 'ascii-art-of-the-day':` branch in `createWidget`
   mapping `params.prompt/model/cacheDurationHours/maxWidthChars/
   maxHeightLines/colorized/seed/fallbackArt` to attributes.
5. `K7AsciiArt.stories.ts` modelled on `K7Card.stories.ts`'s CSF3 shape
   (`import './K7AsciiArt.svelte'` for registration, `component: 'k7-ascii-art'`,
   argTypes for the props, a `Default` story). Storybook has no dev server
   behind `/api/ascii-art`, so the story will render in `fail`/`idle` state
   honestly — same situation `K7Weather` would be in if it had a story; not a
   blocker.
6. `test/ascii-art.test.ts`, styled like `test/freshness.test.ts`: in-memory DB,
   fixed clock, asserts cache-key stability, that a repeated call within
   `cacheDurationHours` hits cache (no second `generateAsciiArt` call), that an
   `aiCalls` row is recorded with `purpose: 'ascii-art'`, and that a provided
   `seed` round-trips into the cached payload unchanged.

Verification: `node --test test/ascii-art.test.ts` green; manual Storybook
render (`npm run storybook`) shows the card registered and controls working.

## Phase 3 — comic-of-the-day

Files: `src/server/upstream/comic-rss.ts` (new), `src/server/index.ts`
(route), `src/client/lib/K7Comic.svelte` (new), `K7Comic.stories.ts` (new),
`src/client/main.ts` (register + switch case), `test/comic-rss.test.ts` (new).

1. `comic-rss.ts`: `comicCacheKey({ rssUrl, itemSelector, filterKeywords })`;
   `fetchComic({ rssUrl, itemSelector, filterKeywords, timeoutMs })`:
   - Fetch raw feed text via `fetchWithTimeout`, parse with `rss-parser`
     (`parseString`, with `customFields.item: ['media:content']` so
     `media:content` survives alongside the built-in `enclosure`).
   - Iterate items in feed order; if `filterKeywords` is non-empty, keep the
     first item whose title or description/content contains any keyword
     (case-insensitive substring match); if empty, take the first item — "the
     latest entry is today's comic".
   - Image extraction, in order: `item.enclosure?.url` →
     `item['media:content']?.$.url` → if `itemSelector` given, load
     `item.content ?? item contentSnippet ?? summary` into `cheerio`, `$(sel)`,
     read `src` off it (or off a descendant `img` if the selector matched a
     container) → otherwise the first `<img src>` found in the entry HTML.
   - Throws (for `fetchThrough` to catch) if no item matches the keywords or no
     image can be extracted from the chosen item — that's a real failure, not
     an empty-shape success.
   - Returns `{ imageUrl, sourceUrl: item.link, title: item.title }`.
2. `GET /api/comic` route: query `rssUrl` (required), `itemSelector?`,
   `filterKeywords` (comma-separated, optional), `cacheDurationHours` (default
   24). Same `fetchThrough`/503 contract as weather and ascii-art. `upstream:
   'rss'` (the new enum value from Phase 1).
3. `K7Comic.svelte` (`k7-comic`): props `rssUrl`, `itemSelector`,
   `filterKeywords`, `cacheDurationHours`, `maxWidthPx`, `linkToSource`,
   `creditText`, `fallbackImageUrl`, `label` (default `KOMIKS.DNIA`, matches
   `main.ts`). Renders `<img>` (native `loading="lazy"`, `alt={title ??
   'komiks dnia'}`) capped at `maxWidthPx` via an inline `style` binding (a
   data-driven layout number, not a design token — doesn't violate the
   token-only rule, which governs colour/font/radius/border/shadow). Below the
   image: `creditText` if given, wrapped in an `<a href={sourceUrl}>` only when
   `linkToSource` is true. On fetch failure, falls back to `fallbackImageUrl`
   if given (rendered plainly, `state=warn`, since it's known-stale content,
   not a lie about freshness) else `fail` state with no image, consistent with
   `[node:4a749051]`.
4. Register in `main.ts` the same way as ascii-art; `LABELS.comic-of-the-day`
   already present.
5. `K7Comic.stories.ts`, same CSF3 shape as above.
6. `test/comic-rss.test.ts`: inline RSS 2.0 and Atom fixture strings (one with
   `<enclosure>`, one with `media:content`, one with neither but an `<img>` in
   `content:encoded` for the `itemSelector` fallback path), asserting: correct
   image chosen per source type, `filterKeywords` picks the right entry and
   skips non-matching ones, a feed with zero matching entries throws (so
   `fetchThrough`'s fallback/503 path is exercised), and `comicCacheKey`
   folds in `rssUrl`/`itemSelector`/`filterKeywords`.

Verification: `node --test test/comic-rss.test.ts` green; Storybook shows the
card registered.

## Phase 4 — gates, docs, PR

1. `npm run check` end to end (lint, token contract, all tests, typecheck,
   build, precache). Fix everything it flags.
2. Tick the Faza 5 checkboxes in `docs/handoff/PLAN.md`.
3. Memory: capture the plan-boundary decisions below; journal usage events;
   write the PR description with the flags listed under Non-goals surfaced
   explicitly for human review (Kilo Gateway wire format unverified, no XPath
   support, `IMPLEMENTED` set left stale).
4. `gh pr create` against `main`. Do not merge, do not run `/gw-review`.

## Captured decisions (plan boundary)

- `[node:6645438f]`: a minimal, first-ever Kilo Gateway client is built here
  rather than waiting for Faza 4, following `open-meteo.ts`'s free-function
  shape and assumed OpenAI-chat-compatible wire format — flagged for
  verification once Faza 4 lands or a real gateway is reachable.
- `[node:136541ad]`: `itemSelector` is implemented as CSS only (via
  `cheerio`), not XPath, despite the schema description naming both — a scope
  call, flagged for human decision (add an XPath engine later if a real feed
  needs it, or narrow the schema field's description to CSS).

## Plan-review finding (non-blocking, flagged forward)

Independent plan review (`/gw-plan-review`) ran `impact_of` on the Kilo
Gateway decision node and found the sibling `change/k7-ai-chat` branch is
independently scoped to build its own Kilo Gateway HTTP client. This plan's
Phase 1 creates `src/server/upstream/kilo-gateway.ts` — both branches will
very likely touch that same new file path, which is a foreseeable merge
collision / duplicated-effort risk rather than a constraint violation. Not a
blocker; flagged in the PR description for human reconciliation at merge
time (keep the file additive/minimal here so a later merge is a rename or a
straight supersession, not a deep conflict).
