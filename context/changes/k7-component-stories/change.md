# k7-component-stories

```yaml
memory_goal: a9a35af1-7025-4416-956b-8410f2286d9e
epic: faza-1
slice: 3
status: implemented
```

Stories for the four components built since Storybook landed. Weather and the
shopping list stub `fetch` per story, so every state is deterministic —
including weather's **stale** state, which is the one that proves the freshness
rule is visible rather than merely implemented. The audiometer never requests a
microphone: idle is its default story and the denied state comes from stubbing
`getUserMedia`, not from editing the component.

## The regression this slice found

`tokens.css` is now generated from the theme, with a CI drift check. It had
**already** diverged: five tokens the components use — the leadings, glance
tracking, control padding and the scrim — were missing from the generator, so
after the theme loader shipped they resolved to nothing on the live kiosk.

An unresolved custom property is silent: no error, no warning, the declaration
just drops. The only symptom was body text losing its line height. A test now
asserts the generator emits every `var(--*)` the component sources reference.

## And a scoping error in the checker

`check-token-contract.py` was scanning `src/` including the server, so it flagged
the theme generator — the one file whose job is to emit colour values. It now
scans components only; the generator's *output* is checked by the theme tests.
