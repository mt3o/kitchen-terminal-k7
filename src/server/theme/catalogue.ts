/**
 * The themes a viewer may switch to for their own session.
 *
 * `layout.yaml` still decides the theme; this only lets one browser tab look at
 * another one without editing a file. The request names a theme by id — the
 * YAML's basename in `design-system/themes/` — and never by path: the id is
 * looked up in the directory listing, so a request can only ever reach a file
 * that is already there. That matters because the asset route trusts whatever
 * the resolved theme declares.
 */
import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'

import { parse } from 'yaml'

/** Where switchable themes live, relative to the project root. */
export const THEMES_DIR = 'design-system/themes'

export interface ThemeEntry {
  /** The file's basename without `.yaml` — what a request names. */
  id: string
  /** The theme's own `name:`, or the id when it has none. */
  name: string
}

/** The id a theme path would be requested by, e.g. `retro-scifi` for `…/retro-scifi.yaml`. */
export function themeId(path: string): string {
  return basename(path, extname(path))
}

/** Every `*.yaml` directly in the themes directory, sorted by name. Unreadable files are left out. */
export async function listThemes(themesDir: string): Promise<ThemeEntry[]> {
  const files = (await readdir(themesDir, { withFileTypes: true }))
    .filter((f) => f.isFile() && extname(f.name) === '.yaml')
    .map((f) => f.name)
  const entries = await Promise.all(
    files.map(async (file): Promise<ThemeEntry | undefined> => {
      const id = themeId(file)
      try {
        const doc = parse(await readFile(resolve(themesDir, file), 'utf8')) as { name?: unknown } | null
        return { id, name: typeof doc?.name === 'string' && doc.name ? doc.name : id }
      } catch {
        return undefined
      }
    }),
  )
  return entries.filter((e): e is ThemeEntry => e !== undefined).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The theme file to render: the requested one when it is in the catalogue,
 * otherwise the layout's. An unknown id is not an error — a tab restored from
 * a session that named a theme since deleted just gets the default back.
 */
export function pickThemePath(
  root: string,
  layoutTheme: string,
  requested: string | undefined,
  catalogue: readonly ThemeEntry[],
): string {
  if (requested && catalogue.some((t) => t.id === requested)) return resolve(root, THEMES_DIR, `${requested}.yaml`)
  return resolve(root, layoutTheme)
}
