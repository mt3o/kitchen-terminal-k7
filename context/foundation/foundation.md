# Foundation scope — Kitchen Terminal K7

```yaml
memory_goal: 59472cdc-4531-4206-a9fc-968166c52250
change_anchor: 4dc8c4df-35ee-42b0-8443-b3c45f33e068
```

Written by `/gw-foundation`. The documents stay the source of truth for *reading*;
the graph is the source of truth for *being found*. Divergence between them is a
bug — fix it through the amendment flow, never by silently editing the store.

## Source documents distilled

| Document | Where |
|---|---|
| `HANDOFF.md` | `docs/handoff/` — context, decision log, deferred ideas |
| `PLAN.md` | `docs/handoff/` — Faza 0–6, per-task model assignments |
| `TECH-STACK.md` | `docs/handoff/` — stack choices, own/3rd-party libraries, caveats |
| `layout.schema.yaml`, `theme.schema.yaml`, `themes/retro-scifi.yaml` | `docs/handoff/` — the v1 contracts |
| `git-workflow.md`, `tracker.md` | `context/foundation/` — the two bindings the lifecycle was blocked on, settled 2026-09-08 |
| `design-system/` — `DESIGN.md`, `tokens.css`, `theme.schema.v2.yaml`, both themes, the component kit | repository root; the OpenDesign project of the same name is a byte-identical mirror — see `design-bindings.md` |

## Captured nodes

**Promotion pass run 2026-09-08** via `/gw-resolve` against the guided GUI API.
31 constraints and decisions are at **lifetime** tier; the 8 open `issue` nodes were
presented as candidates and deliberately left at **mid-term**, journaled `REVIEWED`.
Two issues are archived, superseded by ruling — see below.

| Key | Type | Node | Facets | Statement (opening) |
|---|---|---|---|---|
| `A8X` | constraint | `716987ce` | platform, ui | The kiosk runs on an A8X with 2 GB RAM on a display that is never asleep, so per-frame cost is a design constraint ra… |
| `AMBERINK` | constraint | `dffe0843` | ui | Amber is the ink, teal is the signal. |
| `BRACKETGLYPH` | constraint | `9b0e63ee` | a11y, ui | Colour never carries state alone in this UI: |
| `CONTRASTFLOORS` | constraint | `6d6046fc` | a11y, ui | Contrast floors for the kiosk: |
| `CONVSERVICE` | constraint | `4730c1bc` | ai, backend | ConversationService stays decoupled from the chat HTTP endpoint so the chat can later be driven by MCP or a dedicated… |
| `DISTANCES` | constraint | `7108856c` | a11y, ui | The kitchen terminal is read from three distances - the doorway at 3 m, the counter at 1 m, and the glass at 0.4 m wi… |
| `DUMPMERGE` | constraint | `36e6377e` | process | context/memory-graph.dump is marked -merge in .gitattributes so git never line-merges it. |
| `HOVERCONTRAST` | constraint | `aef51033` | a11y, ui | Hover raises contrast and never lowers it. |
| `ONESOLID` | constraint | `a827e6ec` | ui | A solid amber fill is the loudest thing the design system can say, so there is at most one solid amber control per ca… |
| `RADIUSZERO` | constraint | `61c0030d` | ui | Radius is 0 everywhere with no exceptions, including inputs, chips and the scrim, and elevation is never a shadow: |
| `SAFARI15` | constraint | `0bc7e618` | frontend, platform | Safari 15.0 is the hard compile target for Kitchen Terminal K7, not a preference: |
| `SECRETS` | constraint | `ac006a24` | backend, security | The Google refresh token and the Kilo Gateway key are server-side only and never reach the frontend or the iPad. |
| `TOKENCONTRACT` | constraint | `79662ce5` | frontend, ui | Theming is an architectural rule in this project, not a preference: |
| `VISIBLEPHASE` | constraint | `7c574f65` | process | Every phase ends in something that can be looked at before the next one starts - Storybook for components, a real scr… |
| `WARNNOTAMBER` | constraint | `ff852de4` | a11y, ui | Warn and fail are never amber. |
| `CAMERALOCAL` | decision | `9ea20285` | security, ui | Presence-wake from the slideshow uses the camera, and every frame is processed locally in the browser - the image nev… |
| `GCAL` | decision | `c129f201` | integration | Google Calendar is integrated bidirectionally - read plus add, edit and delete - which forces OAuth2 with a stored re… |
| `GITWORKFLOW` | decision | `a17b142e` | process | Work reaches main one branch at a time, through a pull request, and lands as a merge commit: |
| `GLITCHTIP` | decision | `41ec3acd` | backend | Error tracking is GlitchTip, driven by the @sentry/node SDK because it is wire-compatible - so the project gets Sentr… |
| `GWTOOLS` | decision | `18bafc37` | process | agentic-memory-system and graph-workflow are tools for working ON this project, not runtime dependencies of it: |
| `HEXAGONAL` | decision | `125f4071` | backend | The backend is hexagonal - ports and adapters with dependency injection - which is what lets the UI, the persistence … |
| `KILO` | decision | `279d73e0` | ai, integration | AI traffic goes through Kilo Gateway: |
| `LAN` | decision | `d3faf49e` | backend, platform | The backend runs on a physical machine inside the home LAN rather than on the cloud VPS used for other projects, so n… |
| `OKLCHHEX` | decision | `cabf56d2` | platform, ui | Colours are derived in OKLCH at fixed hue and chroma, walking lightness until the WCAG target is met, and then writte… |
| `SCHEMAV2` | decision | `012f356c` | ui | A v2 of the theme schema exists as a strict superset of v1 - every current theme file still validates - adding a nigh… |
| `SOURCECODE` | decision | `75d638bb` | ui | The monospace face is Source Code Pro, self-hosted as woff2 from the LAN backend at weights 400/500/600, replacing bo… |
| `SQLITE` | decision | `a815b136` | backend, data | SQLite is the database engine, chosen because the whole system is one machine on a LAN. |
| `SVELTE` | decision | `77925b30` | frontend | Frontend is Svelte 5 with components exported as custom elements rather than hand-written native JS. |
| `TRACKERBIND` | decision | `d44ca6f2` | process | Work state lives in GitHub Issues on the owner's personal account, at mt3o/kitchen-terminal-k7, with plain Issues rat… |
| `TWOWIDGETS` | decision | `e24b75ab` | integration, ui | The original cat-of-the-day idea is split into two separate card types rather than one: |
| `DENSITY` | issue | `156d8b7d` | ui | A large density mode is wired into the tokens but nothing in the product can reach it - there is no settings screen a… |
| `GITFLOW` ⚠ | issue | `8a963777` | process | The project has no settled git workflow and no repository yet. |
| `MIDDLEWARE` | issue | `7835061e` | backend, process | The middleware-pipe package name is already taken on npm, so a new name is needed before publication. |
| `NIGHTSCHED` | issue | `6eef8943` | ui | Night mode exists as a third luminance mode roughly nine times dimmer than dark while still clearing WCAG AA, but its… |
| `PLEXMONO` ⚠ | issue | `ee768ade` | ui | The design system replaces the Courier New placeholder with self-hosted IBM Plex Mono - taller x-height, unambiguous … |
| `SCHEMAV2ADOPT` | issue | `f42da1a9` | process, ui | Whether to adopt the v2 theme schema now or ship v1 and migrate later is unsettled. |
| `SWCACHE` | issue | `baefeee7` | frontend | The Service Worker aims at a full offline cache of app shell plus data, but dynamic data - calendar events, imported … |
| `TS7` | issue | `b6cc5895` | process | The stack assumes TypeScript 7 with the native Go compiler, but the plan was written before that shipped and assumed … |
| `VIDATAFLUX` | issue | `40398c2a` | process | The vidataflux repository is empty and must either be filled in before it enters the stack or consciously written out… |
| `ZAKUPY` | issue | `6d5ae12d` | data, integration | The shopping list has two data sources, a local table inside K7 and a zakupy-api mode where K7 is just an additional … |

## Settled since the first pass — 2026-09-08

Two `issue` nodes carry a `CONTRADICTED` event because the decision that answers
them makes their statement false. **They are flagged, not resolved** — clearing a
flag is a human act, and the flag is the system working.

| Superseded issue | Answered by | The settlement |
|---|---|---|
| `GITFLOW` ⚠ | `GITWORKFLOW`, `TRACKERBIND` | branch-per-change → PR → **merge commit, no squash**; GitHub Issues on `mt3o/kitchen-terminal-k7`, human closes |
| `PLEXMONO` ⚠ | `SOURCECODE` | the face is **Source Code Pro**, not IBM Plex Mono — the issue's premise (Courier New goes) was right, its replacement was not |

`DUMPMERGE` was captured alongside them: the dump is `-merge` protected in
`.gitattributes`, and the recovery `CLAUDE.md` documents (`agentic-memory sync
resolve`) **does not exist** in the installed CLI.

## Facet vocabulary established by this pass

The graph was empty before this distillation, so these ten facet values *are* the
project's controlled vocabulary. Query recalls with these terms, not paraphrases;
adding an eleventh is a deliberate act, not a convenience.

`a11y` · `ai` · `backend` · `data` · `frontend` · `integration` · `platform` ·
`process` · `security` · `ui`

## Promotion pass — settled

Ruled by the human in a `/gw-resolve` session, 2026-09-08. Recommendation and
choice agreed on every item; the API journaled each write as `gui-guided`.

**Promoted to lifetime — 31.** Every `constraint` and every `decision`. They now
survive every sweep, which is the whole point of a foundation pass.

| Group | Nodes |
|---|---|
| Platform floor | `SAFARI15` `A8X` `DISTANCES` `LAN` |
| Security | `SECRETS` |
| Design-system law | `TOKENCONTRACT` `AMBERINK` `ONESOLID` `WARNNOTAMBER` `BRACKETGLYPH` `OKLCHHEX` `RADIUSZERO` `CONTRASTFLOORS` `HOVERCONTRAST` `SCHEMAV2` `SOURCECODE` `DSHOME` |
| Architecture & stack | `HEXAGONAL` `SVELTE` `SQLITE` `CONVSERVICE` `GLITCHTIP` `GWTOOLS` |
| Integrations | `KILO` `GCAL` |
| Product decisions | `TWOWIDGETS` `CAMERALOCAL` |
| Process | `GITWORKFLOW` `TRACKERBIND` `VISIBLEPHASE` `DUMPMERGE` |

**Left at mid-term — 8.** `MIDDLEWARE` `VIDATAFLUX` `TS7` `SWCACHE` `ZAKUPY`
`SCHEMAV2ADOPT` `NIGHTSCHED` `DENSITY`. Open issues should *close*; pinning them at
lifetime would serve the open-questions list into every recall forever, including
long after the questions are answered.

**Archived by ruling — 2.** `GITFLOW` and `PLEXMONO`, both `superseded`, with
lineage recorded to `GITWORKFLOW` (`a17b142e`) and `SOURCECODE` (`75d638bb`).

## Do not sweep yet

`/gw-foundation` step 5 says to deactivate the foundation scope and sweep once
promotion is done. **That is wrong for this project right now.** The 31 promoted
nodes survive a sweep by design, but the 8 mid-term issues would go dormant — and
two of them (`MIDDLEWARE`, `VIDATAFLUX`) are the live blockers on Faza 0. Sweeping
would stop the project's own open questions from ranking into recall.

Keep the foundation scope active. Sweep when the issues have closed, not before.

## Handoff to `/gw-domain`

Terms met while distilling, as the starting inventory for domain modelling. They
are **not** captured as entities here — only a human ratifies an entity, and
entities never decay, so a careless one outlives every change that could correct it.

**Layout & shell:** Layout, Card, Sidebar, Menu, Slideshow, Carousel, Grid, Clock
**Card types:** Weather, Calendar, Chat, Recipes, ShoppingList, Timer,
ComicOfTheDay, AsciiArtOfTheDay, Audiometer
**Design:** Theme, Token, Mode (dark/light/night), Density, ReadTier, GlanceTier
**AI:** Conversation, Message, AiCall, ConversationService, RollingWindow, Compacting
**External:** KiloGateway, OpenMeteo, GoogleCalendar, GlitchTip, Zakupy
