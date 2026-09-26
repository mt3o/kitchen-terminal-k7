# /gw-review — epic k7-recipe-widget-upgrade, slices 3-8

Reviewed 2026-09-25. Part 1 was done by three fresh-context reviewers (slice 3,
slice 4, slices 5-8). The findings were reworked under the same change ids and
re-verified with `npm run check` (673 tests), live curl against an isolated
server, and headless Chromium.

## Part 1 — code

| change | reviewer verdict | after rework |
|---|---|---|
| k7-recipe-rejection-log | Request changes | fixed, re-verified |
| k7-recipe-auto-tags | Approve (2 low, 1 nit) | fixed |
| k7-recipe-list-all | Approve (F2 follow-up) | fixed |
| k7-recipe-infinite-scroll | Approve (F3 follow-up) | fixed |
| k7-recipe-search-fulltext | Request changes (F1) | fixed in CSS; **iPad check pending** |
| k7-recipe-search-tag-filter | Approve (2 nits) | N1 fixed, N2 accepted |

Findings and what was done:

- **S3-1 (rejection-log):** `POST /api/recipes` with a JSON `null` body
  returned 500. The sanitizer threw synchronously, outside
  `logRejection`'s `.catch`. Fixed two ways: the sanitizer keeps a non-object
  body as `{value}`, and `logRejection` has its own try/catch. Test added.
  Verified live: 400.
- **S3-2:** the NIEUDANE PROBY count loaded only on mount, so the first
  failure of a session never showed the entry point. Fixed: the failure paths
  of `saveReview`/`startImport` reload it. Browser-verified (3 → 4).
- **S3-3:** import rejections stored the whole `req.body` instead of `{url}`.
  Fixed, and the import route now also tolerates a `null` body (it used to
  throw a 500).
- **S3-4:** the changelog wrote PRÓBY/PONÓW/WIĘCEJ, but the UI labels are
  ASCII. The changelog now quotes the labels as they appear on screen.
- **S4-1:** the tagging call ran before the recipe-id check, so a doomed
  request could wait 15 s and write an `ai_calls` row. Fixed: the route checks
  `isSafeId` first. Verified live.
- **S4-2:** the 15 s timeout was untested. It is now asserted in a test.
  Passing the request's abort signal to the call is **not** done (minor).
- **S4-3:** `" #zupa"` kept its `#`. Fixed, with a test.
- **F1 (search):** `type="search"` keeps WebKit's rounded native field,
  breaking [node:61c0030d]. Fixed with `-webkit-appearance: none`.
  **Needs the real iPad** to confirm square corners and that the clear
  button survives.
- **F2 (list-all):** WSTECZ lost the list's scroll position. Fixed: saved in
  `openDetail` and restored when the list remounts. Browser-verified (900 → 900).
- **F3 (infinite-scroll):** a failed reload kept the old query's rows and
  cursor. Fixed: they are cleared, with an explicit `[!]` line.
- **F4 (tag-filter):** chip counts ignored a delete. Fixed.
- **N1:** the layout's fixed tag used up one of the 12 facet slots. Fixed on
  the server.
- **N2:** a tag containing a comma can be selected but never matches. Accepted.
  The selected chip always stays visible, so it can be un-tapped.

Plan drift: none unplanned. The manual dev-server checks the plans called for
were not recorded at implementation time. They were run and recorded here.
Route-level HTTP tests are still missing ([node:925056b0], an accepted gap).

## Part 2 — memory (human gate)

Store health: 8 unresolved disputed nodes store-wide (see `agentic-memory
stale`); the queue is not being worked.

Disputed nodes touched by these changes (not adjudicated):
- [node:e4745884] RecipeRejection as its own store rather than the issue log.
- [node:2ccd3769] logRejection scrubs `reason` before bounding. The code
  honours it.
- [node:3218cf7b] the "nothing scrolls" deck invariant. These slices scroll
  inside a card, never the deck.
- Also seen, unrelated: 3c7e1fe3, 2135f0a4, f769a5a7, f1d7ef56.

Promotion candidates (summaries mid-term → long-term; decisions short-term → mid-term), all CONFIRMED in this review:
- [node:60244cbc] change summary for rejection-log (mid-term) → long-term.
- [node:42b05a7d] change summary for auto-tags (mid-term) → long-term.
- [node:76109a6c] change summary for slices 5-8 (mid-term) → long-term.
- [node:35b6940f] the `?view=summary` envelope vs the plain array the chat
  card needs. Easy to break unknowingly.
- [node:1e13f61e] keyset cursor, not offset.
- [node:dda883c2] search ranking and its encoding into the cursor.
- [node:ada6f63c] synchronous auto-tagging that never fails the save.
- Lessons from this review, captured as constraints: [node:2d1f37b5]
  logging helpers need their own error boundary; [node:515834c2] slow or paid
  calls only after every rejection path; [node:1e1b181e] a paging client
  drops its cursor on a failed reload; [node:7b95583c] WebKit
  `type=search` needs an appearance reset.

Consolidation: 17 candidates (largest: facet `ui`, 38 instances across 15
scopes). Route to `/gw-consolidate`; not worked here.

Domain backlog: 1 proposed entity, [node:77ae64a2] RecipeRejection, with 9
artifacts attached. It needs a human ruling via `/gw-domain`.

Open the review queue: `agentic-memory-gui` → Review tab.

## Part 3 — tracker

The tracker is GitHub Issues, but none of these changes has an issue, and there
is no PR yet (the work is uncommitted). Skipped. Link them when the PR is opened.
