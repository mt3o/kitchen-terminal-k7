# k7-recipe-steps-markdown

status: open
created: 2026-10-08
tracker: github#102

## Goal
A Recipe's steps are one household-written Markdown document
(`Recipe.stepsMarkdown`), rendered XSS-safe by the chat's allowlist renderer
with duration timer buttons and no forced `<ol>` numbering, while the legacy
`steps: string[]` shape still loads as a numbered Markdown list.

## Why
GitHub issue #102: the household wants section headings ("Ciasto", "Krem"),
sub-lists, bold warnings and links in a recipe's method, and to number steps
themselves. The owner settled the open questions on 2026-10-08: one Markdown
document per recipe, no on-disk rewrite (legacy arrays read as `1. …`),
importers produce a numbered list, one raw-Markdown textarea in the review form,
reuse `src/shared/markdown.ts`, durations linked on the rendered output but
never inside `<a>`/`<code>`.

memory_goal: c7d65819-0bd7-4609-8d2b-e4e9386624c0
memory_change: aa90b0bf-41fc-47bb-b821-520c476415be
