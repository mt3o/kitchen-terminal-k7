# Plan — k7-recipe-search-tag-filter

memory_goal: 7f98639c-a8ed-4e4e-a7e6-94d01476d76b
epic: k7-recipe-widget-upgrade (slice 8 of 8, blocked by 7 — done)

Layered on working full-text search ([node:dda883c2]), in the same
`?view=summary` envelope ([node:35b6940f]). Additive only.

## Decisions

- **Query:** `tags=a,b` (comma-separated), ANDed with each other, with `q`,
  and with the existing single `tag` (the layout's `params.recipes.tags`
  filter, which still sends only its first entry, exactly as before — no
  layout sets it today, and changing its meaning is not this slice's call).
  AND, because a facet you tap narrows the list; OR would widen it with every
  tap, the same reasoning as the search terms.
- **Facets in the envelope:** `tagFacets: { tag, count }[]`, counted over the
  *current* result (after `q`, `tag` and `tags`). A count therefore says how
  many recipes would remain if that tag were added. Sorted by count desc,
  then tag, at most 12. Every selected tag is always included, even past the
  cap, so a selected chip can always be un-tapped.
- **Chips reuse the calendar tab pattern** (`K7Calendar.svelte` `.tab` /
  `.tab-active`): a ghost chip, the selected state carried by literal
  `[ … ]` brackets plus the strong border, not by colour alone. No new
  component and no new token, so no component gap for the design system to
  rule on. The row scrolls horizontally, so it never pushes the list down more
  than one row. `aria-pressed` carries the state.
- The layout's own fixed tag is not offered as a chip: it is always on.

## Phase 1 — server

- `catalog.ts`: `tags?: string[]` on `CatalogQuery`, `TagFacet`, and
  `tagFacets` on `CatalogPage`.
- Route: parse `tags` (split on `,`, trimmed, blanks dropped, at most 8).

Verify (`test/recipe-catalog.test.ts`):
- tags AND with each other and with `q`;
- facet counts reflect the current result;
- the facets are capped at 12, and a selected tag always survives the cap.

## Phase 2 — client

- `selectedTags` state, a chip row under the search field, and a toggle that
  reloads from page one. Selected tags are cleared when the facet list no
  longer offers them? No: a selected tag is always offered (above), so
  nothing is cleared silently.
- Changelog entry.
