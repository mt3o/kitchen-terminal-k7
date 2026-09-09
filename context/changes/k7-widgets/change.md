# k7-widgets

```yaml
change_id: k7-widgets
memory_goal: 4c010fc9-9310-4776-9724-89559745db67
branch: change/k7-widgets
```

## What is real now

Three of the fourteen declared card types render for real. The other eleven still
say `[--] oczekuje na implementacje`, which is honest — a spinner that never
resolves is not, and on a wall display nobody is there to conclude it has hung.

| Card | Status |
|---|---|
| `weather` | live, cached, **shows its age** |
| `timer` | client-side, presets, pause/reset, warn on completion |
| `shopping-list` | live against its endpoints, grouped by category |
| `clock` | already real |
| the other ten | declared, not built — see below |

## Which ones could not be built, and why

- `calendar` needs OAuth2 (Faza 2), `chat` needs Kilo Gateway (Faza 4), `recipes`
  needs the import parser (Faza 3), `comic-of-the-day` and
  `ascii-art-of-the-day` are Faza 5. None of those integrations exist yet.
- `carousel`, `grid`, `slideshow`, `menu` are containers and controllers, and
  they are entangled with the accepted paged-grid work. Building them against the
  current single-page grid would mean building them twice.
- `audiometer` is buildable — Web Audio, no backend — and was left out only to
  keep this change reviewable.

## Weather is where the freshness work becomes visible

The backend answers with an age and a stale flag. The card renders both: `teraz`
when fresh, a real age otherwise, and when the backend calls it stale the card
switches to `warn` and says `dane sprzed …` instead of showing a number that
looks current. A temperature read from the doorway is taken as current whether or
not anything disclaims it, so the disclaimer has to be inside the readout.

## A shared shell, for a specific reason

`Card.svelte` is an ordinary Svelte component, not a second custom element:
slotting content across two shadow roots is the fiddly way to compose these, and
each widget is already its own custom element.

The reason it matters beyond tidiness is the token contract. The checker can only
prove that no component hardcodes a colour if the chrome they share lives in one
file. Thirteen copies of the card frame would be thirteen places for a hex
literal to appear.

## The bug worth remembering

A variable named `state` breaks **every** `$state` rune in the same component.
`$foo` is still store-subscription syntax, so `$state(...)` parses as a
subscription to the local `state`, and the compiler reports *"block-scoped
variable '$state' used before its declaration"* pointing at each rune rather than
at the name that caused it. The errors name the wrong line. `props`, `derived`
and `effect` are the same trap.

## Still true, and now more visible

The deck scrolls, and the bottom row is cut off at 1024×768. That is the accepted
paged-grid work, not a regression — but with real content in the cards it is
considerably more obvious than it was with placeholders.
