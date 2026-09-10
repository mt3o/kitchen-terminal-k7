/** The shape `changelog.yaml` parses into and `GET /api/changelog` serves. */
export interface ChangelogEntry {
  /** `YYYY-MM-DD` — CLAUDE.md requires a date on every entry. */
  date: string
  title: string
  items: string[]
}

export interface Changelog {
  entries: ChangelogEntry[]
}

function isChangelogEntry(value: unknown): value is ChangelogEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.date === 'string' &&
    typeof v.title === 'string' &&
    Array.isArray(v.items) &&
    v.items.every((item) => typeof item === 'string')
  )
}

/** Throws with a message safe to return over HTTP — names a field, never a value. */
export function parseChangelog(raw: unknown): Changelog {
  if (typeof raw !== 'object' || raw === null || !('entries' in raw)) {
    throw new Error('changelog.yaml has no entries')
  }
  const entries = (raw as { entries: unknown }).entries
  if (!Array.isArray(entries) || !entries.every(isChangelogEntry)) {
    throw new Error('changelog.yaml entries must each have date, title and items')
  }
  return { entries }
}
