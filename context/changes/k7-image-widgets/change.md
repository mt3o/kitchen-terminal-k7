# k7-image-widgets

status: open
created: 2026-09-09
memory_goal: dad51741-eead-4927-bb93-d45d6d298d61

## Goal
Implement Faza 5 of the K7 dashboard plan: two independent image widget card types — `ascii-art-of-the-day` (Kilo Gateway prompt-driven ASCII art generation, cached daily with a stored seed) and `comic-of-the-day` (RSS/Atom feed fetch + parse, image extraction, keyword filtering, attribution, caching) — each as its own Svelte 5 custom-element card with a Storybook story, following the upstream_cache/freshness precedent set by the weather widget.
