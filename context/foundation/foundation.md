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
| `design-system/DESIGN.md` + `tokens.css` + `theme.schema.v2.yaml` + the component kit | **OpenDesign project `kitchen-terminal-k7-design-system`** — see `design-bindings.md`; ⚠ not in this repo, not under version control |

## Captured nodes

Every node below is **mid-term** and a **lifetime-promotion candidate**. The agent
never promotes; the human does, in the GUI.

| Key | Type | Node | Facets | Statement (opening) |
|---|---|---|---|---|
| `A8X` | constraint | `716987ce` | platform, ui | The kiosk runs on an A8X with 2 GB RAM on a display that is never asleep, so per-frame cost is a design constraint rather than … |
| `AMBERINK` | constraint | `dffe0843` | ui | Amber is the ink, teal is the signal. |
| `BRACKETGLYPH` | constraint | `9b0e63ee` | a11y, ui | Colour never carries state alone in this UI: |
| `CONTRASTFLOORS` | constraint | `6d6046fc` | a11y, ui | Contrast floors for the kiosk: |
| `CONVSERVICE` | constraint | `4730c1bc` | ai, backend | ConversationService stays decoupled from the chat HTTP endpoint so the chat can later be driven by MCP or a dedicated skill ins… |
| `DISTANCES` | constraint | `7108856c` | a11y, ui | The kitchen terminal is read from three distances - the doorway at 3 m, the counter at 1 m, and the glass at 0.4 m with wet han… |
| `HOVERCONTRAST` | constraint | `aef51033` | a11y, ui | Hover raises contrast and never lowers it. |
| `ONESOLID` | constraint | `a827e6ec` | ui | A solid amber fill is the loudest thing the design system can say, so there is at most one solid amber control per card and one… |
| `RADIUSZERO` | constraint | `61c0030d` | ui | Radius is 0 everywhere with no exceptions, including inputs, chips and the scrim, and elevation is never a shadow: |
| `SAFARI15` | constraint | `0bc7e618` | frontend, platform | Safari 15.0 is the hard compile target for Kitchen Terminal K7, not a preference: |
| `SECRETS` | constraint | `ac006a24` | backend, security | The Google refresh token and the Kilo Gateway key are server-side only and never reach the frontend or the iPad. |
| `TOKENCONTRACT` | constraint | `79662ce5` | frontend, ui | Theming is an architectural rule in this project, not a preference: |
| `VISIBLEPHASE` | constraint | `7c574f65` | process | Every phase ends in something that can be looked at before the next one starts - Storybook for components, a real screen on the… |
| `WARNNOTAMBER` | constraint | `ff852de4` | a11y, ui | Warn and fail are never amber. |
| `CAMERALOCAL` | decision | `9ea20285` | security, ui | Presence-wake from the slideshow uses the camera, and every frame is processed locally in the browser - the image never leaves … |
| `GCAL` | decision | `c129f201` | integration | Google Calendar is integrated bidirectionally - read plus add, edit and delete - which forces OAuth2 with a stored refresh token; |
| `GLITCHTIP` | decision | `41ec3acd` | backend | Error tracking is GlitchTip, driven by the @sentry/node SDK because it is wire-compatible - so the project gets Sentry's SDK er… |
| `GWTOOLS` | decision | `18bafc37` | process | agentic-memory-system and graph-workflow are tools for working ON this project, not runtime dependencies of it: |
| `HEXAGONAL` | decision | `125f4071` | backend | The backend is hexagonal - ports and adapters with dependency injection - which is what lets the UI, the persistence layer and … |
| `KILO` | decision | `279d73e0` | ai, integration | AI traffic goes through Kilo Gateway: |
| `LAN` | decision | `d3faf49e` | backend, platform | The backend runs on a physical machine inside the home LAN rather than on the cloud VPS used for other projects, so nothing nee… |
| `OKLCHHEX` | decision | `cabf56d2` | platform, ui | Colours are derived in OKLCH at fixed hue and chroma, walking lightness until the WCAG target is met, and then written out as hex. |
| `SCHEMAV2` | decision | `012f356c` | ui | A v2 of the theme schema exists as a strict superset of v1 - every current theme file still validates - adding a night mode alo… |
| `SQLITE` | decision | `a815b136` | backend, data | SQLite is the database engine, chosen because the whole system is one machine on a LAN. |
| `SVELTE` | decision | `77925b30` | frontend | Frontend is Svelte 5 with components exported as custom elements rather than hand-written native JS. |
| `TWOWIDGETS` | decision | `e24b75ab` | integration, ui | The original cat-of-the-day idea is split into two separate card types rather than one: |
| `DENSITY` | issue | `156d8b7d` | ui | A large density mode is wired into the tokens but nothing in the product can reach it - there is no settings screen and no layo… |
| `GITFLOW` | issue | `8a963777` | process | The project has no settled git workflow and no repository yet. |
| `MIDDLEWARE` | issue | `7835061e` | backend, process | The middleware-pipe package name is already taken on npm, so a new name is needed before publication. |
| `NIGHTSCHED` | issue | `6eef8943` | ui | Night mode exists as a third luminance mode roughly nine times dimmer than dark while still clearing WCAG AA, but its schedule … |
| `PLEXMONO` | issue | `ee768ade` | ui | The design system replaces the Courier New placeholder with self-hosted IBM Plex Mono - taller x-height, unambiguous 0/O and 1/… |
| `SCHEMAV2ADOPT` | issue | `f42da1a9` | process, ui | Whether to adopt the v2 theme schema now or ship v1 and migrate later is unsettled. |
| `SWCACHE` | issue | `baefeee7` | frontend | The Service Worker aims at a full offline cache of app shell plus data, but dynamic data - calendar events, imported recipes - … |
| `TS7` | issue | `b6cc5895` | process | The stack assumes TypeScript 7 with the native Go compiler, but the plan was written before that shipped and assumed an RC arou… |
| `VIDATAFLUX` | issue | `40398c2a` | process | The vidataflux repository is empty and must either be filled in before it enters the stack or consciously written out of it. |
| `ZAKUPY` | issue | `6d5ae12d` | data, integration | The shopping list has two data sources, a local table inside K7 and a zakupy-api mode where K7 is just an additional display fo… |

## Facet vocabulary established by this pass

The graph was empty before this distillation, so these ten facet values *are* the
project's controlled vocabulary. Query recalls with these terms, not paraphrases;
adding an eleventh is a deliberate act, not a convenience.

`a11y` · `ai` · `backend` · `data` · `frontend` · `integration` · `platform` ·
`process` · `security` · `ui`

## Promotion list — for the human

Everything captured here is a lifetime candidate; that is the point of the pass.
Ranked by how much damage a sweep would do if it went dormant:

| Node | Why it must survive every sweep |
|---|---|
| `SAFARI15` | Every build-target, CSS and JS decision in the project is downstream of it. |
| `TOKENCONTRACT` | The one architectural rule that a single hardcoded hex silently breaks. |
| `SECRETS` | The only thing standing between the refresh token and a GlitchTip payload. |
| `AMBERINK` | Three other design constraints `DEPENDS_ON` it; without it they read as arbitrary. |
| `A8X` | Explains why half the CSS budget looks unreasonably strict. |
| `DISTANCES` | The derivation behind 20px body text; without it someone "fixes" it back to 16. |
| `HEXAGONAL` | Every adapter and port decision assumes it. |
| `CONVSERVICE` | A future MCP/skill-driven chat depends on this seam existing. |
| `SVELTE`, `SQLITE`, `LAN`, `KILO`, `GCAL`, `GLITCHTIP` | Settled stack choices with their reasons attached. |
| `CONTRASTFLOORS`, `WARNNOTAMBER`, `BRACKETGLYPH`, `HOVERCONTRAST`, `RADIUSZERO`, `ONESOLID`, `OKLCHHEX`, `SCHEMAV2` | The design system's normative layer — the rules a component review checks against. |
| `TWOWIDGETS`, `CAMERALOCAL`, `GWTOOLS`, `VISIBLEPHASE` | Decisions with rejected alternatives recorded; cheap to re-litigate wrongly. |

The ten `issue` nodes (`MIDDLEWARE`, `VIDATAFLUX`, `TS7`, `SWCACHE`, `ZAKUPY`,
`SCHEMAV2ADOPT`, `PLEXMONO`, `NIGHTSCHED`, `DENSITY`, `GITFLOW`) are **accepted
gaps, not candidates for lifetime** — they should close, and a closed issue that
went dormant is the system working.

## After promotion

```
memory_lifecycle.py deactivate foundation --sweep
```

Promoted nodes survive in the root set by design; anything declined goes dormant,
which is the correct verdict recorded.

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
