/**
 * What the wall does while the backend is away.
 *
 * The rule it implements: never blank, never lie. The last screen stays visible
 * behind a scrim, and the scrim says what is happening and how long until the
 * next attempt — because a spinner that conveys nothing is what makes people
 * power-cycle a kitchen display.
 *
 * The timing is pure and tested; the DOM half is a thin adapter, so the part
 * that can be subtly wrong is the part a test can reach.
 */

export interface BackoffPolicy {
  baseMs: number
  maxMs: number
  factor: number
}

/**
 * Exponential with a ceiling. A kiosk retries forever — nobody is going to come
 * and press a button — so the ceiling matters more than the growth: without one,
 * an overnight outage backs off to hours and the wall stays dead for hours after
 * the server returns.
 */
export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 1000, maxMs: 30_000, factor: 2 }

export function backoffDelay(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF): number {
  if (attempt < 1) return policy.baseMs
  const raw = policy.baseMs * policy.factor ** (attempt - 1)
  return Math.min(raw, policy.maxMs)
}

/** Everything the scrim needs to render, computed from the attempt state. */
export interface ReconnectView {
  attempt: number
  /** Milliseconds until the next probe. */
  remainingMs: number
  totalMs: number
  /** 0–100, for the determinate bar. Counts down as the wait elapses. */
  percent: number
}

export function viewFor(attempt: number, remainingMs: number, totalMs: number): ReconnectView {
  const safeTotal = Math.max(1, totalMs)
  const clamped = Math.min(Math.max(remainingMs, 0), safeTotal)
  return {
    attempt,
    remainingMs: clamped,
    totalMs: safeTotal,
    // Fills as the wait elapses, so the bar grows towards the next attempt
    // rather than draining, which reads as running out of time.
    percent: Math.round(((safeTotal - clamped) / safeTotal) * 100),
  }
}

export interface ReconnectUi {
  show(): void
  hide(): void
  render(view: ReconnectView): void
}

/** Binds to the markup in index.html. Missing nodes are tolerated: a kiosk that
 *  cannot find its scrim should still reconnect, silently, rather than throw. */
export function domReconnectUi(doc: Document = document): ReconnectUi {
  const root = doc.getElementById('reconnect')
  const attempt = doc.getElementById('reconnect-attempt')
  const countdown = doc.getElementById('reconnect-countdown')
  const fill = doc.getElementById('reconnect-bar-fill')

  return {
    show() {
      if (root) root.hidden = false
    },
    hide() {
      if (root) root.hidden = true
    },
    render(view) {
      if (attempt) attempt.textContent = `próba ${view.attempt}`
      if (countdown) {
        const s = Math.ceil(view.remainingMs / 1000)
        countdown.textContent = s > 0 ? `ponowna próba za ${s} s` : 'łączenie'
      }
      if (fill) fill.style.width = `${view.percent}%`
    },
  }
}

export interface ReconnectOptions {
  /** Resolves when the backend answers; rejects otherwise. */
  probe: () => Promise<unknown>
  ui: ReconnectUi
  /** Called once the backend is back, to refresh what is on screen. */
  onRecovered: () => void
  policy?: BackoffPolicy
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>
  tickMs?: number
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Run until the backend answers. Resolves when it does.
 *
 * Deliberately not an event-driven reconnect on `online`: that event fires for
 * the network interface, and the failure this handles is usually the server
 * restarting while the network is perfectly fine.
 */
export async function reconnectLoop(options: ReconnectOptions): Promise<void> {
  const { probe, ui, onRecovered } = options
  const policy = options.policy ?? DEFAULT_BACKOFF
  const sleep = options.sleep ?? realSleep
  const tick = options.tickMs ?? 250

  ui.show()
  for (let attempt = 1; ; attempt += 1) {
    try {
      await probe()
      ui.hide()
      onRecovered()
      return
    } catch {
      const total = backoffDelay(attempt, policy)
      for (let remaining = total; remaining > 0; remaining -= tick) {
        ui.render(viewFor(attempt, remaining, total))
        await sleep(Math.min(tick, remaining))
      }
      ui.render(viewFor(attempt, 0, total))
    }
  }
}
