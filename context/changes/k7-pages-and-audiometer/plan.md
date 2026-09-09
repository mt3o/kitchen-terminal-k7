# plan — k7-pages-and-audiometer

Written because `/gw-goal` refuses to run without one: a headless loop with no
per-phase verification command is drift with a progress bar.

Every phase below states what "done" means as something a machine can check.

## Phase 1 — two more pages

`layout.yaml` grows from 2 pages to 4. New pages carry cards that already exist
as types so nothing renders as a lie.

**Verify:** `curl -s .../api/layout | jq '.pages | length'` is `4`, and a
headless render reports zero overflow at 1024×768 with 4 indicator dots.

## Phase 2 — the shopping list occupies a full column

The card spans the full height of its grid column rather than sharing the column
with another card.

**Verify:** the rendered `k7-shopping-list` element's `gridRow` resolves to a
span covering every row of its page, and its measured height is within 2px of the
page's content height.

## Phase 3 — audiometer

`k7-audiometer` custom element implementing `params.audiometer` from the layout
contract: current level, histogram over `historyDurationSeconds`, `dB` or
`percent`, optional `warningThreshold`. Web Audio, microphone, no backend.

Permission is the interesting part: a kiosk cannot prompt on load and must say
what it needs rather than showing a dead card.

**Verify:** `npm run check` green with new unit tests covering the pure parts
(level→percent conversion, dB conversion, histogram windowing, threshold
crossing); the card renders its permission state headlessly without a microphone.

## Phase 4 — the logo assets

The icons are **already** used: `public/apple-touch-icon*.png` and the manifest
icons were derived from `logo-main.png`. What is missing is the piece iOS
actually needs and does not have: `apple-touch-startup-image`, so a home-screen
launch shows the splash rather than a white flash.

**Verify:** `logo-splash` derivative exists in `public/`, is referenced from
`index.html`, is served 200 by the deployment, and the token-contract check still
passes.

## Refused, and why

**"proceed with rest of the Faza"** — 36 open tasks across Faza 1–6. Several are
blocked on integrations that do not exist (`calendar` needs OAuth2, `chat` needs
Kilo Gateway, `recipes` needs the import parser). A headless loop cannot pick a
scope from that, and a stop condition of "the rest" is the one the skill names as
disqualifying. It needs slicing, which is a human ruling.

**"make use of the images"** beyond phase 4 — the remaining uses are design
choices (a mark in the shell header? a watermark?), and there is no command that
says whether one was made well.
