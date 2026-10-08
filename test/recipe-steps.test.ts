import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ALLOWED_TAGS } from '../src/shared/markdown.ts'
import { numberedSteps, stepsMarkdownFrom } from '../src/shared/recipe-steps.ts'
import { renderRecipeSteps } from '../src/client/lib/recipe-steps.ts'

const secondsIn = (html: string): string[] => [...html.matchAll(/data-seconds="(\d+)"/g)].map((m) => m[1] ?? '')

describe('numberedSteps', () => {
  it('numbers a legacy step list in order, one line per step, blanks dropped', () => {
    assert.equal(numberedSteps(['Zagotuj wodę.', '  ', 'Dodaj\n  sól.']), '1. Zagotuj wodę.\n2. Dodaj sól.')
  })

  it('is empty for no steps', () => {
    assert.equal(numberedSteps([]), '')
  })
})

describe('stepsMarkdownFrom', () => {
  it('takes the Markdown document as written (trimmed)', () => {
    assert.equal(stepsMarkdownFrom({ stepsMarkdown: '\n### Krem\n- ubij\n' }), '### Krem\n- ubij')
  })

  it('reads a legacy steps array as a numbered list', () => {
    assert.equal(stepsMarkdownFrom({ steps: ['gotuj', 'podaj'] }), '1. gotuj\n2. podaj')
  })

  it('prefers stepsMarkdown when both shapes are present', () => {
    assert.equal(stepsMarkdownFrom({ stepsMarkdown: 'nowe', steps: ['stare'] }), 'nowe')
  })

  it('is undefined when neither shape is usable', () => {
    assert.equal(stepsMarkdownFrom({}), undefined)
    assert.equal(stepsMarkdownFrom({ steps: 'gotuj' }), undefined)
    assert.equal(stepsMarkdownFrom({ steps: ['gotuj', 3] }), undefined)
    assert.equal(stepsMarkdownFrom({ stepsMarkdown: 7 }), undefined)
  })
})

describe('renderRecipeSteps', () => {
  const tagsIn = (html: string): string[] => [...html.matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1] ?? '')

  it('renders headings, sub-lists, bold and links, with no list the author did not write', () => {
    const html = renderRecipeSteps(
      '## Krem\n\n- ubij śmietanę\n  - powoli\n- dodaj cukier\n\n**Uwaga:** nie przegrzewaj. [źródło](https://example.com/krem)',
    )
    assert.match(html, /<h3>Krem<\/h3>/)
    assert.match(html, /<ul>\s*<li>ubij śmietanę\s*<ul>\s*<li>powoli<\/li>/)
    assert.match(html, /<strong>Uwaga:<\/strong>/)
    assert.match(html, /<a href="https:\/\/example.com\/krem" target="_blank" rel="noopener noreferrer">źródło<\/a>/)
    assert.ok(!html.includes('<ol'), 'nothing numbers what the author did not number')
  })

  it('keeps a legacy recipe visibly in order: its numbered list renders as <ol>', () => {
    const html = renderRecipeSteps(numberedSteps(['Zagotuj wodę.', 'Dodaj sól.']))
    assert.match(html, /^<ol>\s*<li>Zagotuj wodę.<\/li>\s*<li>Dodaj sól.<\/li>\s*<\/ol>/)
  })

  it('turns durations in running text into timer buttons', () => {
    const html = renderRecipeSteps('1. Gotuj **10 min** na małym ogniu.\n2. Piecz 40-45 min.')
    assert.deepEqual(secondsIn(html), ['600', '2400'])
    assert.ok(html.includes('<strong><button type="button" class="dur" data-seconds="600"'), 'inside bold still works')
  })

  it('never links a duration inside a link or inline code, and leaves their markup intact', () => {
    const html = renderRecipeSteps('Zobacz [10 min z filmu](https://example.com/film) i `sleep 5 s`, potem odstaw na 15 min.')
    assert.deepEqual(secondsIn(html), ['900'], 'only the duration in plain text')
    assert.ok(html.includes('<a href="https://example.com/film" target="_blank" rel="noopener noreferrer">10 min z filmu</a>'))
    assert.ok(html.includes('<code>sleep 5 s</code>'))
  })

  it('never links a duration inside a fenced code block', () => {
    assert.deepEqual(secondsIn(renderRecipeSteps('```\nczekaj 10 min\n```')), [])
  })

  it('escapes raw HTML and drops script-scheme links (XSS)', () => {
    const html = renderRecipeSteps(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> [klik](javascript:alert(1)) **<b onmouseover=x>10 min</b>**',
    )
    assert.ok(!/<script|<img|<b[ >]|javascript:/i.test(html.replace(/&lt;[^]*?&gt;/g, '')), html)
    assert.ok(!html.includes('href="javascript'))
    for (const tag of tagsIn(html)) {
      assert.ok((ALLOWED_TAGS as readonly string[]).includes(tag) || tag === 'button', `unexpected <${tag}> in ${html}`)
    }
  })

  it('does not let a duration button split an HTML entity or attribute', () => {
    const html = renderRecipeSteps('Piecz 5 min & "10 min" <i>5 s</i>')
    assert.ok(html.includes('&amp;'))
    assert.ok(html.includes('&quot;<button'), html)
    assert.deepEqual(secondsIn(html), ['300', '600', '5'])
  })
})
