# Plan — k7-recipe-source-editable

memory_goal: 782ecc52-c0ca-4abe-a3a1-9c8136a05568
epic: k7-recipe-widget-upgrade (slice 2 of 8)

## Non-goals

- No change to the import flow's own `sourceUrl` handling — `extractJsonLd`/
  `extractFallback` already set it to the exact `http(s)` URL
  `importRecipeFromUrl` validated with `isFetchableUrl` before ever fetching
  it. That path stays trusted-by-construction; this slice only adds a new,
  *untrusted* path (a human typing into a form field, or hand-editing a
  `.md` file's frontmatter) that didn't exist before.
- Not reusing `isFetchableUrl`/`isPrivateAddress`
  (`src/server/security/network.ts`) for this slice's validation. That guard
  exists to stop the **server** from being tricked into fetching an internal
  address on a client's say-so (SSRF) — irrelevant here, since this URL is
  never fetched by the server, only navigated to by the household's own
  browser. Blocking a private-LAN link (e.g. a recipe noted on a home NAS)
  would be an incorrect restriction, not a security fix, so this slice needs
  a narrower, scheme-only check instead (Phase 1).

## Security note (why this slice needs a new guard at all)

`Recipe.sourceUrl` has been trustworthy by construction since it shipped:
every existing writer of it (`extractJsonLd`, `extractFallback`,
`importRecipeFromUrl`'s caller) sets it to a URL that was *already* checked
against `isFetchableUrl` before the server fetched it. This slice breaks
that invariant on purpose — the whole point is letting a household member
type an arbitrary string into the field — so `sourceUrl` becomes untrusted
input for the first time. The renderer (`K7Recipes.svelte`'s detail view)
turns it into a clickable `<a href>`; an unguarded `href={sourceUrl}` would
let a `javascript:`-scheme value execute when clicked (self-XSS, but a real
vulnerability class regardless of who typed it in). Recipe `.md` files are
also hand-editable on disk (`markdown-format.ts`'s own doc comment: "the
household edits these files by hand"), so a save-time-only check would not
be sufficient — the render-time guard is the one that actually matters;
save-time validation (Phase 2) is defense-in-depth and better UX (a clear
rejection instead of a silently dead or dangerous link).

## Phase 1 — Shared URL-scheme guard

File: `src/shared/url.ts` (new)

- `export function isHttpUrl(value: string): boolean` —
  `try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }`.
- Lives in `src/shared/` because both the server (save-time validation,
  Phase 2) and the client (render-time guard, Phase 3) need the *identical*
  check — `src/shared/changelog.ts` and `src/shared/layout.ts` already
  establish this directory as real runtime code imported by both sides, not
  just mirrored types (`assembleChangelog`, `normaliseLayout` are functions,
  not type declarations). Two independently-written copies of a
  security-relevant scheme check is exactly the kind of duplication that
  drifts apart silently; one function, imported twice, cannot.

Verify: a small unit test (new `test/url.test.ts` or folded into an
existing shared-utils test file) — accepts `http://`/`https://` including
with paths/query/private hosts (`http://192.168.1.5/x` is still a *valid
http(s) URL* for this check's purposes, per the non-goal above); rejects
`javascript:alert(1)`, `data:text/html,...`, `vbscript:`, a bare string with
no scheme, and an empty string.

## Phase 2 — Server: validate on save

File: `src/server/index.ts`

- `POST /api/recipes` currently does
  `sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : null` —
  passing through any string, unvalidated. Change to:
  - `body.sourceUrl` absent/non-string → `null` (unchanged — manual entry
    with nothing typed).
  - `body.sourceUrl` is `''` (or trims to `''`) → `null` — the household
    cleared an existing source; since `save()` always writes the full
    object fresh, this correctly removes `sourceUrl` from the rewritten
    file/row on an EDYTUJ save, not just on a new one.
  - `body.sourceUrl` is a non-empty string that fails `isHttpUrl` → reject:
    `reply.code(400).send({ error: 'sourceUrl must be an http(s) URL' })`,
    same early-return style as the existing `title is required` check.
  - Otherwise: trimmed string, saved as-is.
- No adapter changes needed — `sourceUrl` already flows through both
  `FileRecipeRepository` (frontmatter) and the Drizzle adapter (existing
  nullable column) unchanged; only the value arriving at the door is new.

Verify: extend the `POST /api/recipes` route tests (or add one) —
`sourceUrl: 'javascript:alert(1)'` gets `400`; `sourceUrl: ''` on an EDYTUJ
save of a recipe that had one clears it to `null`; a normal `https://` value
still saves.

## Phase 3 — Client: editable field + clickable link

File: `src/client/lib/K7Recipes.svelte`

- **Review form:** replace the current read-only
  `<p class="review-source">zrodlo: {reviewSourceUrl}</p>` line with an
  `<input type="url" bind:value={reviewSourceUrl}>` field. `reviewSourceUrl`
  changes from `$state<string | null>(null)` to `$state('')` (empty string
  is "no source" for the input's sake — matches Phase 2's empty-string-means-
  clear convention, so no extra client-side null/empty bookkeeping is
  needed). `openReview()` sets it via `recipe.sourceUrl ?? ''`;
  `saveReview()` sends `sourceUrl: reviewSourceUrl.trim()` and lets the
  server normalize `''` to `null`. `type="url"` gives basic browser
  well-formedness hints but is **not** the security boundary — Phase 2's
  server check is; this input can't be relied on to reject `javascript:` in
  every browser.
- `saveReview()`'s error handling currently discards the response body on a
  non-ok save (`if (!res.ok) throw new Error(...)`, caught generically as
  "nie udalo sie zapisac przepisu"). Read the JSON body's `error` field when
  present and show it instead, so a rejected `sourceUrl` gives the household
  an actionable message rather than a generic failure — the same
  `'error' in body` pattern `startImport()` already uses.
- **Detail view:** replace the plain
  `{#if detail.sourceUrl}<p class="review-source">zrodlo:
  {detail.sourceUrl}</p>{/if}` with a clickable link, but **only** when
  `isHttpUrl(detail.sourceUrl)` (imported from `src/shared/url.ts`) — a
  `sourceUrl` that fails the check (legacy data, a hand-edited file with
  garbage in frontmatter) falls back to the existing plain-text rendering,
  never a raw `href`. This check is independent of, and does not trust,
  Phase 2's save-time validation — the on-disk files stay hand-editable
  outside the API entirely, so the render site is the one guard that must
  never be skipped.
  `<a class="review-source" href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">zrodlo: {detail.sourceUrl}</a>`.
  `rel="noopener noreferrer"` is standard hygiene for an externally-linked
  `target="_blank"` anchor.

Verify: manually exercise in the dev server — type a `javascript:` URL into
the source field, confirm the save is rejected with a visible error; save a
normal `https://` source, confirm the detail view renders it as a clickable
link that opens the real page; edit an existing recipe's source to empty,
confirm it's gone from the detail view and the on-disk file after save;
hand-edit a `.md` file's `sourceUrl` frontmatter to a `javascript:` value
and confirm the detail view falls back to plain text rather than a link.

**Changelog entry (CLAUDE.md standing constraint — `/gw-plan-review` caught
this was missing; the sibling slice `k7-recipe-description-field` already
set the precedent with `changelog/2026-09-23-01-przepisy-opis.yaml`):** this
is user-facing (a previously read-only field becomes editable; a plain-text
line becomes a clickable link), so it needs one new file in `changelog/`,
`YYYY-MM-DD-NN-slug.yaml` (date = the day this change lands, NN = next
sequence number for that date), in Polish. Added as the last step of
implementation, not now.

## Risk

Low and contained — `impact_of` was not run because nothing recalled is
being reversed or redefined; this slice only adds a capability (editing a
field the UI previously showed read-only) and a new guard function. The one
real risk this plan exists to close is the XSS surface opened by making
`sourceUrl` editable at all, addressed by Phase 1's shared guard applied at
the one place it's load-bearing (render), with Phase 2's save-time check as
a secondary, non-load-bearing improvement.
