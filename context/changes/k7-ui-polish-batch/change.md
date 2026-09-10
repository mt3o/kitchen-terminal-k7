# k7-ui-polish-batch

status: open
created: 2026-09-10

## Goal
A batch of small UI requests from one session, following on from the
card-overflow fixes and their /gw-review:

- SIATKA (grid card type): smaller padding/font for nested cells; fixes a
  nested clock overflowing its cell (--glance-sm digits too large for a
  shrunk cell).
- Calendar: seven cramped side-by-side day columns replaced with a
  vertically stacked, vertically scrolling list of full-width day rows
  (event titles were wrapping letter-by-letter in the old layout).
- Footer: light/dark theme toggle button, persisted in localStorage.
- Header: shorter (tightened line-height + reduced padding-bottom) —
  disproportionate height for a one-line status bar.
- SYSTEM page carousel: placeholder images replaced with real Unsplash cat
  photos.
- SYSTEM page static image: replaced with a real QR code (Punktomat login),
  with a per-card label override (new `params.image.label` in the schema —
  previously every `image` card was hardcoded to "OBRAZ").
- ascii-art-of-the-day: NOT a missing feature — client, server route,
  caching and gateway wiring are all already implemented and correctly
  configured (a cat-themed prompt already in layout.yaml). The "brak
  ascii-art" the household sees is the LAN box's KILO_GATEWAY_KEY being
  unset (confirmed via deployed service logs), a secret only a human can
  set. Added a static fallbackArt so the empty state degrades gracefully
  instead of showing nothing.

design_surface: none
