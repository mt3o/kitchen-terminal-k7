import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { renderIssueLog } from '../src/client/lib/issue-log.ts'
import type { IssueLogEntry } from '../src/shared/issue-log.ts'

const NOW = () => new Date('2026-09-20T12:00:00Z')

function entry(overrides: Partial<IssueLogEntry> = {}): IssueLogEntry {
  return {
    id: '1',
    severity: 'warn',
    source: 'rss',
    message: 'comic-of-the-day fell back to 3600s-old cache',
    detail: null,
    createdAt: '2026-09-20T11:55:00Z',
    ...overrides,
  }
}

describe('renderIssueLog', () => {
  it('reports no issues rather than rendering an empty list', () => {
    const html = renderIssueLog([], NOW)
    assert.ok(html.includes('brak zgłoszonych błędów'))
  })

  it('renders the source, message and a [!] badge for a warn entry', () => {
    const html = renderIssueLog([entry()], NOW)
    assert.ok(html.includes('[!]'))
    assert.ok(html.includes('RSS'))
    assert.ok(html.includes('comic-of-the-day fell back'))
    assert.ok(html.includes('issue-log-warn'))
  })

  it('renders a [X] badge for an error entry', () => {
    const html = renderIssueLog([entry({ severity: 'error', source: 'client' })], NOW)
    assert.ok(html.includes('[X]'))
    assert.ok(html.includes('issue-log-error'))
  })

  it('renders detail only when present', () => {
    const withDetail = renderIssueLog([entry({ detail: 'TypeError: boom' })], NOW)
    assert.ok(withDetail.includes('TypeError: boom'))
    const withoutDetail = renderIssueLog([entry()], NOW)
    assert.ok(!withoutDetail.includes('issue-log-detail'))
  })

  it('escapes a message/detail containing HTML rather than injecting it', () => {
    const html = renderIssueLog(
      [entry({ message: '<script>alert(1)</script>', detail: '<img src=x onerror=alert(1)>' })],
      NOW,
    )
    assert.ok(!html.includes('<script>'))
    assert.ok(!html.includes('<img'))
    assert.ok(html.includes('&lt;script&gt;'))
  })

  it('reports the age of the entry relative to now', () => {
    const html = renderIssueLog([entry({ createdAt: '2026-09-20T11:55:00Z' })], NOW)
    assert.ok(html.includes('5 min temu'))
  })
})
