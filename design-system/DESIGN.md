# Kitchen Terminal K7 — Design System

> Retro-futurist HUD for a wall-mounted kitchen kiosk.
> Amber phosphor on warm charcoal, monospace, zero radius, no shadows.
> Derived from `HANDOFF.md`, `TECH-STACK.md`, `theme.schema.yaml` and the six
> accepted wireframes.

**Status:** v1. Dark mode is the accepted wireframe palette, kept verbatim where
it already passed. Light mode is corrected (three roles failed WCAG AA). Night
mode and the interaction-state layer are new.

**Files**

| File | Role |
|---|---|
| `DESIGN.md` | This document. Intent, rules, rationale. |
| `tokens.css` | The shipped variables. Paste into the app shell before any component CSS. |
| `design-tokens.json` | Machine-readable token list for the Storybook/theme loader. |
| `tailwind-v4.css` | `@theme` bindings so Tailwind utilities resolve to the same tokens. |
| `theme.schema.v2.yaml` | Proposed superset of the existing `theme.schema.yaml`. |
| `themes/retro-scifi.yaml` | The canonical theme, v2 format. |
| `themes/daylight-lab.yaml` | A second theme, present to prove the swap actually works. |
| `kitchen-terminal-k7-kit.html` | The component kit. Open it; it is the real spec. |

---

## 1. The one-paragraph version

K7 is a screen bolted to a kitchen wall that nobody asked to look at. It is read
from the doorway at three metres, from the counter at one metre, and touched
with wet hands at forty centimetres. Everything below follows from those three
distances and from one piece of hardware: an iPad Air 2 running Safari 15. The
aesthetic is amber-phosphor HUD — not because retro is fashionable, but because
a self-luminous amber-on-near-black display is the correct answer to a room that
is dark at 06:00, sunlit at 14:00, and dim again at 22:00.

## 2. The rule that governs everything else

> **Amber is the ink. Teal is the signal.**

`HANDOFF.md` says *"amber jako dominujący akcent + teal jako drugi"*. Read
literally that gives you two accents, which is one too many, and it makes amber
meaningless — if every glyph on the screen is amber then amber cannot also mean
*"look here"*.

So the system splits the two:

- **Amber (`--fg` / `--accent`)** is the body text colour, the border colour, the
  chrome. It is everywhere and therefore carries no urgency. Amber is the
  phosphor the terminal is made of.
- **Teal (`--signal`)** is reserved. It marks state that is *good and settled*:
  `ONLINE`, a completed timer, a checked-off shopping item, your own message in
  the chat thread. Teal appears at most twice per card.

The consequence, which is load-bearing:

- A **solid amber fill** is the loudest thing the system can say. There is at
  most **one solid amber control per card**, and one per viewport for any given
  action. Everything else is a ghost button (transparent, amber border) or a
  text link.
- **Warn (`--warn`) and fail (`--fail`) are not amber.** They sit at hue 45 and
  hue 27 — visibly hotter and redder than ink amber at hue 72. On a warm amber
  screen, a warm warning is invisible, so the hue separation has to be earned.
- **Colour never carries state alone.** Every state also carries a bracket glyph:
  `[OK]`, `[!]`, `[X]`, `[--]`. This is not a nicety — a wall display gets
  viewed at an angle, in sunlight, by people with colour-vision deficiency,
  through a greasy screen protector.

## 3. Colour

### 3.1 How the palette was built

Every value is derived in **OKLCH** at fixed hue and chroma, walking lightness
until the WCAG target is met, then written out as **hex**.

The output is hex on purpose. `oklch()` shipped in Safari 15.4 and `color-mix()`
in Safari 16.2; the deployment baseline is **Safari 15.0** (iPad Air 2 / iPhone
6s, both terminal at iPadOS/iOS 15). So every hover and active value in
`tokens.css` is precomputed rather than mixed at runtime. OKLCH is the *design
space*; hex is the *delivery format*. When you add a colour, derive it the same
way — do not eyeball a hex value.

The four hues:

| Role | Hue | Why |
|---|---|---|
| Ink / accent (amber) | 72 | The accepted `#faab2f`. Amber P3 phosphor. |
| Signal (teal) | 167 | The accepted `#5dcaa5`. ~95° from ink — maximum separation without going blue, which reads cold and clinical in a kitchen. |
| Warn | 45 | Hot enough to separate from ink at a glance. |
| Fail | 27 | Red proper. Reserved for destructive and error only. |
| Neutral | 84, chroma 0.012 | Warm charcoal. A neutral grey next to amber reads blue-green and cheap. |

### 3.2 Dark mode — validated, not redesigned

The wireframe palette was audited pair by pair and it holds up. `#faab2f` on
`#211d16` is 8.73:1; `#5dcaa5` is 8.35:1; even `#888780` muted text clears AA at
4.65:1. Those values are kept **exactly**.

What was missing, and is now added: a structural hairline `--border` (`#3a352b`,
distinct from the amber HUD frame), the `--warn` role, the full hover/active
set, a focus ring, and the alpha washes the wireframes used inline.

One correction: `--fail` moved `#d85a30` → `#e06138`. The original was 4.33:1 on
surface, just under AA, and error text is the last thing that should be hard to
read.

### 3.3 Light mode — corrected

Three roles in `wireframes/01-kalendarz-tydzien.html` failed AA as body text:

| Role | Was | Ratio on `#f4f2ec` | Now | Ratio |
|---|---|---|---|---|
| accent (amber) | `#ba7517` | 3.32:1 ✗ | `#995600` | 5.09:1 ✓ |
| signal (teal) | `#1d9e75` | 3.03:1 ✗ | `#007853` | 4.92:1 ✓ |
| text muted | `#888780` | 3.22:1 ✗ | `#6a6963` | 4.92:1 ✓ |

They failed for the same reason and the fix is systematic, not three patches:
**in light mode no foreground role may sit above OKLCH L 54%.** Hue and chroma
are untouched — these are the same colours, moved down the lightness axis.

Note the direction reversal: in dark mode, hover *raises* lightness
(`#faab2f` → `#ffc24d`); in light mode it *lowers* it (`#995600` → `#834200`).
Both move the background 0.06–0.12 L away from its resting value and both
increase foreground contrast. Nothing in this system dims text on hover.

### 3.4 Night mode — new

`theme.schema.yaml` models colour as `{light, dark}`. That cannot express the
third thing a 24/7 kitchen display needs: the same design at 06:00 in the dark
without functioning as a lamp.

Night mode holds the hues, drops page luminance from 0.88% to 0.10% — **8.8×
dimmer** — and still clears AA on every text role (`--fg` at 6.83:1). It is a
mode, not a brand: same tokens, same components, no conditional markup.

Trigger it on a clock schedule; do not attach it to a light sensor. The iPad's
ambient sensor sits behind a wall mount and will read the room's shadow, not its
light.

### 3.5 Contrast floors

| | Minimum | Applies to |
|---|---|---|
| Body text | 4.5:1 | `--fg`, `--fg-muted`, `--signal`, `--warn`, `--fail` on their surface |
| Large text ≥ `--text-xl`, icons, borders | 3:1 | `--border-strong`, glance-tier numerals |
| Disabled | none | `--fg-disabled` only — the one role allowed to drop below |
| Focus ring | 3:1 | vs. both the control and the surface behind it |

`--border` (the hairline) is deliberately below 3:1. It is a texture, never a
carrier of meaning. Anything that must be *seen* uses `--border-strong`.

## 4. Typography

### 4.1 One family

**Source Code Pro**, self-hosted as woff2 from the LAN backend, weights 400 /
500 / 600. Fallback `ui-monospace, "SF Mono", Menlo, "Courier New", monospace`.

Monospace is locked by the brief. `Courier New` — the placeholder in
`retro-scifi.yaml` — is replaced: it is thin, its x-height is small, it has no
real weight range, and at 20px across a kitchen it disappears. Source Code Pro
was drawn for code read on screen, which is the same problem as a wall of
diagnostic labels: a dotted zero, a `1` with a full base serif against a tailed
`l` and a serifed `I`, Latin Extended-A so every Polish diacritic is a real glyph
rather than a fallback, and Regular / Medium / Semibold as separate faces so the
weight steps this system asks for exist. It is SIL OFL, so self-hosting is
unencumbered. No CDN: the iPad's only reliable route is the LAN server, and the
service worker caches the faces with the app shell.

Its x-height is 0.486 em against Plex Mono's 0.516 — about 6 % shorter, which
moves every figure in §4.2 down by the same 6 %. The 20px decision survives that
with margin; what it does tighten is `--text-sm`, which now clears the 5 arcmin
comfort floor at 1 m by a tenth of a minute. That is an argument for the 20px
body rule, not against the face.

If the three static faces become tiresome to cache, Source Code Variable ships
the same design as one variable woff2 and Safari has supported variable fonts
since 11. That is a packaging choice, not a redesign, and it is not made here.

There is **no second display face**. Hierarchy comes from size, weight and
tracking only. In a data-dense utility interface a decorative face is noise, and
mixing two monos is worse than using one.

### 4.2 Two tiers, set by viewing distance

The iPad Air 2 presents 1024×768 CSS px across 196.6 mm, so 1 CSS px ≈ 0.192 mm.
Text is comfortable at ≥ 5 arcmin of subtended x-height and glanceable at ≥ 8.

| Token | Size | x-height | 0.5 m | 1 m | 2 m | 3 m |
|---|---|---|---|---|---|---|
| `--text-xs` | 14px | 1.31 mm | 9.0′ | 4.5′ | — | — |
| `--text-sm` | 16px | 1.49 mm | 10.3′ | 5.1′ | — | — |
| `--text-base` | **20px** | 1.87 mm | 12.8′ | 6.4′ | — | — |
| `--text-lg` | 24px | 2.24 mm | 15.4′ | 7.7′ | — | — |
| `--text-xl` | 32px | 2.99 mm | 20.5′ | 10.3′ | 5.1′ | — |
| `--glance-sm` | 48px | 4.48 mm | 30.8′ | 15.4′ | 7.7′ | 5.1′ |
| `--glance-md` | 72px | 6.72 mm | 46.2′ | 23.1′ | 11.5′ | 7.7′ |
| `--glance-lg` | 112px | 10.45 mm | 71.9′ | 35.9′ | 18.0′ | 12.0′ |

Figures are Source Code Pro's, at an x-height of 0.486 em.

**Read tier** (`--text-*`) is for anything you walk up to: event lists, the chat
thread, the shopping list, recipe steps. **Glance tier** (`--glance-*`) is for
what must survive the doorway: the clock, current temperature, the timer
countdown, run state.

The wireframes set body copy at 11–13px. That is a desktop density and it is the
single largest correction in this document. **`--text-base` is 20px.** 14px
(`--text-xs`) is capped at true meta — token counts, seeds, cache stamps — the
things you read only when you have already leaned in.

### 4.3 HUD labels

Section labels are uppercase, `--text-sm`, weight 500, `letter-spacing:
--tracking-label` (0.12em ≈ the 2px already accepted in `retro-scifi.yaml`),
coloured `--fg-muted`. Examples: `SYS.POGODA`, `LOG.WYDARZENIA`, `CHAT.AI`.

Diagnostic phrasing is part of the design, not decoration: `STATUS: ONLINE`,
`[AKTYWNE]`, `>> log`, `MODEL: kilo-auto/free`. Keep it terse, lowercase for
data, uppercase for labels. No exclamation marks, no emoji as functional icons.

### 4.4 Figures

All numeric readouts carry `font-variant-numeric: tabular-nums`. A monospace
face gives this for free, but the fallback chain may not, and a temperature that
shifts horizontally every minute on a wall display is maddening.

## 5. Spacing, shape, elevation

- **Grid:** 4px base. `--space-1` … `--space-16`. Card gap is `--space-3` (12px),
  matching `layout.example.yaml`.
- **Radius: 0.** Everywhere. No exceptions, including inputs, chips and the
  scrim. This is locked by the brief and it is what makes the HUD read as
  instrumentation rather than as an app.
- **Elevation is not a shadow.** Depth is a 1px `--border` plus one step on the
  surface ramp (`--surface-sunken` → `--surface` → `--surface-raised`). The only
  ring in the system is the card's 2px inset `--border-strong` frame, carried
  over from the wireframes.

  Two reasons. Soft shadows are a GPU cost the A8X should not pay on a screen
  that never sleeps, and a blurred drop shadow under a sharp-cornered amber
  panel looks like a mistake.
- **`backdrop-filter` is capped at 4px and used once** — on the slideshow and
  dialog scrim. It needs the `-webkit-` prefix on Safari 15 and it is the most
  expensive thing this UI can ask for. It is not applied per card.
- **Card padding** `--card-pad` (20px), **min-height** `--card-min-h` (240px) so
  grid rows do not jump as data loads.

## 6. Layout

Design target is the **iPad Air 2 in landscape: 1024×768 CSS px.** Not a
desktop, not "responsive down from 1440". Everything is designed at 1024 and
then adapted.

| Breakpoint | Device | Sidebar | Grid |
|---|---|---|---|
| ≥ 1024px | iPad landscape (primary) | permanent, 260px | 2 columns, ~370px each |
| 768–1023px | iPad portrait | collapsible, overlays on open | 1 column |
| < 768px | iPhone 6s (375px) | always collapsible, full-height overlay | 1 column |

This is exactly the `sidebar.behavior` contract already in `layout.schema.yaml`
(`horizontal: permanent`, `vertical: collapsible`, `mobile: collapsible`), now
bound to real pixel values.

Media queries only. `@container` is Safari 16 and unavailable. `100vh` is
unreliable in an "Add to Home Screen" standalone context, so the shell uses
`height: 100vh` with a `-webkit-fill-available` override.

### 6.1 Layout integrity rules

These are not style preferences. Every one of them was a real overflow found by
switching the kit to `light` + `density: large` — the mode that raises the type
scale ~20–40% and breaks anything holding a fixed dimension. Test that
combination before calling a component done.

- **Grid tracks must be able to shrink.** `repeat(5, 1fr)` has an automatic
  minimum of the content width, so the track grows past its container instead of
  compressing. Always `repeat(N, minmax(0, 1fr))`. This is what pushed the
  five-day forecast outside its card border.
- **`auto-fit` minimums must yield below their own breakpoint.** Write
  `minmax(min(340px, 100%), 1fr)`, never `minmax(340px, 1fr)` — the bare form
  overflows the moment the container is narrower than the minimum.
- **Rows wrap before they crush.** Any row pairing text with a trailing badge or
  control uses `flex-wrap: wrap`. The badge drops to its own line; the text does
  not get squeezed into a three-line column beside it.
- **No fixed `flex-basis` on a label column.** `flex: 0 0 68px` fits "CZW" at
  16px and clips it at 24px. Use `flex: 0 0 auto` with a `min-width`, and give
  the flexible sibling `min-width: 0` so it can actually shrink.
- **HUD brackets never orphan.** `[ + DODAJ WYDARZENIE ]` wrapped its closing
  `]` onto a line of its own. Brackets come from `::before` / `::after` using a
  non-breaking space (`content: "[\00a0"`), so the label may wrap between its own
  words but the bracket stays bound to the text. Labels longer than about two
  words drop the brackets entirely, matching `wireframes/01`.
- **Buttons pad vertically.** `padding: 0 var(--control-pad-x)` with only a
  `min-height` leaves a two-line label touching the border. Pad both axes.
- **Composers wrap as groups.** In the chat card the field is `flex: 1 1 240px`
  and the mic + send pair is a single `flex: 0 0 auto` group. The field keeps a
  usable width and the controls move to the next line together, rather than the
  field shrinking until its placeholder is unreadable.

## 7. Interaction states

Every interactive element defines **five** states. Foreground and background are
always specified as a pair, and contrast never falls below the resting value —
except `:disabled`, which is the only state permitted to.

| State | Rule |
|---|---|
| rest | as tokened |
| hover | background moves 0.06–0.12 OKLCH L away from rest; foreground unchanged or stronger |
| active | background moves the other way; the control visibly depresses |
| focus-visible | `--focus-w` (3px) ring in `--focus`, `--focus-offset` (2px) out |
| disabled | `--fg-disabled`, no border change, `cursor: not-allowed` |

Hover is nearly vestigial on a touch kiosk but must still be correct for the
phone-over-LAN case and for Storybook. **Hover never greys text out.** The
failure mode this rules out — `color: var(--fg-muted)` on hover — is the most
common way a dark UI quietly breaks.

`:focus-visible` is Safari 15.4. Ship a `:focus` fallback and reset it inside a
`@supports selector(:focus-visible)` block so 15.0 still gets a visible ring.

## 8. Component contract

The kit in `kitchen-terminal-k7-kit.html` is the normative spec. Summary:

- **Card** — the atom of the whole product. 2px inset `--border-strong` frame,
  a header row (`.hud-label` left, meta right), body, optional footer. Every
  card type in `layout.schema.yaml` (`weather`, `calendar`, `chat`, `recipes`,
  `shopping-list`, `timer`, `comic-of-the-day`, `ascii-art-of-the-day`,
  `carousel`, `grid`, `slideshow`, `clock`, `menu`, `audiometer`) is this
  shell plus a body.
- **Button** — three ranks. `primary` (solid amber, one per card),
  `ghost` (transparent, `--border-strong`), `text`. Plus `danger` as a ghost
  variant in `--fail`. Minimum height `--control-h-sm`; the card's main action
  uses `--control-h`.
- **Status badge** — bracket glyph + label + colour: `[OK]` teal, `[!]` warn,
  `[X]` fail, `[--]` muted. Never colour alone.
- **Field** — `--surface-sunken` well, 1px `--border`, focus promotes the border
  to `--border-strong` *and* adds the ring.
- **Data readout** — tabular figures, right-aligned numerals, `--fg-muted`
  label above, glance-tier value below.
- **Cursor** — the blinking `█`. One per screen, in the shell header. It is the
  system's heartbeat; multiplying it kills the effect and it is the first thing
  `prefers-reduced-motion` turns off.

## 9. Motion

`--motion-fast` 120ms (state changes) · `--motion-base` 200ms (panels, carousel)
· `--motion-slow` 400ms (slideshow crossfade). Easing `cubic-bezier(0.2,0,0,1)`.

**Animate `opacity` and `transform` only.** Never `box-shadow`, `filter`,
`backdrop-filter`, `width` or `height` — on an A8X those force paint on every
frame, on a display that is on 24 hours a day.

`prefers-reduced-motion: reduce` zeroes all three durations and holds the cursor
solid rather than blinking.

## 10. Theming contract

From `HANDOFF.md`: *"komponenty czytają wyłącznie tokeny/zmienne CSS, nigdy nie
zaszywają kolorów/fontów na sztywno."* Concretely:

1. A component's CSS may reference `var(--*)` from `tokens.css` and nothing else.
2. No hex literal, no `rgb()`, no font-family, no `px` radius may appear in a
   component. Sizes come from `--space-*`, `--text-*`, `--control-h*`.
3. Swapping the design = pointing `layout.yaml`'s `theme:` at another YAML file.
   `themes/daylight-lab.yaml` exists so this claim is testable, not aspirational.
4. Lint it. A CI grep for `#[0-9a-fA-F]{3,6}` outside `tokens.css` is enough to
   keep the contract honest, and it belongs in the Faza 0 CI job.

`theme.schema.v2.yaml` is a strict superset of the existing schema — every
current `retro-scifi.yaml` still validates. It adds: a `night` mode alongside
`light`/`dark`; the `border`, `borderStrong`, `signal`, `warn`, `focus` and
`accentFg` roles; explicit `states` for hover/active; the two-tier type scale;
spacing, control heights and motion; and `nightMode.schedule`.

## 11. Safari 15 budget

The baseline is **Safari 15.0**. This list is a build constraint, not a
preference.

**Do not ship**

| Feature | Available from | Instead |
|---|---|---|
| `color-mix()` | 16.2 | precomputed hex in `tokens.css` |
| `oklch()` in output CSS | 15.4 | OKLCH as design space, hex as delivery |
| `@container` | 16.0 | media queries |
| `:has()` | 15.4 | a state class on the ancestor |
| `subgrid` | 16.0 | explicit nested grid |
| `dvh` / `svh` / `lvh` | 15.4 | `vh` + `-webkit-fill-available` |
| `text-wrap: balance` | 17.5 | manual `<wbr>` / width limits |

**Ship with care** — `backdrop-filter` needs `-webkit-`; `:focus-visible` needs a
`:focus` fallback; `100vh` is wrong in standalone PWA mode; `aspect-ratio` and
flex `gap` are fine (15.0 and 14.1).

## 12. Anti-patterns

Specific to this product, in addition to the general ones:

- **Amber used as an alert colour.** Amber is the ink. An amber warning on an
  amber screen says nothing. Use `--warn` (hue 45).
- **A second solid button in one viewport for the same action.** One solid amber
  control. Everything else is ghost or text.
- **Rounded corners "just on this one component."** Radius is 0.
- **Soft drop shadows.** Elevation is border + surface step.
- **`--fg-muted` on hover.** Hover raises contrast; it never lowers it.
- **A grey neutral ramp.** Neutrals are warm (hue 84). A cool grey next to amber
  reads as a rendering bug.
- **Body text below 20px.** The wireframes' 11–13px is a desktop habit.
- **Scanlines on by default.** At 264 ppi a 1px repeating gradient moirés, and
  it costs a full-screen composite on every frame. Off unless someone asks, and
  then only inside card headers.
- **Emoji as functional icons.** The wireframes use 🎤 ✎ 🗑 as placeholders.
  Ship Tabler outline SVGs — `layout.schema.yaml` already names Tabler for
  `toggleIcon` and menu `icon`.
- **Presenter chrome.** No theme switcher, no debug panel, no "designed by" on a
  kitchen wall. Mode and density switch on schedule and in settings.

## 13. Voice

Polish, second person, terse. The machine reports; it does not chat.

Good: `POGODA // OPEN-METEO // 07:12` · `[AKTYWNE]` · `> 12:00 obiad rodzinny` ·
`kontekst: 4/40 wiadomości` · `cache: 24h // seed: 4821`

Avoid: exclamation marks, "Ups!", onboarding tone, marketing adjectives,
emoji in running text.

Labels uppercase, data lowercase, `//` as the separator between a source and its
timestamp, `>` as the log/event prefix, `[...]` around state.

---

## Open questions for the next session

1. ~~**IBM Plex Mono vs. `Courier New`.**~~ **Settled 2026-09-08: Source Code
   Pro.** The placeholder face is replaced, and with Source Code Pro rather than
   the Plex Mono this document originally proposed. §4.1 and the §4.2 table are
   rewritten to match.
2. **Night-mode schedule.** Fixed 22:00–06:00, or derived from Open-Meteo's
   sunrise/sunset for the configured location? The weather card already fetches
   it.
3. **`theme.schema.v2.yaml` adoption.** It is a superset, so nothing breaks, but
   the Faza 1 loader task grows. Adopt now or ship v1 and migrate?
4. **`--density: large`.** Wired into the tokens, but there is no UI to reach it.
   Settings screen, or a `layout.yaml` key?
