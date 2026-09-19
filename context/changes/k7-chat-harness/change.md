# k7-chat-harness

status: in-review
created: 2026-09-18
memory_goal: pending — agentic-memory store unreachable this session (no
  `agentic-memory-mcp` binary, no `agentic-memory` CLI on PATH); every
  would-be operation is queued in `memory-backlog.md` for replay.
branch: claude/ai-chat-recipe-archive-9c8a28
design_surface: k7-chat-card

## Goal
Turn the CZAT.AI card from a single throwaway thread into a small kitchen
harness:

- **Archive** — past conversations are listed, reopened, renamed and deleted
  from the card itself (they were always persisted; nothing could reach them).
  The card resumes the conversation this device last had open after a reload.
- **`/clear` + a NOWA button** — start a fresh context; the old thread stays in
  the archive.
- **Chat → recipes** — `/przepis` turns the last AI answer into a recipe draft
  (LLM extraction) and opens it in BAZA.PRZEPISY's existing review-before-save
  form. Nothing is saved unreviewed.
- **Recipes live outside the deployed checkout** — one Markdown file per
  recipe in `K7_RECIPES_DIR` (default
  `~/.local/share/kitchen-terminal-k7/przepisy`), hand-editable, surviving any
  redeploy; the SQLite `recipes` rows are copied there once on boot.
- **Harness commands** — `/zakupy`, `/minutnik N`, `/porcje N`, `/lodowka`,
  `/pogoda`, `/context`, `/model`, `/koszt`, `/tytul`, `/archiwum`, `/pomoc`,
  with a tappable command-chip row (typing `/` on the iPad keyboard is fiddly).

## Asked and answered (2026-09-18)
- "Maintained outside the docker image": K7 is not containerised (git
  checkout + systemd user unit). The user chose **recipe files in an external
  directory** over moving the SQLite file or dockerizing.
- Command set: the user took every proposed group and added `/context` (window
  usage vs. reserved response budget) and `/pogoda` (weather insights).
