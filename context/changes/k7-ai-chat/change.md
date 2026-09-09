# k7-ai-chat

status: implemented
created: 2026-09-09
epic: faza-4
memory_goal: 93ee78af-543c-4a73-b50b-a52755ce33fb
change_node: 048276b3-fcad-4800-a603-cb4e08628c89

## Goal
Deliver Faza 4 — AI chat via Kilo Gateway: model picker backed by GET /models,
a decoupled ConversationService doing rolling-window/per-model context budgeting
and compacting, an SSE chat endpoint, the K7Chat.svelte card with its Storybook
story, ai_calls logging for every gateway call, and a minimal cost-history view.
