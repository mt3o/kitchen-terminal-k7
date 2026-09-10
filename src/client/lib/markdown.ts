/**
 * A small, safe-by-construction Markdown-to-HTML renderer for chat messages.
 *
 * No `marked`/`dompurify` pair here: this is one card rendering streamed AI
 * output, not a general document renderer, and the project's own precedent
 * (see upstream/kilo.ts's docstring) is to hand-roll rather than pull in a
 * library for one narrow use. Safety comes from construction, not from
 * sanitizing afterward — every character of the input is HTML-entity-escaped
 * before any tag is generated, so the only `<`/`>` in the output are ones
 * this module wrote itself. `_snake_case_` is deliberately never read as
 * italic, since single-underscore emphasis mangles identifiers far more
 * often than a chat message actually means italics that way.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Bold, inline code and links, in that order — code first so `**`/`[` inside backticks is inert. */
function renderInline(escaped: string): string {
  let out = escaped.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  // href is restricted to http(s), no whitespace or ')' — the escape pass
  // above already turned any quote in the URL into &quot;, so there is no
  // way for this substitution to break out of the attribute.
  out = out.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  )
  return out
}

interface CodeBlock {
  lang: string
  code: string
}

/** Pulls fenced code blocks out before inline formatting runs, so `**`/`_` inside code is left alone. */
function extractCodeBlocks(escaped: string): { text: string; blocks: CodeBlock[] } {
  const blocks: CodeBlock[] = []
  const text = escaped.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const index = blocks.push({ lang, code: code.replace(/\n$/, '') }) - 1
    return ` CODE${index} `
  })
  return { text, blocks }
}

function renderBlock(block: string): string {
  const lines = block.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return ''

  // A fenced code block sitting alone in its own paragraph (the common case)
  // must not be wrapped in <p> — <pre> is a block element and a <p> around
  // it is invalid HTML that browsers "fix" by splitting it, leaving a stray
  // empty <p></p> behind. Left unwrapped here, restored below.
  const onlyLine = lines.length === 1 ? lines[0]?.trim() : undefined
  if (onlyLine !== undefined && /^CODE\d+$/.test(onlyLine)) return onlyLine

  if (lines.every((l) => /^[-*] +\S/.test(l))) {
    const items = lines.map((l) => `<li>${renderInline(l.replace(/^[-*] +/, ''))}</li>`).join('')
    return `<ul>${items}</ul>`
  }
  if (lines.every((l) => /^\d+\. +\S/.test(l))) {
    const items = lines.map((l) => `<li>${renderInline(l.replace(/^\d+\. +/, ''))}</li>`).join('')
    return `<ol>${items}</ol>`
  }
  return `<p>${lines.map(renderInline).join('<br>')}</p>`
}

/** Renders a chat message's Markdown to HTML safe to pass to `{@html ...}`. */
export function renderMarkdown(source: string): string {
  const escaped = escapeHtml(source)
  const { text, blocks } = extractCodeBlocks(escaped)

  const rendered = text
    .split(/\n{2,}/)
    .map(renderBlock)
    .join('')

  return rendered.replace(/ ?CODE(\d+) ?/g, (_match, i: string) => {
    const block = blocks[Number(i)]
    if (!block) return ''
    const langClass = block.lang ? ` class="lang-${block.lang}"` : ''
    return `<pre><code${langClass}>${block.code}</code></pre>`
  })
}
