# k7-clock-date-phone-fit

status: implemented, PR pending
created: 2026-10-08
lifecycle: /gw-fix (bug — red test before the source edit)
branch: claude/k7-clock-date-phone-fit
parent: issue 726faa94 (captured by k7-card-foot-badge, replayed 2026-10-08)

memory_goal: 6605aad8-0e06-4ce3-a461-48abe6fd67ab
change_anchor: d72b5d42-e3cb-4321-8754-0742a2fa0d4e
design_surface: none
tracker: github — no issue opened (the defect was queued in the graph, not on GitHub)

## Goal

At phone width the clock card's date line ("poniedziałek, 21 września") ran
past the right edge of its half-width GLOWNA card. "poniedziałek," is one word
the browser cannot break, and at `--text-base` (20px) it is 156px wide in a
145.5px content box at 375×667 (iPhone 6s). Its comma painted over the border.

Ruling (human, 2026-10-08): **one token step down at phone width.** Rejected:
`overflow-wrap: anywhere`, because lines open with ", 21" or split a word, and
a shorter phone-only date format, which is a copy change.

## Fix

`K7Card.svelte`: in the existing `@media (max-width: 767px)` block,
`.body { font-size: var(--text-sm); }`. The wall is untouched. Besides the
clock, `<k7-card>` with a body renders only the two fallback placeholders
("oczekuje na implementacje", "niedozwolone zagniezdzenie"), and they get the
same step down at phone width.

## Red → green

`test/clock-date-phone-fit.test.ts` computes the longest unbreakable date word
with `Intl` over a whole year ("poniedziałek,"). It resolves the phone
font-size token from `tokens.css` and checks 13 × 0.6em against the measured
content box. It also pins the step at exactly `--text-sm` and asserts the wall
has no `.body` font-size. Before the edit, 2 of 4 failed ("156px at 20px, wider
than the 145.5px content box"). After it, 4 of 4 pass, and the full suite does too.

## Verified (headless Chromium 1243, production build, theme-preview.mjs)

Clock fixed to Mon 2026-09-21, Mon 2026-10-26 and Wed 2026-09-23, with reduced motion.

- 375×667 and 390×844, dark/light/night, every theme: before, retro-scifi and
  daylight-lab overflowed (by 10.5px and 9px at 375). After, everything fits.
  The tightest case is retro-scifi "26 października" at 375, with 1.5px to
  spare. The date takes 2 lines instead of 3.
- 1024×768 dark and light: screenshots are byte-identical before and after.
- Residue, not fixed: at 320px wide the date is still 6.8px past the content
  box but inside the border. With `data-density="large"` it is 2.7px past at
  375. Neither is a household device or a runtime setting.

## Memory

Decision `a2717fde`: the ruling, plus the half-card glyph budget. It is
`CONTRADICTS` → issue `726faa94`, which is now flagged for a human to retire.
`ABOUT` Card.

The dump is not in this branch. The local store and `origin/main`'s dump have
diverged both ways (main has 10 nodes and 20 events the store lacks, the store
has 7 nodes and 22 events main lacks). Rebuilding from either side alone would
lose the other's, so the union is a separate, deliberate step.
