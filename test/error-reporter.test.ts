import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createIssueReporter, installErrorReporting } from '../src/client/lib/error-reporter.ts'

describe('createIssueReporter', () => {
  it('posts every report under the limit', () => {
    const posted: Array<{ message: string; detail?: string }> = []
    const reporter = createIssueReporter((message, detail) => posted.push({ message, detail }), 3)
    reporter.report('a')
    reporter.report('b', 'stack b')
    assert.deepEqual(posted, [{ message: 'a', detail: undefined }, { message: 'b', detail: 'stack b' }])
  })

  it('stops posting once the limit is reached, so a crash loop cannot flood the server', () => {
    let calls = 0
    const reporter = createIssueReporter(() => { calls += 1 }, 2)
    for (let i = 0; i < 10; i++) reporter.report(`crash ${i}`)
    assert.equal(calls, 2)
  })
})

describe('installErrorReporting', () => {
  function fakeWindow() {
    const target = new EventTarget()
    return target as unknown as Window
  }

  it('reports an uncaught error via POST /api/issues/client', async () => {
    const win = fakeWindow()
    const calls: Array<{ url: string; body: unknown }> = []
    const fetchImpl = ((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return Promise.resolve({ ok: true } as Response)
    }) as unknown as typeof fetch

    installErrorReporting(win, fetchImpl)
    win.dispatchEvent(
      Object.assign(new Event('error'), { error: new Error('card render blew up'), message: 'card render blew up' }),
    )

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.url, '/api/issues/client')
    assert.equal((calls[0]?.body as { message: string }).message, 'card render blew up')
  })

  it('reports an unhandled promise rejection', async () => {
    const win = fakeWindow()
    const calls: unknown[] = []
    const fetchImpl = ((_url: string, init?: RequestInit) => {
      calls.push(init?.body ? JSON.parse(String(init.body)) : undefined)
      return Promise.resolve({ ok: true } as Response)
    }) as unknown as typeof fetch

    installErrorReporting(win, fetchImpl)
    win.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('gateway timeout') }))

    assert.equal(calls.length, 1)
    assert.equal((calls[0] as { message: string }).message, 'gateway timeout')
  })

  it('never lets a network failure escape the handler', async () => {
    const win = fakeWindow()
    const fetchImpl = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
    installErrorReporting(win, fetchImpl)
    assert.doesNotThrow(() => {
      win.dispatchEvent(Object.assign(new Event('error'), { error: new Error('x'), message: 'x' }))
    })
  })
})
