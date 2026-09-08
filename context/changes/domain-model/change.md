# domain-model

```yaml
change_id: domain-model
memory_goal: c20a2113-49de-4bca-ba51-610e4d574c0a
change_anchor: 177c4f41-cf9b-4a7c-b3ee-7b82855ba234
parent: 59472cdc-4531-4206-a9fc-968166c52250   # foundation
tracker: github            # no issue opened — this predates Faza 0 work items
branch: change/domain-model
status: awaiting-ratification
```

## What this change is

Model Kitchen Terminal K7's ubiquitous language as domain entities, extracted from
the written corpus **before** any production code mints its own names. Faza 0 will
start creating identifiers; whatever it picks becomes the de-facto language, so this
is the last moment the model can be set deliberately rather than inherited.

## Mode: brownfield

The domain is not in anyone's head — it is written down in
`docs/handoff/layout.schema.yaml` (600 lines, 14 card types, recursive containers),
the table list in `PLAN.md`, and `design-system/DESIGN.md`. So every proposal carries
a `file:line`, and the human reviewed the table before anything was captured rather
than after.

Greenfield elicitation would have been the wrong tool: it spends the user's attention
on questions the schema already answers.

## Outcome

- **15 entities**, all `proposed` — the ratification gate is open.
- **6 `DEPENDS_ON`** edges recording the aggregate structure.
- **40 `ABOUT`** edges attaching existing knowledge, so the entities are hubs rather
  than dictionary entries. `Theme` carries 17, `Card` 8.
- **4 artifacts** capturing the drift findings, which is the half of the pass that
  only this pass produces.

## Deliberately not modelled

External systems (`KiloGateway`, `OpenMeteo`, `GoogleCalendar`, `GlitchTip`,
`Zakupy` — the strongest candidate of the five), design-token roles, the card types
that are pure enum members, and `ShoppingList` as a container distinct from its items.

That list is the agenda for the next pass. It is deliberately shorter than it could
be: an entity captured "to be thorough" ranks in every future recall on that
territory and is never swept, while under-modelling is recoverable in one call.
