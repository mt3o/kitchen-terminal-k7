/**
 * Markdown-to-HTML for chat messages, on a closed tag allowlist.
 *
 * `marked` does the parsing (CommonMark + GFM: tables, nested and loose
 * lists, a list starting right under a paragraph line) — the hand-rolled
 * renderer this replaced split on blank lines and so rendered most real
 * answers as flat paragraphs full of literal `###`, `|` and `1.`.
 *
 * Safety is still by construction rather than by sanitizing afterward: every
 * renderer that could carry text or an attribute from the input is either
 * marked's own escaping one or overridden here, and raw HTML is never passed
 * through — it comes out escaped, as visible text. The only tags in the output
 * are the ones in `ALLOWED_TAGS`, and the only attributes are `href` (http/https
 * only), `target`, `rel`, `start` on `<ol>` and a `class` from a fixed set.
 *
 * Constructs outside the allowlist are refused, not dropped: they still show,
 * degraded to text, and `refusedMarkdown` names them so the server can log a
 * model that keeps emitting them (routes/chat.ts → the issue log).
 *
 * Shared rather than client-only because the server runs the same parse to
 * produce that log line; it has no DOM dependency.
 */
import { Marked, type Token, type Tokens } from 'marked'

/** Every tag `renderMarkdown` can emit. `test/markdown.test.ts` checks output against it. */
export const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'a',
  'ul', 'ol', 'li', 'blockquote', 'hr',
  'h3', 'h4', 'h5', 'h6',
  'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
] as const

/** One word per kind of refused construct — what the issue-log line lists. */
export type RefusedKind = 'html' | 'image' | 'link-scheme' | 'task-list'

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const SAFE_HREF = /^https?:\/\//i
/** `<br>` is the one raw tag models use as markup rather than as content — a line break inside a table cell — and it is already on the allowlist. */
const BR_TAG = /^<br\s*\/?>$/i
const ALIGN_CLASS = { left: 'al-l', center: 'al-c', right: 'al-r' } as const

const marked = new Marked({
  gfm: true,
  // A single newline is a line break, as it was before marked: chat answers
  // are written line by line, not reflowed prose.
  breaks: true,
  renderer: {
    // Raw HTML, block or inline, is shown as the text the model wrote.
    html({ text }) {
      return BR_TAG.test(text.trim()) ? '<br>' : escapeHtml(text)
    },
    // No network fetch from inside a chat bubble on the kiosk: the alt text stands in.
    image({ text }) {
      return escapeHtml(text)
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens)
      if (!SAFE_HREF.test(href)) return label
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
    },
    // `- [ ]` items keep their state as a glyph, not as an <input>.
    checkbox({ checked }) {
      return checked ? '☑ ' : '☐ '
    },
    // A chat bubble has no room for document-sized headings: `#` and `##` render as `###`.
    heading({ tokens, depth }) {
      const level = Math.max(3, depth)
      return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`
    },
    code({ text, lang }) {
      const safeLang = lang && /^[a-zA-Z0-9_+-]+$/.test(lang) ? ` class="lang-${lang}"` : ''
      return `<pre><code${safeLang}>${escapeHtml(text.replace(/\n$/, ''))}</code></pre>\n`
    },
    // `_word_` stays literal, so a stray pair of underscores in an identifier
    // or file name is never italicised; `*word*` is the italic spelling.
    em({ raw, tokens }) {
      const inner = this.parser.parseInline(tokens)
      return raw.startsWith('_') ? `_${inner}_` : `<em>${inner}</em>`
    },
    // Wrapped so a wide table scrolls inside the bubble instead of widening
    // it; alignment as a class, since an inline style would bypass the theme.
    table(token) {
      const cell = (c: Tokens.TableCell): string => {
        const tag = c.header ? 'th' : 'td'
        const cls = c.align ? ` class="${ALIGN_CLASS[c.align]}"` : ''
        return `<${tag}${cls}>${this.parser.parseInline(c.tokens)}</${tag}>`
      }
      const head = `<thead><tr>${token.header.map(cell).join('')}</tr></thead>`
      const rows = token.rows.map((row) => `<tr>${row.map(cell).join('')}</tr>`).join('')
      const body = rows ? `<tbody>${rows}</tbody>` : ''
      return `<div class="md-table"><table>${head}${body}</table></div>\n`
    },
  },
})

/** Renders a chat message's Markdown to HTML safe to pass to `{@html ...}`. */
export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false })
}

/**
 * Which refused constructs `source` contains, each kind once, in first-seen
 * order. Empty for a message that rendered entirely within the allowlist.
 */
export function refusedMarkdown(source: string): RefusedKind[] {
  const found = new Set<RefusedKind>()
  const visit = (tokens: Token[]): void => {
    for (const t of tokens) {
      if (t.type === 'html' && !BR_TAG.test((t as Tokens.HTML).text.trim())) found.add('html')
      else if (t.type === 'image') found.add('image')
      else if (t.type === 'link' && !SAFE_HREF.test((t as Tokens.Link).href)) found.add('link-scheme')
      else if (t.type === 'list_item' && (t as Tokens.ListItem).task) found.add('task-list')
      const children = (t as { tokens?: Token[] }).tokens
      if (children) visit(children)
      if (t.type === 'list') visit((t as Tokens.List).items as Token[])
      if (t.type === 'table') {
        const table = t as Tokens.Table
        for (const c of [...table.header, ...table.rows.flat()]) visit(c.tokens)
      }
    }
  }
  visit(marked.lexer(source))
  return [...found]
}
