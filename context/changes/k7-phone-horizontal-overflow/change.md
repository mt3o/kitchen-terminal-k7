# k7-phone-horizontal-overflow

status: implemented, in review (PR)
created: 2026-09-21
lifecycle: /gw-fix (bug — red test before the source edit)

## Goal
Fix card contents that overflow their card horizontally at phone width
(<768px, measured at 390x844) and are clipped by Card.svelte's
`.card { overflow: hidden }`, on every page, dark and light:

- PRZEPISY, `k7-menu` (`menu-przepisy`, vertical, 1 of 3 columns): every
  `.item` overflows the card's right edge by 35px; "PRZEPISY", "MINUTNIK"
  and "AUDIOMETR" are cut off.
- PUNKTOMAT, `k7-image` / `k7-unsplash-carousel`: the head's `[ + ]`
  fullscreen button overflows by 34px / 17px.
- PRZEPISY, CZAT tab, `k7-chat`: NOWA overflows by 57px, `[ + ]` by 139px.

Found by extending the reported repro, the same defect in states it did not
reach: a running timer (`[ + ]` over by 110px, `reset` cut off) and the
Unsplash carousel once it has photos (its prev/next nav plus `[ + ]`, over
by 95px). The reported repro had no Unsplash key and an idle timer. At
768x1024 (iPad portrait, desktop CSS) the same head defect clipped `[ + ]`
on the calendar and the Unsplash card too.

These predate k7-card-box-sizing, which only changed vertical sizing. This
change was rebased onto origin/main after that one merged (2513610); the one
conflict was Card.svelte's `.card-head` (main added `border-image:
var(--rule)` for the steampunk theme — kept).

## Root causes

1. **K7Menu:** `.items` was `flex-wrap: wrap` in both orientations. A
   multi-line flex container sizes each line to its widest item, so in the
   vertical (column) menu every item was as wide as "AUDIOMETR" (135px) in a
   91px card body. And at 390px no single line of tracked text-sm fits
   "AUDIOMETR" in that column at any padding.
2. **Card head:** `[ + ]` is `flex-shrink: 0; white-space: nowrap` on
   purpose, but it sat in `.card-head-right`, which had `min-width: 0` at
   phone width and could not wrap, inside a `.card-head` that could not
   wrap either. The group shrank, the button did not, and the button hung
   out past the card edge.
3. **Widgets' head controls:** K7Chat's `.head-actions`, K7Timer's
   `.controls` and K7Unsplash's `.nav` were non-wrapping flex groups, as
   wide as all of their buttons together.

## Fix

- `Card.svelte`: head markup is `.card-head-title` (label + meta when there
  are no actions) and `.card-head-right` (actions + `[ + ]`, rendered only
  when there are any). `.card-head` wraps; `.card-head-right` wraps,
  right-aligns and has `min-width: 0`. At phone width `.card-head-title` is
  `flex-basis: 0; min-width: calc(3 * var(--text-sm))`: label and meta
  still truncate on one line as before, and controls drop to their own line
  only when the title would get less than ~3 characters.
- `K7Menu.svelte`: vertical is a single-line column (wrap only for
  horizontal); `.item` is `box-sizing: border-box; max-width: 100%`;
  `.label`/`.icon-tag` get `min-width: 0; overflow-wrap: break-word;
  text-align: left`; horizontal padding drops to `--space-2` at phone width.
  Long labels break inside the item ("PRZEPI/SY") rather than being cut.
- `K7Chat.svelte`: the head buttons are rendered without a wrapper div, so
  they wrap in one flow with `[ + ]` (MENU ARCHIWUM / NOWA [ + ]). The
  phone padding rule moved from `.head-actions button` to `.head-action`.
- `K7Timer.svelte` `.controls`, `K7Unsplash.svelte` `.nav`,
  `K7Carousel.svelte` `.nav`: `flex-wrap: wrap; justify-content: flex-end`.
- `K7Unsplash.svelte`: dots hidden at phone width (K7Carousel's existing
  rule): up to twelve dots are wider than a half-width card at 375px, and
  the footer already shows "3/8".
- Test: `test/phone-horizontal-overflow.test.ts` (static `<style>`/markup
  assertions). Red before the fix: 11 of 14 failing, all for the reported
  reasons.

## Verification (headless Chromium, production build, scratch data dirs)

Measured by comparing every element and text run in each widget's shadow
root with its card (and with any inner clipping ancestor), across every
page, every PRZEPISY tab, a running and a paused timer, and Unsplash mocked
with 15 and with 8 photos. Baseline = origin/main 2513610 built and served
side by side.

| viewport | mode | clipped/overflowing before → after |
|---|---|---|
| 390x844 | dark, light | 25 → 1 |
| 375x667 | dark, light | 27 → 1 |
| 768x1024 | dark, light | 6 → 0 |
| 1024x768 | dark, light | 0 → 0; all 55 card screenshots pixel-identical |

The one remaining hit, unchanged and out of scope: K7Card's date line on
the clock ("poniedziałek," is one word ~3px wider than a half-width card at
375px; at 390px it only reaches into the padding). Ellipsis-truncated
labels/meta are intentional and excluded.

Touch targets: every menu item, head button and `[ + ]` measured ≥ 44px
tall (menu items 54–59px where the label breaks). Also audited under the
steampunk-brass and daylight-lab themes (via a scratch `layout.local.yaml`):
no head or menu overflow at 390/375, none at 1024x768.

Card-by-card pixel diff at phone width, beyond the intended cards: the
calendar and recipes heads show a slightly different label/meta truncation
split (see memory-backlog.md §2e); everything else not listed above is
pixel-identical.

`npm run check`: green (lint, token contract, tokens check, 571 tests,
typecheck, build).

## Follow-ups (not done here)

- Phone-width heads with label + meta + `[ + ]` (GLOWNA calendar, recipes)
  are still crushed to a few characters; full §6.1 wrapping fixes it at
  ~48px of height per card — a human call (memory-backlog.md §2e).
- Card footer: the `[--]` badge can wrap at its hyphen in a narrow footer
  beside a long meta (seen on the CZAT card at 390px) — pre-existing, a
  footer row that §6.1 says should wrap.
- K7Card's clock date line clips by ~3px at 375px (above).

design_surface: none

tracker: github — no issue opened (creating one is outward-facing; left
for the human to open or waive)

memory_goal: (not minted — store unreachable this session; see memory-backlog.md)
