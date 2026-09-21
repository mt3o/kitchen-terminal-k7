/** The shape the `changelog/` entry files assemble into and `GET /api/changelog` serves. */
export interface ChangelogEntry {
  /** `YYYY-MM-DD` — CLAUDE.md requires a date on every entry. */
  date: string
  title: string
  items: string[]
}

export interface Changelog {
  entries: ChangelogEntry[]
}

/** One file from `changelog/`: its name and its parsed YAML. */
export interface ChangelogFile {
  name: string
  data: unknown
}

/**
 * `YYYY-MM-DD-NN-slug.yaml` — see `changelog/README.md`. The name alone
 * orders the changelog, so it is held to a shape that sorts correctly as text.
 */
const ENTRY_FILE_NAME = /^(\d{4}-\d{2}-\d{2})-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.yaml$/

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

function parseEntryFile({ name, data }: ChangelogFile): ChangelogEntry {
  const match = ENTRY_FILE_NAME.exec(name)
  if (!match) throw new Error(`changelog/${name}: file name must be YYYY-MM-DD-NN-slug.yaml`)
  if (!isChangelogEntry(data)) throw new Error(`changelog/${name}: entry must have date, title and items`)
  if (data.date !== match[1]) throw new Error(`changelog/${name}: date does not match the file name`)
  return { date: data.date, title: data.title, items: data.items }
}

/**
 * Newest first: by file name, descending — the date, then the day's sequence
 * number. Two changes that picked the same number on the same day both keep
 * their entry (different slugs, different files); the slug breaks the tie.
 *
 * Throws with a message safe to return over HTTP — names a file and a field,
 * never a value.
 */
export function assembleChangelog(files: ChangelogFile[]): Changelog {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
  return { entries: sorted.map(parseEntryFile) }
}
