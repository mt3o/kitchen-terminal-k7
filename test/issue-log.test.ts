import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { JSDOM } from 'jsdom'

import { createIssueLogUi, renderIssueLog } from '../src/client/lib/issue-log.ts'
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

describe('createIssueLogUi — clearing the log', () => {
  function setup() {
    const dom = new JSDOM(`
      <button id="issue-log-open"></button>
      <div id="issue-log" hidden>
        <div class="issue-log-veil"></div>
        <button id="issue-log-clear">[ wyczyść ]</button>
        <button id="issue-log-close"></button>
        <div id="issue-log-body"></div>
      </div>`)
    const doc = dom.window.document
    let rows: IssueLogEntry[] = [entry()]
    const calls: string[] = []
    let deleteStatus = 200
    let releaseDelete: () => void = () => {}
    let holdDelete = false
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push(`${method} ${String(input)}`)
      if (method === 'DELETE') {
        if (holdDelete) await new Promise<void>((r) => (releaseDelete = r))
        if (deleteStatus !== 200) return new Response('', { status: deleteStatus })
        rows = []
        return new Response(JSON.stringify({ removed: 1 }), { status: 200 })
      }
      return new Response(JSON.stringify(rows), { status: 200 })
    }) as typeof fetch
    const ui = createIssueLogUi(doc, fetchImpl)
    const settle = () => new Promise((r) => setTimeout(r, 0))
    return {
      doc,
      ui,
      calls,
      settle,
      failDeletes: () => (deleteStatus = 500),
      holdDeletes: () => (holdDelete = true),
      release: () => releaseDelete(),
    }
  }

  it('asks for a second tap before deleting anything', async () => {
    const { doc, ui, calls, settle } = setup()
    ui.open()
    await settle()
    const clear = doc.getElementById('issue-log-clear')!
    clear.click()
    await settle()
    assert.ok(!calls.some((c) => c.startsWith('DELETE')))
    assert.ok(clear.textContent!.includes('na pewno'))
    ui.destroy()
  })

  it('clears on the second tap and re-renders the empty log', async () => {
    const { doc, ui, calls, settle } = setup()
    ui.open()
    await settle()
    const clear = doc.getElementById('issue-log-clear')!
    clear.click()
    clear.click()
    await settle()
    await settle()
    assert.ok(calls.includes('DELETE /api/issues'))
    assert.ok(doc.getElementById('issue-log-body')!.innerHTML.includes('brak zgłoszonych błędów'))
    assert.ok(clear.textContent!.includes('wyczyść'))
    ui.destroy()
  })

  it('shows one failure line however many clears fail', async () => {
    const { doc, ui, settle, failDeletes } = setup()
    ui.open()
    await settle()
    failDeletes()
    const clear = doc.getElementById('issue-log-clear')!
    for (let i = 0; i < 2; i++) {
      clear.click()
      clear.click()
      await settle()
    }
    const body = doc.getElementById('issue-log-body')!
    assert.equal(body.querySelectorAll('.issue-log-clear-failed').length, 1)
    ui.destroy()
  })

  it('ignores taps while a clear is in flight', async () => {
    const { doc, ui, calls, settle, holdDeletes, release } = setup()
    ui.open()
    await settle()
    holdDeletes()
    const clear = doc.getElementById('issue-log-clear')!
    clear.click()
    clear.click()
    await settle()
    clear.click()
    clear.click()
    await settle()
    release()
    await settle()
    await settle()
    assert.equal(calls.filter((c) => c.startsWith('DELETE')).length, 1)
    ui.destroy()
  })
})
