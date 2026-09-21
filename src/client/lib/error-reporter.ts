/**
 * Reports uncaught client-side crashes to `POST /api/issues/client`, so a
 * card that threw during render or a rejected promise nobody awaited shows up
 * in the same household-visible log as a fallback-to-stale-cache event
 * (`lib/issue-log.ts`) rather than only in the iPad's own (unreachable)
 * devtools console.
 *
 * The throttle is the load-bearing part: a script stuck in a crash loop must
 * not turn every frame into an HTTP request. `createIssueReporter` is a pure
 * counter so that limit is a unit test, not something only provable by
 * actually crashing the kiosk.
 */
export interface IssueReporter {
  report(message: string, detail?: string): void
}

/** `post` is fire-and-forget on purpose: a reporting failure must never itself throw into the handler that is already unwinding a crash. */
export function createIssueReporter(post: (message: string, detail?: string) => void, limit = 20): IssueReporter {
  let sent = 0
  return {
    report(message, detail) {
      if (sent >= limit) return
      sent += 1
      post(message, detail)
    },
  }
}

function postToServer(fetchImpl: typeof fetch, message: string, detail?: string): void {
  fetchImpl('/api/issues/client', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, detail }),
  }).catch(() => {
    // Nothing to do: if the network is down there is no honest way to report
    // that the network is down, and this must never retry into a loop.
  })
}

/**
 * Wires `window.onerror` and `unhandledrejection`. Call once, at boot.
 * `windowImpl`/`fetchImpl` are injectable so the wiring itself — not just the
 * throttle — can be exercised without a real crash.
 */
export function installErrorReporting(windowImpl: Window = window, fetchImpl: typeof fetch = fetch): void {
  const reporter = createIssueReporter((message, detail) => postToServer(fetchImpl, message, detail))

  windowImpl.addEventListener('error', (event: ErrorEvent) => {
    const message = event.error instanceof Error ? event.error.message : event.message || 'onerror'
    const detail = event.error instanceof Error ? event.error.stack : `${event.filename}:${event.lineno}:${event.colno}`
    reporter.report(message, detail)
  })

  windowImpl.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason
    const message = reason instanceof Error ? reason.message : String(reason)
    const detail = reason instanceof Error ? reason.stack : undefined
    reporter.report(message, detail)
  })
}
