/**
 * TRANSITIONAL — drop once every client has loaded a bundle with
 * stepsMarkdown, i.e. one deploy after the one that introduced it (#102).
 *
 * The wall iPad keeps its old JS for days after a deploy: the service worker
 * takes over (skipWaiting + clients.claim) but nothing reloads the page. That
 * old K7Recipes reads `detail.steps.length`, `{#each detail.steps}` and
 * `recipe.steps.join('\n')`, so a recipe response without `steps` throws in
 * its detail view and review form. Every recipe-shaped API response
 * therefore also carries `steps`: the non-empty source lines of
 * stepsMarkdown. A numbered list then shows as its own source lines
 * ("1. Gotuj.") — readable, not pretty, and only until the kiosk reloads.
 *
 * Responses only, never storage. New client code must not read `steps`.
 */

/** The non-empty, trimmed lines of a steps document, in order. */
export function legacyStepLines(stepsMarkdown: string): string[] {
  return stepsMarkdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** `recipe` plus the transitional `steps` array, for an API response. */
export function withLegacySteps<T extends { stepsMarkdown: string }>(recipe: T): T & { steps: string[] } {
  return { ...recipe, steps: legacyStepLines(recipe.stepsMarkdown) }
}
