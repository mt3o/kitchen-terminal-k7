/**
 * A web page as the plain, structured text a model reads best.
 *
 * The deterministic extractors guess which list is which from the markup, and
 * a page whose author left a blank line, a stray <br>, or an ad block in the
 * middle of the method fools them (ingredients ending up as steps, steps
 * dropped). A model does not need the markup — it needs the words in reading
 * order with just enough structure to tell a heading from a list item — so
 * that is all this keeps: headings as `## `, list items as `- `, one block per
 * line, and none of the chrome (scripts, navigation, footers, comment forms).
 */
import { JSDOM } from 'jsdom'

/** A recipe page is a few KB of words; the rest of a long page is comments and related links. */
export const PAGE_TEXT_MAX_CHARS = 24_000

const SKIPPED = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'NAV', 'FOOTER', 'ASIDE', 'FORM', 'BUTTON', 'SELECT', 'TEMPLATE',
])
const BLOCK = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'UL', 'OL', 'TABLE', 'TR', 'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD', 'HEADER',
])

export function pageToText(html: string, sourceUrl?: string): string {
  const dom = new JSDOM(html, sourceUrl ? { url: sourceUrl } : undefined)
  try {
    const doc = dom.window.document
    const title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? doc.title
    const out: string[] = []
    let line = ''
    const flush = (): void => {
      const t = line.replace(/\s+/g, ' ').trim()
      if (t) out.push(t)
      line = ''
    }

    const walk = (node: Node): void => {
      if (node.nodeType === 3) {
        line += node.textContent ?? ''
        return
      }
      if (node.nodeType !== 1) return
      const el = node as Element
      const tag = el.tagName.toUpperCase()
      if (SKIPPED.has(tag) || el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return
      if (tag === 'BR') return flush()
      const heading = /^H([1-6])$/.exec(tag)
      if (heading) {
        flush()
        line = '## '
        el.childNodes.forEach(walk)
        return flush()
      }
      if (tag === 'LI') {
        flush()
        line = '- '
        el.childNodes.forEach(walk)
        return flush()
      }
      const block = BLOCK.has(tag)
      if (block) flush()
      el.childNodes.forEach(walk)
      if (block) flush()
    }
    walk(doc.body ?? doc.documentElement)
    flush()

    const text = [title.trim() ? `TITLE: ${title.trim()}` : '', ...out].filter(Boolean).join('\n')
    return text.length > PAGE_TEXT_MAX_CHARS ? `${text.slice(0, PAGE_TEXT_MAX_CHARS)}\n[…truncated]` : text
  } finally {
    dom.window.close()
  }
}
