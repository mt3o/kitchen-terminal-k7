/**
 * Secret scrubbing for anything that leaves this process.
 *
 * The rule this enforces is a project invariant, not a nicety: the Google
 * refresh token and the Kilo Gateway key are server-side only, and they must not
 * leak into GlitchTip payloads alongside errors. That matters most precisely
 * where it is easiest to get wrong — the AI chat logs every call, so the values
 * are near the error paths all day long.
 *
 * Two layers, on purpose:
 *
 *   1. Exact-value scrubbing. We know the real secrets at boot, so any string
 *      containing one is rewritten. This is the reliable half.
 *   2. Pattern scrubbing. Catches shapes we did not register — a bearer token
 *      pasted into a log line, a DSN echoed from a dependency. This is the half
 *      that covers what we forgot.
 *
 * Layer 1 alone is not enough (third-party code invents its own credentials) and
 * layer 2 alone is not enough (a random key matches no pattern). Neither is
 * redundant.
 */

export const REDACTED = '[redacted]'

/** Below this length, a "secret" is too generic to search for without eating
 *  unrelated text. A 4-character value would match half the stack trace. */
const MIN_SECRET_LENGTH = 8

/** Shapes that are credentials wherever they appear. */
const PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,          // Authorization headers
  /\b(?:sk|pk|rk)-[A-Za-z0-9]{16,}\b/g,             // provider-style API keys
  /\b[a-z][a-z0-9+.-]*:\/\/[^:@/\s]+:[^@/\s]+@[^\s]+/gi, // credentials in any URL scheme,
  //                                                    not just http — a postgres:// or
  //                                                    redis:// DSN carries them too
  /\b1\/\/[A-Za-z0-9_-]{20,}\b/g,                   // Google refresh tokens
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
]

/** Keys whose value is a credential regardless of what it looks like. */
const SENSITIVE_KEY = /(?:secret|token|password|passwd|api[-_]?key|authorization|cookie|dsn|credential)/i

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a scrubber bound to a specific set of secret values.
 * Values shorter than {@link MIN_SECRET_LENGTH} are ignored rather than silently
 * turning the whole payload into `[redacted]`.
 */
export function createScrubber(secrets: readonly (string | undefined)[]): (input: unknown) => unknown {
  const known = secrets
    .filter((s): s is string => typeof s === 'string' && s.length >= MIN_SECRET_LENGTH)
    .map((s) => new RegExp(escapeForRegExp(s), 'g'))

  function scrubString(text: string): string {
    let out = text
    for (const rx of known) out = out.replace(rx, REDACTED)
    for (const rx of PATTERNS) out = out.replace(rx, REDACTED)
    return out
  }

  // A cycle in an event object must not hang the process that is already
  // reporting a crash, so visited nodes are tracked.
  function walk(value: unknown, seen: WeakSet<object>): unknown {
    if (typeof value === 'string') return scrubString(value)
    if (value === null || typeof value !== 'object') return value
    if (seen.has(value)) return value
    seen.add(value)

    if (Array.isArray(value)) return value.map((v) => walk(v, seen))

    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      // A key named `authorization` is a credential even when its value looks
      // like nothing in particular.
      out[key] = SENSITIVE_KEY.test(key) && typeof v === 'string' && v.length > 0 ? REDACTED : walk(v, seen)
    }
    return out
  }

  return (input: unknown): unknown => walk(input, new WeakSet<object>())
}
