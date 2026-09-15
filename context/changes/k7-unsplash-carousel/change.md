# k7-unsplash-carousel

status: implemented
created: 2026-09-15
memory_goal: 54b7c36e-0b6d-41c1-8fd6-be9737d57867
change_anchor: 1278c939-a77d-4729-b4d4-367b92aebefa

## Goal
Add an `unsplash-carousel` card that rotates photos fetched server-side from
the Unsplash API, with the access key kept off the client and attribution on
every photo.

## Outcome

- `src/server/upstream/unsplash.ts` — `/photos/random` client, imgix-sized
  hotlinks, referral-tagged attribution links, download ping (API host only).
- `GET /api/unsplash` — `fetchThrough` with a new `unsplash` upstream, 6h
  default freshness (demo tier: 50 req/h), 503 when the key is unset.
- `K7Unsplash.svelte` (`k7-unsplash`) + story; slide logic from `carousel.ts`.
- Config: `UNSPLASH_ACCESS_KEY`, `UNSPLASH_SECRET_KEY` (scrubbed, unused),
  `UNSPLASH_APP_NAME`.
- `layout.yaml`: the SYSTEM page's static cat carousel is now this card.

Captured: `[node:6bd4cda3]` (own card type), `[node:3a984ba5]` (Unsplash
guideline constraints).

## Open for review
- Env var names on the deployed host must match `UNSPLASH_ACCESS_KEY` /
  `UNSPLASH_SECRET_KEY`, or the card shows its fail state.
- Not verified against the live Unsplash API or on the iPad.
