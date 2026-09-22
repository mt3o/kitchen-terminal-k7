/**
 * The chat markdown renderer's contract: output contains only tags from
 * `ALLOWED_TAGS` and only allowlisted attributes, raw HTML in the input comes
 * out escaped, and the shapes real model answers use (headings, tables, lists
 * right under a line of text, multi-line list items) render as structure
 * rather than as literal `###`, `|` and `1.`.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ALLOWED_TAGS, refusedMarkdown, renderMarkdown } from '../src/shared/markdown.ts'

/** Excerpts of real answers from the household's chat, the shapes the old renderer flattened. */
const REAL_ANSWERS = {
  numberedWithContinuation:
    'Jeśli chodzi o **smak/goryczkę** w napoju lub deserze:\n\n' +
    '1. **Tonic water** — zamiast **100 ml płynu z chininą** użyj **100 ml tonic water**.  \n' +
    '   Smak będzie najbliższy: gorzko-cytrynowy.\n\n' +
    '2. **Bitter lemon** — użyj **100 ml bitter lemon**.  \n' +
    '   Zyskasz bardziej wyraźną cytrynowo-gorzką nutę.',
  headingsAndListUnderText:
    '### Domowy tonik — przepis na syrop do rozcieńczania\n\n' +
    '#### Składniki  \n' +
    'Na ok. 500 ml syropu:\n\n' +
    '- 500 ml wody  \n' +
    '- 10–15 g kory chinowca — **spożywczej, z pewnego źródła**  \n\n' +
    '#### Przygotowanie\n\n' +
    '1. Do garnka wlej wodę.  \n' +
    '2. Doprowadź do wrzenia.',
  table:
    'Dla przepisu na ok. **500 ml syropu** możesz użyć:\n\n' +
    '| Zamiennik | Proporcja | Jak zmieni się smak |\n' +
    '|---|---:|---|\n' +
    '| **Korzeń goryczki suszony** | **3–5 g** | Da mocną, suchą goryczkę. |\n' +
    '| **Skórki gorzkiej pomarańczy** | **10–15 g** | Łagodniejszy. |',
}

const ALLOWED_ATTRIBUTES: Record<string, (value: string) => boolean> = {
  href: (v) => /^https?:\/\//.test(v),
  target: (v) => v === '_blank',
  rel: (v) => v === 'noopener noreferrer',
  start: (v) => /^\d+$/.test(v),
  class: (v) => /^(md-table|al-[lcr]|lang-[a-zA-Z0-9_+-]+)$/.test(v),
}

/** Fails on any tag or attribute outside the allowlist. */
function assertWithinAllowlist(html: string): void {
  for (const [, name, attrs] of html.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)) {
    assert.ok((ALLOWED_TAGS as readonly string[]).includes(name!.toLowerCase()), `tag <${name}> not allowed in: ${html}`)
    for (const [, attr, value] of attrs!.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
      const check = ALLOWED_ATTRIBUTES[attr!]
      assert.ok(check?.(value!), `attribute ${attr}="${value}" not allowed in: ${html}`)
    }
  }
}

/** Collapses the newlines marked puts between block tags, so expectations read as one line. */
function render(source: string): string {
  return renderMarkdown(source).replace(/>\n+/g, '>').trim()
}

describe('renderMarkdown safety', () => {
  it('escapes a literal tag instead of letting it through', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    assert.ok(!out.includes('<script>'))
    assert.ok(out.includes('&lt;script&gt;'))
  })

  it('escapes inline raw HTML inside a paragraph', () => {
    assert.equal(render('a <b onclick="x()">b</b>'), '<p>a &lt;b onclick=&quot;x()&quot;&gt;b&lt;/b&gt;</p>')
  })

  it('escapes an attribute-breakout attempt inside a link', () => {
    const out = renderMarkdown('[click "me](http://evil.example/"onmouseover=1)')
    assert.ok(!out.includes('"me'))
    assert.ok(!out.includes('"onmouseover'))
    assertWithinAllowlist(out)
  })

  it('never renders a javascript:, data: or mailto: URL as a link', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.example']) {
      assert.equal(render(`[click](${href})`), '<p>click</p>')
    }
  })

  it('renders an image as its alt text, never as <img>', () => {
    assert.equal(render('![zdjęcie](http://x.example/a.png)'), '<p>zdjęcie</p>')
  })

  it('renders a task list as glyphs, never as <input>', () => {
    assert.equal(render('- [ ] kupić\n- [x] ugotować'), '<ul><li>☐ kupić</li><li>☑ ugotować</li></ul>')
  })

  it('keeps every real answer within the tag and attribute allowlist', () => {
    for (const source of Object.values(REAL_ANSWERS)) assertWithinAllowlist(renderMarkdown(source))
  })
})

describe('renderMarkdown formatting', () => {
  it('renders bold and inline code', () => {
    assert.equal(render('this is **bold** and `code`'), '<p>this is <strong>bold</strong> and <code>code</code></p>')
  })

  it('never italicises underscores, in or around identifiers', () => {
    assert.equal(render('use my_variable_name and _snake_case_ here'), '<p>use my_variable_name and _snake_case_ here</p>')
  })

  it('renders *single asterisks* as italics', () => {
    assert.equal(render('to *ważne*'), '<p>to <em>ważne</em></p>')
  })

  it('renders a fenced code block untouched by inline formatting', () => {
    assert.equal(render('```js\nconst x = **not_bold**\n```'), '<pre><code class="lang-js">const x = **not_bold**</code></pre>')
  })

  it('leaves text that looks like the old code-block placeholder alone', () => {
    assert.equal(render('CODE0 and CODE12 are just words'), '<p>CODE0 and CODE12 are just words</p>')
  })

  it('renders a safe http link', () => {
    assert.equal(
      render('[docs](https://example.com/a)'),
      '<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer">docs</a></p>',
    )
  })

  it('joins consecutive lines in one paragraph with <br>', () => {
    assert.equal(render('line one\nline two'), '<p>line one<br>line two</p>')
  })

  it('separates blank-line paragraphs', () => {
    assert.equal(render('first\n\nsecond'), '<p>first</p><p>second</p>')
  })

  it('renders a list that starts right under a line of text', () => {
    assert.equal(render('Składniki:\n- mąka\n- cukier'), '<p>Składniki:</p><ul><li>mąka</li><li>cukier</li></ul>')
  })

  it('renders every heading level at h3 or smaller', () => {
    assert.equal(render('# Duży\n## Średni\n#### Mały'), '<h3>Duży</h3><h3>Średni</h3><h4>Mały</h4>')
  })

  it('renders a heading with a list under it, from a real answer', () => {
    const out = render(REAL_ANSWERS.headingsAndListUnderText)
    assert.ok(out.startsWith('<h3>Domowy tonik — przepis na syrop do rozcieńczania</h3><h4>Składniki</h4>'), out)
    assert.match(out, /<ul><li>500 ml wody\s*<\/li>/)
    assert.match(out, /<h4>Przygotowanie<\/h4><ol><li>Do garnka wlej wodę\.\s*<\/li>/)
    assert.ok(!out.includes('#'), out)
  })

  it('keeps a numbered item with a continuation line as one list item, from a real answer', () => {
    const out = render(REAL_ANSWERS.numberedWithContinuation)
    assert.equal((out.match(/<ol>/g) ?? []).length, 1, out)
    assert.equal((out.match(/<li>/g) ?? []).length, 2, out)
    assert.ok(out.includes('<br>Smak będzie najbliższy'), out)
  })

  it('renders a table with column alignment as a class, from a real answer', () => {
    const out = render(REAL_ANSWERS.table)
    assert.ok(out.includes('<div class="md-table"><table><thead><tr><th>Zamiennik</th><th class="al-r">Proporcja</th>'), out)
    assert.ok(out.includes('<td><strong>Korzeń goryczki suszony</strong></td><td class="al-r"><strong>3–5 g</strong></td>'), out)
    assert.ok(!out.includes('|'), out)
  })

  it('turns a <br> inside a table cell into a line break', () => {
    assert.ok(render('| a |\n|---|\n| x<br>y |').includes('<td>x<br>y</td>'))
  })

  it('renders a blockquote, a rule and strikethrough', () => {
    assert.equal(render('> cytat\n\n---\n\n~~stare~~'), '<blockquote><p>cytat</p></blockquote><hr><p><del>stare</del></p>')
  })

  it('numbers an ordered list from its first marker', () => {
    assert.equal(render('3. trzy\n4. cztery'), '<ol start="3"><li>trzy</li><li>cztery</li></ol>')
  })
})

describe('refusedMarkdown', () => {
  it('finds nothing in answers within the allowlist', () => {
    for (const source of Object.values(REAL_ANSWERS)) assert.deepEqual(refusedMarkdown(source), [])
    assert.deepEqual(refusedMarkdown('| a |\n|---|\n| x<br>y |'), [])
  })

  it('names each refused kind once, in first-seen order', () => {
    const source = '<div>x</div>\n\n![a](http://x.example/a.png) i ![b](http://x.example/b.png)\n\n[m](mailto:a@b.example)\n\n- [ ] zadanie'
    assert.deepEqual(refusedMarkdown(source), ['html', 'image', 'link-scheme', 'task-list'])
  })

  it('finds refused constructs nested in lists and table cells', () => {
    assert.deepEqual(refusedMarkdown('- a\n  - <i>b</i>'), ['html'])
    assert.deepEqual(refusedMarkdown('| a |\n|---|\n| ![x](http://x.example/x.png) |'), ['image'])
  })
})
