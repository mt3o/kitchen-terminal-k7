# k7-layout-reorg

status: in-review
created: 2026-09-17
memory_goal: 1c386aee-50dd-4adf-af38-d38bf9ec0c4f
pr: https://github.com/mt3o/kitchen-terminal-k7/pull/57

## Goal
Reorganize `layout.yaml`'s pages around how the household actually uses the
wall display, by use-case, rather than the prior rough-theme grouping
(`dom`/`kuchnia`/`system`) that split duplicated cards (two clocks, two
timers) across pages and spent whole page slots on `grid`/`menu` as if they
were content in themselves rather than layout tools.

## What changed
- `glowna` (GLOWNA): the one doorway-glance page — clock, weather, calendar,
  plus ascii-art-of-the-day for warmth. Consolidated from two separate
  clock/weather instances (`glowna` + `system`) into one.
- `narzedzia` (NARZĘDZIA), new: timer + audiometer — kitchen tools reached
  for while actually cooking, not read from the doorway. Consolidated from
  two separate timer instances (`glowna`'s `minutnik` + `kuchnia`'s
  `minutnik-kuchnia`) into one.
- `przepisy` (PRZEPISY), new: recipes as the primary card, AI chat as a
  second tab via a `menu` card — the one place a menu earns its slot as a
  tab switcher between two related cards, rather than being the page's own
  reason to exist.
- `zakupy` (ZAKUPY), new: shopping list alone, full page width/height
  instead of sharing a column.
- `punktomat` (PUNKTOMAT), new: the QR login code plus the cat-photo
  carousel — a "just for fun" page.
- `komiks` (KOMIKS), new: the daily comic, alone.
- `kalendarz` (KALENDARZ), new: a second calendar card instance
  (`kalendarz-pelny`), same week view as `glowna`'s but alone on a
  full-width page — added after review feedback, since the doorway-glance
  instance stays compact by design and this one is for actually reading a
  week's event titles. A deliberate, on-demand-style duplicate, not the
  always-visible-clutter kind the rest of this change removed.
- Dropped entirely: the nested `grid` card (a whole page slot spent on
  nesting a single clock) and the old `menu-kuchnia` card (a whole page slot
  spent on an audio/timer switcher) — the user's own framing was "use
  menu/grid as layout building helpers, not end goals," and neither served
  a purpose that direct card placement didn't already cover better. Also
  dropped the redundant `karuzela` (nested clock+weather carousel), fully
  superseded by `glowna`'s own clock/weather.

## A real bug found and fixed along the way
`src/client/main.ts`'s desktop row-count computation (`--deck-rows`) counted
every declared card on a page, including ones a same-page `menu` hides at
first paint. The new `przepisy` page (recipes, chat, menu — chat starts
hidden) computed 2 rows from 3 declared cards, leaving an empty second row
the height of the visible content above it — half the iPad screen dead
space. Fixed with a `menuHiddenIds()` helper that excludes a menu's
non-active targets from the row math, mirroring the menu widget's own
default-active resolution exactly so the two can never disagree.
