/**
 * Error reporting to GlitchTip, via the Sentry SDK — the two are wire-compatible,
 * so the project gets Sentry's ergonomics without the Sentry service.
 *
 * Every event passes through the scrubber before it leaves the process. That is
 * wired here rather than at each call site because a rule enforced at call sites
 * is a rule that lasts until the first busy afternoon.
 */
import * as Sentry from '@sentry/node'
import type { ErrorEvent } from '@sentry/node'

import { createScrubber } from './redact.ts'

export interface ObservabilityConfig {
  /** GlitchTip DSN. Absent means reporting is off — a valid way to run. */
  dsn?: string | undefined
  environment?: string
  release?: string
  /** The real secret values, so exact-match scrubbing has something to match. */
  secrets?: readonly (string | undefined)[]
  /** Injectable for tests; the SDK's default transport is used otherwise. */
  transport?: Parameters<typeof Sentry.init>[0] extends { transport?: infer T } ? T : never
}

/**
 * Initialise error reporting. Returns whether it is actually on, so a caller can
 * say so in the boot log instead of everyone assuming it works.
 */
export function initObservability(config: ObservabilityConfig): boolean {
  const scrub = createScrubber(config.secrets ?? [])

  if (!config.dsn) return false

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment ?? 'development',
    release: config.release,
    // The kiosk is one household on a LAN; sampling would only lose events.
    tracesSampleRate: 0,
    // Request bodies are the single most likely place for a token to ride along
    // into an error report, and nothing here needs them.
    sendDefaultPii: false,
    ...(config.transport ? { transport: config.transport } : {}),
    beforeSend: (event: ErrorEvent) => scrub(event) as ErrorEvent,
    beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb) as typeof breadcrumb,
  })

  return true
}

export { Sentry }
