# k7-card-host-display-safari

status: implemented, awaiting review/commit
created: 2026-09-10

## Goal
Fix a visual glitch reported from the real iPad (Safari 15 / iPadOS 15):
the comic-of-the-day card's image renders far larger than its card,
overlapping the header above and the row below. Root cause: the
`k7-comic` custom element has no `:host { display: block }`, so on
Safari the percentage-height chain that constrains the image
(`.card { height:100% }` -> `.wrap` -> `.frame` -> `.comic { max-height:100% }`)
has no definite height to resolve against, and the max-height clamp is
silently ignored. Apply the same `:host` rule K7Card.svelte already
uses, to K7Comic.svelte and (preventively, identical construction)
K7Image.svelte.

design_surface: none

memory_goal: 1f0eb2f9-d571-4a4a-af21-f2380fa2dd4b
