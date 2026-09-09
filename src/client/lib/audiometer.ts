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

/** Normalise an RMS amplitude (0..1) to a 0-100 percent scale. */
export function toPercent(rms: number): number {
  if (!Number.isFinite(rms)) return 0
  const clamped = Math.min(1, Math.max(0, rms))
  return clamped * 100
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
