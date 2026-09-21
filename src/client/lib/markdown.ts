/**
 * The chat's Markdown renderer lives in `shared/markdown.ts` (the server runs
 * the same parse to log refused constructs); re-exported here so `lib/`
 * modules keep importing their one HTML escaper from next door.
 */
export { escapeHtml, renderMarkdown } from '../../shared/markdown.ts'
