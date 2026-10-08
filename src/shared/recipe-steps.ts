/**
 * A Recipe's method is one Markdown document, `Recipe.stepsMarkdown`, written
 * by the household: section headings ("Ciasto", "Krem"), sub-lists, **bold**
 * warnings, links, and numbering only where they typed it.
 *
 * Until 2026-10-08 steps were `steps: string[]`, one plain-text line per step,
 * numbered by the `<ol>` that rendered them. That shape still arrives — from a
 * PWA bundle cached before the change, from a RecipeRejection saved before it,
 * from a SQLite row, and from every importer and model, whose sources hand
 * over an array. It is read as a numbered Markdown list, so an old recipe keeps
 * its visible order. Nothing on disk is rewritten to get there; a recipe file's
 * `## Kroki` section was always a numbered Markdown list already.
 *
 * Shared because both sides need it: the server normalises what it is sent,
 * the review form normalises a rejection it re-opens.
 */

/** One line per step: a line break inside a legacy step would end its list item. */
function oneLine(step: string): string {
  return step.replace(/\s+/g, ' ').trim()
}

/** `['Gotuj.', 'Podaj.']` → `1. Gotuj.\n2. Podaj.` — blank steps dropped, order kept. */
export function numberedSteps(steps: readonly string[]): string {
  return steps
    .map(oneLine)
    .filter(Boolean)
    .map((step, n) => `${n + 1}. ${step}`)
    .join('\n')
}

/**
 * The steps document carried by `input`: `stepsMarkdown` when it is a string,
 * else a legacy `steps` string array as a numbered list. `undefined` when
 * neither is usable — the caller decides whether that is an error (a save) or
 * an empty method (a rejection being re-opened).
 */
export function stepsMarkdownFrom(input: { stepsMarkdown?: unknown; steps?: unknown }): string | undefined {
  if (typeof input.stepsMarkdown === 'string') return input.stepsMarkdown.trim()
  if (Array.isArray(input.steps) && input.steps.every((s) => typeof s === 'string')) {
    return numberedSteps(input.steps as string[])
  }
  return undefined
}
