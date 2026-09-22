# Notes for agents working on this repo

Written by agents, for the next one. `CLAUDE.md` is the contract — rules you
must follow. This is the opposite: the things that cost an afternoon, the logic
that does not read the way it behaves, and the tools worth reusing. Add to it
when something surprises you; correct it when it goes stale.

## 1. What can actually run, and where

`npm run check` = lint → token contract → tokens drift → tests → build. Each
piece has its own prerequisite, and they fail in unrelated ways:

| Needs | Or else |
|---|---|
| **Node ≥ 24** | `.ts` entry points are run directly (type stripping). Node 18/20 cannot start the server or the tests at all. |
| **A C toolchain** (`better-sqlite3`) | `npm ci` fails at install. Windows needs MSVC; Linux/WSL needs `make` + `gcc`. Without it there is no server and no DB-backed test — but everything front-end still works, see §5. |
| **`python3` on PATH** | `npm run lint:tokens` fails. Windows often has `python` but not `python3`. |
| **POSIX `grep`** | `test/theme.test.ts` shells out to it for the "no token resolves to empty" check. On bare Windows that one test errors; run the suite from WSL or Git Bash. |
| **POSIX paths** | `test/recipe-files.test.ts` asserts on XDG paths as strings (`/home/x/.local/share/…`). Three of its cases fail on win32 because `path.join` produces backslashes. That is the test being platform-specific, not a regression — check it still fails the same way on a clean tree before chasing it. |

Running the tests from WSL against a Windows checkout works and is the shortest
path on a Windows box:

```bash
cd /mnt/c/Users/<you>/…/kitchen-terminal-k7 && node --test test/theme.test.ts
```

`npm ci --ignore-scripts` installs everything except the native build, which is
enough for Vite, the theme generator, and every test that does not touch the
database.

## 2. Shadow DOM is the source of most surprises

Every widget is a Svelte **custom element**, so each has its own shadow root.

- **`app.css` cannot reach inside one.** Only custom properties cross the
  boundary — which is exactly why theming works, and why a global reset does
  not. `box-sizing: border-box` in `app.css` did *not* apply inside cards; for
  months every card was `2 × (padding + border)` taller than its grid cell and
  its bottom edge was clipped (fixed in #65, `test/shadow-box-sizing.test.ts`
  guards it). If you add a shadow-root component that sizes with `height: 100%`
  plus padding, set `box-sizing` in that component.
- **`[hidden]` loses to a shadow root's own `:host { display: … }`**, hence the
  `.page [hidden] { display: none !important }` rule in `app.css`. The `menu`
  card toggles sibling cards this way.
- **A custom property set on an element beats one it would inherit**, whatever
  the selector's specificity. That is how the themed header band re-inks
  everything inside it (`[data-region="header"]`) without any component
  knowing it is in a band.
- Light-DOM CSS that must affect a promoted card (fullscreen, slideshow)
  addresses the **host** element by id, not anything inside it.

## 3. Cards fit their cells exactly

Since #65 a card is exactly its grid cell. Every pixel added to a card's head —
a taller title, a bigger band, more padding — is a pixel taken from its body,
and most widgets scroll internally rather than clip (`.wrap` in weather,
shopping list, calendar, recipes, chat; `overflow: auto` in ascii art), so they
**hide the loss by scrolling** and a screenshot looks fine. The weather card's
three-day forecast row is the canary: if it is gone, something above it grew.
`scripts/theme-contrast.mjs` will not catch this — measuring
`scrollHeight - clientHeight` on those scrollers will, and it is worth doing
after any change to title size, leading, card padding or header height.

## 4. Things that behave unlike they read

- **`/theme.css` is generated per request** from the theme `layout.yaml` names,
  so editing a theme file needs no restart — but the *server process* caches
  nothing else either: changing `src/server/theme/generate.ts` does need one.
- **The service worker**: `/theme.css` is network-first (a theme change shows on
  the next load), theme assets are cache-first under a content-hashed URL, and
  `/api/*` is never cached. A stale-looking theme is almost always a stale
  build in `dist/`, not the worker.
- **Theme ids are filenames.** `catalogue.ts` maps id → file by listing the
  directory; a request can only ever name something already there. The picker
  is per tab (sessionStorage) and never changes the wall.
- **`/theme-assets/*` serves only paths the active theme declares.** Adding a
  file to a theme folder does not publish it; referencing it does.
- **`layout.local.yaml` is layered with the same keys as `layout.yaml`**
  (config-layers). Maps merge; a list replaces unless a sibling
  `<key>Strategy: union` says otherwise. It is the right way to try a theme or
  a private calendar id on one machine.
- **The calendar card has three fallbacks, and a 503 picks one of them.**
  `{code: 'not-configured'}` → the obviously-fake demo week; any other failure
  → a synthetic "error" day so one dead source cannot blank the merged tab;
  stale cache → the card goes `warn`. When mocking, choose deliberately which
  of those you want to look at.
- **`changelog/` is one file per entry** (`YYYY-MM-DD-NN-slug.yaml`). Never edit
  or renumber somebody else's; that directory exists because a single file
  conflicted on every same-day merge.
- **The memory store is usually unreachable** from anywhere but the main dev
  box (the MCP entry shells out to `sh`, and the CLI is not on PATH elsewhere).
  That is the documented degraded mode: queue what you would have captured in
  `context/changes/<id>/memory-backlog.md`. Several backlogs are waiting to be
  replayed.

## 5. Tools worth reusing

| Script | What it is for |
|---|---|
| `scripts/theme-preview.mjs` | Serves the **real** built client with canned data and the real generated token sheet — no database, no credentials. The fastest way to look at any front-end change; its `CANNED` map is also the closest thing to a list of which endpoints the cards call. |
| `scripts/theme-contrast.mjs` | Contrast measured on the pixels glyphs actually cover, per mode / page / backdrop. Exits non-zero below 4.5:1. |
| `scripts/build-tokens.mjs` | Regenerates `design-system/tokens.css` (Storybook reads it). `--check` is in `npm run check`. |
| `scripts/check-token-contract.py` | The "components read only tokens" lint. It strips comments first, because the prose describing the rule necessarily contains every pattern it bans. |
| `scripts/build-precache.mjs` | Builds the service worker's precache manifest from what the build actually emitted. |

For screenshots, drive an installed Chrome with `playwright-core`
(`npm i --no-save playwright-core`, then `executablePath`) — no 150 MB browser
download, and it works the same on Windows and Linux.

## 6. Verification habits that have paid for themselves

- **Screenshot-diff the default theme before and after any shared change.**
  Twice now that is what proved a "safe" refactor really was safe; both times
  the only differing pixels were the clock and live weather values, which is
  the expected noise.
- **Measure contrast on rendered pixels, not on token pairs.** Pictures,
  gradients, watermarks and `border-image` all sit between the ink and the
  colour the ratio was computed against.
- **Check all six pages and all three modes.** Failures cluster on the pages
  nobody looks at (SYSTEM, PRZEPISY) and in night mode.
- **Say what you did not verify.** Nothing in this repo has been tested on the
  actual iPad by an agent; Safari 15 is the floor and a desktop Chromium will
  happily render things it cannot.

## 7. Parts that are genuinely hard to read

Flagged honestly, so the next agent budgets for them rather than being
surprised:

- **`K7Chat.svelte` (~2k lines) plus `lib/chat-commands.ts`.** The command
  system, the MENU form builder, the recipe/shopping hand-offs and the
  streaming transcript are interleaved. They must be read together, and nothing
  smaller than "read both files end to end" seems to work.
- **Slideshow ↔ fullscreen-lock ↔ menu.** Three things toggle the same
  visibility state across shadow roots, one of them idle-driven, and the
  ownership rules (who may exit a fullscreen another one started) live in
  comments in `fullscreen-lock.ts`. Read those comments before changing any of
  the three.
- **The calendar's agenda/tab/merge logic** (`lib/calendar.ts` +
  `K7Calendar.svelte`): which events land in the merged GŁÓWNY tab, and which
  of the three fallbacks a given failure produces, is spread across both files.
- **`normaliseLayout` and the recursive card containers.** `cells` and `slides`
  nest arbitrarily, and several features (calendar lookup, local overrides,
  slideshow) each walk that tree separately with their own copy of the walk.
