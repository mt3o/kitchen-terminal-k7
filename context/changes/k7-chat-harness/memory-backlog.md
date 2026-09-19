# Memory backlog — k7-chat-harness

The agentic-memory store was unreachable for this whole session (2026-09-18):
the `agentic-memory-mcp` binary named in `.mcp.json` is not on PATH, and the
`agentic-memory` CLI is not installed either (`which` finds neither;
`~/.local/bin` has neither). Per CLAUDE.md's degraded-mode rule, every
would-be operation is queued here for replay when the surface returns.

## Pending: create_change
- change_id: k7-chat-harness
- goal: "Chat archive, /clear, chat→recipe drafts, file-backed recipe store
  outside the checkout, harness slash commands"
- parent_refs: k7-ai-chat (048276b3-fcad-4800-a603-cb4e08628c89),
  k7-recipes-shopping (goal 7aa1c37e-f2a8-44ad-9331-4e9029002f70)
- → write the returned id into change.md `memory_goal:`

## Pending: recall (not performed — run on replay, compare against plan.md)
- "recipe storage persistence outside deploy"
- "ConversationService decoupled chat endpoint"
- "review before save recipe import"
- "chat card model picker disabled mid conversation"

## Pending: domain_model() check
Not run (store unreachable). No new entity is proposed: "harness command",
"local line" and "recipe draft" are UI/process vocabulary, not domain. The
existing `Recipe`, `Conversation`, `Message`, `AiCall`, `ShoppingListItem`
entities are the ABOUT targets below.

## Pending: captures (three-part test applied; only these passed)

1. type: decision — ABOUT Recipe
   "Recipes are stored as one Markdown file per recipe in K7_RECIPES_DIR
   (default $XDG_DATA_HOME|~/.local/share/kitchen-terminal-k7/przepisy),
   outside the deployed checkout, via a second RecipeRepository adapter
   (adapters/files/recipes.ts). Chosen by the user over moving the SQLite file
   or dockerizing: the collection is hand-edited household data that deploy.sh's
   `git reset --hard` must never touch. The SQLite `recipes` table stays as the
   one-time migration source and rollback path."
   facets: persistence, deploy, recipes · parent: k7-recipes-shopping goal
2. type: invariant — ABOUT Recipe
   "The recipe-directory migration is guarded by a `.migrated-from-sqlite`
   marker file, not by 'directory is empty': deleting every recipe file must
   not resurrect them from SQLite on the next boot."
3. type: decision — ABOUT Recipe, Conversation, AiCall
   "/przepis extracts a recipe from an assistant message with an LLM call on
   the thread's own model (ai/recipe-drafter.ts), logged as AiCall purpose
   'recipe-extraction', and returns an UNSAVED draft into the recipes card's
   existing review form — the review-before-save invariant from
   k7-recipes-shopping holds for model output too."
4. type: decision — ABOUT Card
   "Cards talk only through window CustomEvents defined in
   client/lib/k7-events.ts; the receiver answers by writing into
   event.detail (dispatch is synchronous), so the sender can report 'no timer
   in the layout' / 'timer busy' honestly. Bringing a card on screen (pager +
   menu tab) is main.ts's job alone (k7-reveal → k7-menu-select)."
5. type: constraint — ABOUT Conversation, Message
   "Chat harness command output is a `local` line: rendered on the device,
   never sent to the model, never persisted. Prompt-template commands
   (/porcje, /lodowka, /pogoda) instead expand into an ordinary readable user
   Message, persisted exactly as sent — no hidden system prompt."
6. type: decision — ABOUT Conversation — CONTRADICTS whatever k7-ai-chat node
   recorded the model picker being locked once a thread exists (none found in
   the file corpus; check on replay)
   "The model can be switched mid-thread (PATCH /api/chat/conversations/:id,
   the picker, /model). Safe because the per-turn budget is recomputed from
   the current model's context length every turn."

## Pending: events (append_events on replay)
- NOTED: clampPercent treated JSON null ('' too) as 0 → a NaN margin from the
  client meant a 0% response reserve; now falls back to the default.
- NOTED: pre-existing repo list() applied `limit` before the tag filter; the
  file adapter filters first.
