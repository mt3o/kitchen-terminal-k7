/**
 * isHttpUrl guards every place a stranger-supplied string becomes a clickable
 * `href` — a comic feed's own `<link>` content, a recipe's editable source.
 * Scheme-only on purpose: see src/shared/url.ts's own doc comment for why it
 * must not also reject private/loopback hosts the way isFetchableUrl does.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isHttpUrl } from '../src/shared/url.ts'

describe('isHttpUrl', () => {
  it('accepts http and https URLs, including ones with paths, queries and private hosts', () => {
    assert.equal(isHttpUrl('http://example.test/comic/123'), true)
    assert.equal(isHttpUrl('https://example.test/przepis?ref=1'), true)
    // Private/loopback hosts are still valid http(s) URLs for this check's
    // purpose: it guards against dangerous schemes, not where the link goes —
    // that's the household's own browser navigating, not the server fetching.
    assert.equal(isHttpUrl('http://192.168.1.5/recipe'), true)
    assert.equal(isHttpUrl('http://localhost:3000/x'), true)
  })

  it('rejects dangerous and non-http(s) schemes', () => {
    assert.equal(isHttpUrl('javascript:alert(1)'), false)
    assert.equal(isHttpUrl('data:text/html,<script>alert(1)</script>'), false)
    assert.equal(isHttpUrl('vbscript:msgbox(1)'), false)
    assert.equal(isHttpUrl('ftp://example.test/x'), false)
  })

  it('rejects strings that are not absolute URLs at all', () => {
    assert.equal(isHttpUrl('not a url'), false)
    assert.equal(isHttpUrl(''), false)
    assert.equal(isHttpUrl('example.test/relative'), false)
  })

  it('rejects an obfuscated javascript: scheme hiding behind embedded whitespace', () => {
    // The WHATWG URL parser strips embedded tab/newline before parsing, so
    // this must not slip past as some other scheme.
    assert.equal(isHttpUrl('java\tscript:alert(1)'), false)
  })
})
