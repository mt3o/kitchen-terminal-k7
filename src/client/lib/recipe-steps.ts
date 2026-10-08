/**
 * The recipe detail view's method, as HTML safe for `{@html}`.
 *
 * `renderMarkdown` is the chat's renderer (shared/markdown.ts): raw HTML in the
 * source comes out escaped, links keep only http(s) hrefs, and only the tags
 * on its allowlist are ever emitted. `linkDurations` then runs over that
 * output, touching only text between tags and never text inside `<a>`,
 * `<code>` or `<pre>` — so "10 min" becomes a timer button, but a duration
 * inside a link label or inline code stays as written.
 */
import { linkDurations } from './chat-commands.ts'
import { renderMarkdown } from './markdown.ts'

export function renderRecipeSteps(stepsMarkdown: string): string {
  return linkDurations(renderMarkdown(stepsMarkdown))
}
