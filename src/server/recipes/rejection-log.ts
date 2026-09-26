/**
 * The scrub-then-bound logic behind a `RecipeRejection`'s stored
 * `attemptedInput` — pure, no filesystem/network/database, so it can be
 * unit-tested without booting anything. Deliberately does not import
 * anything from `server/index.ts`: that file is a top-level script whose
 * import side effects include opening the database and starting
 * migrations, and importing a constant from it here would transitively
 * boot the server on this module's own test file, undoing the point of
 * extracting it.
 *
 * Order matters: scrub first, on the raw structured value, then bound
 * size. `createScrubber` (`../redact.ts`) recurses through objects/arrays
 * natively — it was never meant to take an already-serialized string.
 * Bounding *before* scrubbing risks cutting a secret-shaped pattern in
 * half at the boundary, so the surviving fragment no longer matches the
 * scrubber's length-gated patterns and stores in plaintext.
 */

/** Matches `index.ts`'s `ISSUE_DETAIL_MAX`, but is this module's own —
 *  never imported from `index.ts` (see file doc comment). */
const ATTEMPTED_INPUT_FIELD_MAX = 4000
const ATTEMPTED_INPUT_ARRAY_MAX = 200

function boundValue(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, ATTEMPTED_INPUT_FIELD_MAX)
  if (Array.isArray(value)) return value.slice(0, ATTEMPTED_INPUT_ARRAY_MAX).map(boundValue)
  // Every other JSON-native shape (number, boolean, null, a nested object)
  // is already small and already JSON-safe — a submitted recipe body has
  // no reason to carry a large one, so it passes through unbounded rather
  // than being dropped. Dropping a malformed field (e.g. `ingredients` sent
  // as a non-array, the exact thing that caused the rejection) would
  // silently discard the one piece of data a retry needs to recover.
  return value
}

/**
 * `raw` is always `req.body` from an already-parsed JSON request, so every
 * field is already JSON-safe. `scrub` is `scrubIssueText` from `index.ts`,
 * passed in rather than imported, keeping this module free of that file's
 * import side effects.
 */
export function sanitizeRejectionInput(
  raw: unknown,
  scrub: (input: unknown) => unknown,
): Record<string, unknown> {
  const scrubbed = scrub(raw)
  // A JSON body may be `null`, an array or a bare value — kept, bounded,
  // under one key rather than thrown on: this runs on a 400's way out.
  if (scrubbed === null || typeof scrubbed !== 'object' || Array.isArray(scrubbed)) {
    return scrubbed === undefined ? {} : { value: boundValue(scrubbed) }
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(scrubbed)) out[key] = boundValue(value)
  return out
}
