# k7-comic-link-scheme-guard

status: implemented
created: 2026-09-24
memory_goal: 1920374a-dad7-4371-a36f-1a1a45bc2ae5

## Goal
Fix a live self-XSS in K7Comic.svelte: the credit link renders
`href={aged.data.sourceUrl}` (raw RSS `<link>` content from
`comic-rss.ts`'s `item.link`, never scheme-checked) with no guard, so a
malicious/compromised comic feed carrying a `javascript:`-scheme link
executes on click. Guard it the same way `k7-recipe-source-editable`
guards Recipe.sourceUrl: only render as a clickable `<a>` when the URL
passes an http(s)-only scheme check, otherwise fall back to plain text.
