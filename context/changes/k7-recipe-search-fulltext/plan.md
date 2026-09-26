# Plan — k7-recipe-search-fulltext

memory_goal: 84bdd8e7-f7fd-49c0-94a1-8a1b5c4b6da2
epic: k7-recipe-widget-upgrade (slice 7 of 8, blocked by 1 and 6 — both done)

Extends the `?view=summary` envelope ([node:35b6940f]) and its keyset cursor
([node:1e13f61e]) with `q`. Still a read-time pass over the Markdown store
([node:7c3c191a]). There is no index: at household scale, one scan per
keystroke-debounce is cheap, and an index would be a second copy of data the
household edits by hand.

## Matching and ranking

- **Normalisation:** lowercase, NFD with combining marks stripped, `ł`→`l`.
  `zurek` then finds `Żurek`, which matters on a kiosk keyboard where Polish
  letters take a long-press.
- **Terms:** the query split on whitespace, deduped, at most 8, with the
  query capped at 200 chars. A recipe matches when **every** term is a
  substring of at least one field (AND). With OR, each extra word would widen
  the results, which is the opposite of what typing more means.
- **Rank:** field priority, as the roadmap sets it: title > tags >
  ingredients > steps > description > source URL. Each term counts once, at
  the best field it appears in. Recipes are compared by how many terms landed
  in the title, then in tags, and so on down the list (lexicographic). Ties
  go to newest first, the list's normal order.
  Encoded as one integer, `Σ 9^(5 - field)`. With at most 8 terms no digit
  carries, so comparing the integers is the lexicographic comparison, and the
  integer fits in the keyset cursor.
- **Cursor:** gains `s` (the score). Sort key `(s desc, importedAt desc, id)`.
  Without `q` every `s` is 0 and the order is exactly slice 6's.

## Phase 1 — server

- `catalog.ts`: `normalizeSearchText`, `searchTerms`, `scoreRecipe` →
  `number | undefined` (undefined = no match), `q` on `CatalogQuery`, and `s`
  in the cursor (an old cursor without `s` decodes as 0).
- Route passes `q`.

Verify (`test/recipe-catalog.test.ts`):
- the priority order, each field alone;
- AND across terms;
- diacritics folding;
- a title hit outranks any number of lower hits for the same term;
- paging a ranked result with a cursor walks it exactly once.

## Phase 2 — client

- A search field at the top of the list view, `type="search"` (Safari gives
  it the clear button), debounced by 250 ms, feeding `q` into `load()` and
  `loadMore()`.
- An empty result with a query says `brak wynikow`, not `brak przepisow`.
- Styled from existing tokens, sharing `.import-url`'s look ([node:79662ce5]).
- Changelog entry.
