# k7-theme-loader

```yaml
change_id: k7-theme-loader
memory_goal: e38777a4-339f-4aeb-8f3a-8a21daf671d0
epic: faza-1
slice: 1
branch: change/k7-theme-loader
status: implemented
```

## What was actually wrong

`layout.yaml` has carried a `theme:` key since the first commit, and it did
nothing. The client imported the committed `tokens.css` directly, so the
contract's central claim — *swapping the whole design is a matter of pointing
`theme:` at a different file* — had never been executed once.
`daylight-lab.yaml` exists in this repo for the sole purpose of proving that
claim, and had never been loaded.

## What it does now

The server reads the theme the layout names, generates the custom properties,
and serves them at `/theme.css`. Per request, so editing a theme file needs no
restart — the same rule the layout already followed.

Served from the root and **not** under `/api`, because it is shell rather than
data: the service worker keeps a copy so an offline paint has its colours, and
fetches it network-first so a theme change appears on the next load rather than
after a worker update.

## Demonstrated, on the deployment

`theme:` was pointed at `daylight-lab.yaml` on the live server, with no code
change and no restart:

| token | retro-scifi | daylight-lab |
|---|---|---|
| `--bg` | `#1a1712` | `#12161c` |
| `--accent` | `#faab2f` | `#6aa8f5` |
| `--radius` | `0px` | `8px` |
| `--font-ui` | Source Code Pro… | a different stack |

Every component followed, including inside shadow roots — custom properties
inherit through the boundary, which is what lets the contract hold across
encapsulation. `TOKENCONTRACT` now carries a `CONFIRMED` event citing this run.

## The generator is checked, not trusted

Moving from a hand-written stylesheet to a generated one must not change the
design, and that is only a claim unless something compares them. The tests read
the real theme file and the real `tokens.css` and assert that colours, the type
scale, shape and spacing all match — plus that the output stays inside the Safari
15 floor, and that a theme with no night mode falls back to dark rather than
emitting nothing.

## Not done

- `tokens.css` is still committed and is still what Storybook loads. It is now a
  build artifact in everything but name; the honest next step is to generate it
  there too, or delete it and have Storybook fetch the same route.
- The theme is not validated against `theme.schema.v2.yaml` at load time. A
  malformed theme produces a stylesheet with missing properties rather than a
  clear error.
