/**
 * AUDIOMETR — pure math for the microphone level card.
 *
 * Kept apart from K7Audiometer.svelte so it can be unit tested without a DOM
 * or a MediaStream. Every function guards its edges deliberately: this drives
 * a display that runs for months unattended, so a bad sample (silence, a
 * clipped input, a misconfigured param) must degrade to a sane number, never
 * to NaN or Infinity that then paints a broken bar forever.
 */

/** Floor for dBFS so silence (rms === 0) doesn't produce -Infinity. */
const MIN_DB = -60
const MAX_DB = 0

/**
 * The trailing window `percent` is computed relative to — this is what the
 * schema's own params.audiometer doc always claimed ("znormalizowane 0-100
 * względem ciszy/maksimum") but the original implementation never actually
 * did; it mapped raw RMS to 0-100 on a fixed absolute scale instead, which
 * is why a quiet kitchen only ever read a few percent no matter how loud the
 * loudest thing in it was.
 */
export const REFERENCE_WINDOW_SECONDS = 30

/**
 * The reference (the level treated as 100%) never drops below this RMS.
 * Without a floor, a genuinely silent room's noise floor would itself get
 * amplified toward 100% — the "cap" side of "falloff and cap": not just an
 * upper bound on the displayed percent, but a lower bound on what counts as
 * the room's own ambient level.
 */
const MIN_REFERENCE_RMS = 0.02

/**
 * How much of the gap between the current reference and a newly *lower*
 * windowed peak closes per sample. The reference jumps UP immediately to a
 * new peak (an attack should register at once), but eases DOWN only by this
 * fraction each sample — the falloff — so the 100% mark doesn't snap back
 * down the instant a loud moment passes, the way a VU meter's peak-hold
 * relaxes rather than resets.
 */
const REFERENCE_FALLOFF_STEP = 0.05

/** Max of a rolling window, 0 for an empty one — split out so the empty case is one line to test. */
export function windowMax(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values)
}

/**
 * Peak-hold-with-falloff: the 100% reference for `toRelativePercent`.
 * `windowedMax` is `windowMax` over the trailing `REFERENCE_WINDOW_SECONDS`
 * of raw RMS samples, recomputed by the caller every sample.
 */
export function updateReference(previousReference: number, windowedMax: number): number {
  const target = Math.max(MIN_REFERENCE_RMS, Number.isFinite(windowedMax) ? windowedMax : 0)
  const prev = Number.isFinite(previousReference) && previousReference > 0 ? previousReference : MIN_REFERENCE_RMS
  if (target >= prev) return target
  const eased = prev - (prev - target) * REFERENCE_FALLOFF_STEP
  return Math.max(target, eased)
}

/**
 * `rms` as a percentage of `reference` (the trailing-window peak-with-
 * falloff level) — "how loud is this, relative to the loudest the room has
 * recently been" rather than an absolute fraction of full-scale amplitude.
 * Capped at 100: `reference` updates once per sample, so a sample can
 * legitimately exceed the *previous* reference for one tick before the
 * falloff/peak logic above catches up, and that must never paint past the
 * top of the bar.
 */
export function toRelativePercent(rms: number, reference: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0
  const ref = Number.isFinite(reference) && reference > 0 ? reference : MIN_REFERENCE_RMS
  return Math.min(100, (rms / ref) * 100)
}

/** dBFS, i.e. 20 * log10(rms), floored so silence is a number, not -Infinity. */
export function toDecibels(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return MIN_DB
  const clamped = Math.min(1, rms)
  const db = 20 * Math.log10(clamped)
  return Math.min(MAX_DB, Math.max(MIN_DB, db))
}

/**
 * Append `sample` to `history`, keeping at most `maxSamples` entries (drops
 * from the front — oldest first). Returns a new array; never mutates the
 * input. `maxSamples <= 0` yields an empty window.
 */
export function pushSample(history: number[], sample: number, maxSamples: number): number[] {
  const value = Number.isFinite(sample) ? sample : 0
  const limit = Number.isFinite(maxSamples) ? Math.max(0, Math.floor(maxSamples)) : 0
  if (limit === 0) return []
  const next = [...history, value]
  return next.length > limit ? next.slice(next.length - limit) : next
}

/**
 * Exponential smoothing toward `next`. `factor` is the `smoothingFactor`
 * contract param: 0 is raw/instant, 1 is (almost) frozen. Out-of-range
 * factors are clamped rather than trusted, since this is fed straight from a
 * string custom-element attribute.
 */
export function smooth(previous: number, next: number, factor: number): number {
  const p = Number.isFinite(previous) ? previous : 0
  const n = Number.isFinite(next) ? next : 0
  const f = Number.isFinite(factor) ? Math.min(1, Math.max(0, factor)) : 0
  if (f >= 1) return p
  return p * f + n * (1 - f)
}

/** Whether `value` is over `threshold`. An undefined threshold never fires. */
export function exceedsThreshold(value: number, threshold: number | undefined): boolean {
  if (threshold === undefined || !Number.isFinite(threshold)) return false
  if (!Number.isFinite(value)) return false
  return value > threshold
}
