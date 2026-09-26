# Plan — k7-recipe-infinite-scroll

memory_goal: e80dff0a-f65d-4e24-a0f4-803f9fbcf347
epic: k7-recipe-widget-upgrade (slice 6 of 8, blocked by 5 — done)

Builds on [node:35b6940f]: the `?view=summary` envelope gains fields, and
nothing about the plain array changes.

## Decisions

- **Keyset cursor, not offset.** The cursor names the last row served, as
  `(importedAt, id)` in the list's own order (newest first, then id). The
  next page is everything strictly after it. With an offset, a recipe saved
  while someone is scrolling pushes every row down by one, and the row on the
  page boundary is served twice. A keyset cursor never repeats a row. A row
  saved above the cursor mid-scroll is not shown until the next reload, which
  is what the list does today anyway.
- **The cursor is opaque:** base64url of a small JSON object. Slice 7 adds the
  search score to it without the client noticing. A cursor that does not
  decode gets a `400` (the client's mistake). It is never silently treated as
  "from the start": served that way, page one would come back again mid-scroll.
- **Page size:** `limit` (default 30, clamped to 1-100). The client asks for
  30. That is enough to fill a fullscreen card at the 20px body size, with a
  second page already needed on the iPad's 6-row home card.
- **Loading trigger: `IntersectionObserver`** on a sentinel row at the end of
  the list, with the card's own scroll container (`.wrap`) as `root` and a
  200px `rootMargin`, so the next page arrives before the bottom does.
  Available since Safari 12.1, well under the 15.0 floor ([node:0bc7e618]).
  A `scroll` listener was rejected: it runs on every frame on the A8X
  ([node:716987ce]). There is a `WIECEJ` ghost button as a fallback when
  `IntersectionObserver` is missing.
- Appending dedupes by id. A reload (after ZAPISZ, delete or a tag change)
  goes back to page one.

## Phase 1 — server

- `catalog.ts`: `encodeCursor`/`decodeCursor`, `InvalidCursorError`, and
  `listCatalog(recipes, { tag, cursor, limit })` → `{ items, total,
  nextCursor }`. `total` is still the whole match count, not the page size.
- Route: parse `cursor`/`limit`, and map `InvalidCursorError` to a `400`.

Verify: `test/recipe-catalog.test.ts`. Walk every page and check the
concatenation equals the full list. Also: a recipe inserted mid-walk causes
no duplicate, a bad cursor throws, and `limit` is clamped.

## Phase 2 — client

- `K7Recipes.svelte`: `nextCursor` and `loadingMore` state, `loadMore()`, a
  sentinel after the rows, the observer `$effect`, and the fallback button.
- `eslint.config.js` browser globals gain `IntersectionObserver`.
- Changelog entry.

Verify: typecheck, lint, tests; a live check of the paged endpoint.
