/**
 * The chat markdown renderer's safety contract: every character is
 * HTML-escaped before any tag is generated, so no input can inject a tag
 * this module did not itself write.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { renderMarkdown } from '../src/client/lib/markdown.ts'

describe('renderMarkdown safety', () => {
  it('escapes a literal tag instead of letting it through', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    assert.ok(!out.includes('<script>'))
    assert.ok(out.includes('&lt;script&gt;'))
  })

  it('escapes an attribute-breakout attempt inside a link label', () => {
    const out = renderMarkdown('[click "me](http://evil.example/x)')
    assert.ok(!out.includes('"me'))
  })

  it('never renders a javascript: URL as a link', () => {
    const out = renderMarkdown('[click](javascript:alert(1))')
    assert.ok(!out.includes('<a href="javascript:'))
  })
})

describe('renderMarkdown formatting', () => {
  it('renders bold and inline code', () => {
    const out = renderMarkdown('this is **bold** and `code`')
    assert.equal(out, '<p>this is <strong>bold</strong> and <code>code</code></p>')
  })

  it('renders italics without touching snake_case identifiers', () => {
    const out = renderMarkdown('use my_variable_name here')
    assert.equal(out, '<p>use my_variable_name here</p>')
  })

  it('renders a fenced code block untouched by inline formatting', () => {
    const out = renderMarkdown('```js\nconst x = **not_bold**\n```')
    assert.equal(out, '<pre><code class="lang-js">const x = **not_bold**</code></pre>')
  })

  it('renders an unordered list', () => {
    const out = renderMarkdown('- one\n- two')
    assert.equal(out, '<ul><li>one</li><li>two</li></ul>')
  })

  it('renders a safe http link', () => {
    const out = renderMarkdown('[docs](https://example.com/a)')
    assert.equal(out, '<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer">docs</a></p>')
  })

  it('joins consecutive lines in one paragraph with <br>', () => {
    const out = renderMarkdown('line one\nline two')
    assert.equal(out, '<p>line one<br>line two</p>')
  })

  it('separates blank-line paragraphs', () => {
    const out = renderMarkdown('first\n\nsecond')
    assert.equal(out, '<p>first</p><p>second</p>')
  })
})
