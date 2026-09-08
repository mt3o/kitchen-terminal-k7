# k7-storybook

```yaml
change_id: k7-storybook
memory_goal: f57f3370-4f98-4aa5-abb9-e69c1b88472d
change_anchor: 85e8cb61-7fe3-44fe-8740-60e7be03d051
parent:
  - 3a29eee2-0cb0-4688-8e53-92c9a2b0c08e   # k7-persistence
  - 59472cdc-4531-4206-a9fc-968166c52250   # foundation
epic: faza-0
slice: 4
mode: headless
tracker: github
branch: change/k7-storybook
```

## What this delivers

Storybook 10 on the **web-components** renderer, four stories for `<k7-card>`,
all three luminance modes switchable from the toolbar, and a CI step that builds
it.

`npm run storybook` · `npm run build:storybook`

## Why web-components and not Svelte

The components ship as custom elements. That is what the app loads and what a
consumer gets, so that is what the stories drive.

Using the Svelte renderer would exercise a form of the component the product
never uses — and would stop catching the exact failure that already happened in
slice 1: a build where `customElement` was silently dropped, the element was
never registered, the screen was blank and the build stayed green. Driving the
registered element means a story that renders nothing has caught something real.

## The three modes are the point

`dark`, `light` and `night` switch from the toolbar via `data-mode`, and the
token sheet is loaded before anything renders. `night` is roughly nine times
dimmer than `dark` and still clears WCAG AA — nobody is going to notice it is
broken at 06:00, so it needs somewhere to be looked at on purpose.

Verified rather than eyeballed: the attribute flips for all three, and each
selects a genuinely different `--fg`/`--bg` pair.

| mode | `--fg` | `--bg` |
|---|---|---|
| dark | `#faab2f` | `#1a1712` |
| light | `#2c2c2a` | `#f4f2ec` |
| night | `#cd8817` | `#050301` |

## The trap this hit

Storybook detects Svelte and configures `vite-plugin-svelte` **itself**. A
`viteFinal` hook that adds the plugin again compiles every component twice; the
second pass feeds the compiler its own generated output and fails *inside the
component* with a tag-name error. The file it names is innocent, which is what
makes it expensive — the fix is to check the plugin list, not the component.

## Verified

| | |
|---|---|
| `npm run check` | exit 0, 18/18 tests |
| `npm run build:storybook` | exit 0 |
| Stories rendered headlessly | custom element registers, tokens resolve |
| `dark` / `light` / `night` | attribute flips, tokens differ |

## Not done

- One component has stories. The other thirteen card types do not exist yet, so
  there is nothing to write stories against.
- No visual-regression or a11y addon. Both are worth having once there is more
  than one component to regress.
- Storybook is not deployed anywhere — it builds in CI and is thrown away.
