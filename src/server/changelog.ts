/**
 * Reads `changelog/` — one YAML file per entry, so two changes landing on the
 * same day add two files instead of both inserting at the top of one list,
 * which git reported as a conflict every time. Naming and ordering rules live
 * in `changelog/README.md` and `shared/changelog.ts`.
 *
 * Kept out of `index.ts` so the repository's own changelog can be loaded by a
 * test without booting the server as an import side effect.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parse } from 'yaml'

import { assembleChangelog, type Changelog, type ChangelogFile } from '../shared/changelog.ts'

/** Not entries: the directory's own README, and editor swap/backup dotfiles. */
function isEntryCandidate(name: string): boolean {
  return name !== 'README.md' && !name.startsWith('.')
}

export async function loadChangelog(dir: string): Promise<Changelog> {
  const names = (await readdir(dir)).filter(isEntryCandidate)
  const files = await Promise.all(
    names.map(async (name): Promise<ChangelogFile> => {
      const raw = await readFile(join(dir, name), 'utf8')
      try {
        return { name, data: parse(raw) as unknown }
      } catch {
        // yaml's own message quotes the offending source line; name the file instead.
        throw new Error(`changelog/${name}: not valid YAML`)
      }
    }),
  )
  return assembleChangelog(files)
}
