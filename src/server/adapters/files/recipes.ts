/**
 * The recipe collection as a directory of Markdown files, one per recipe,
 * named by id.
 *
 * It lives outside the deployed checkout (see `recipesDir` in config.ts)
 * because it is the household's own data: edited by hand, backed up and
 * synced on its own schedule, and not something a deploy may reset.
 *
 * Every call reads the directory afresh — no cache. At tens of files that
 * costs nothing, and it means a hand edit shows up on the next request
 * without a restart, the same rule layout.yaml already follows.
 */
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { Recipe } from '../../domain/types.ts'
import type { RecipeRepository } from '../../ports/repositories.ts'
import { parseRecipeMarkdown, serializeRecipe, slugify } from '../../recipes/markdown-format.ts'

const EXTENSION = '.md'
const MIGRATION_MARKER = '.migrated-from-sqlite'

/** Thrown by `save` for an id that would name a file outside the collection. */
export class InvalidRecipeIdError extends Error {
  constructor(id: string) {
    super(`not a valid recipe id: ${JSON.stringify(id)}`)
    this.name = 'InvalidRecipeIdError'
  }
}

export interface FileRecipeRepositoryOptions {
  /** A file that exists but cannot be read as a recipe. It is skipped, never fatal. */
  onInvalid?: (file: string, error: unknown) => void
}

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'

/**
 * Ids arrive from URLs, so an id is a filename only if it cannot leave the
 * directory. Anything else is allowed — a hand-made `Pierogi ruskie.md` has
 * the id `Pierogi ruskie`. A leading dot is refused because dotfiles are
 * where the temp files and the migration marker live.
 */
function isSafeId(dir: string, id: string): boolean {
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) return false
  // eslint-disable-next-line no-control-regex -- control characters are exactly what this refuses
  if (/[/\\\x00-\x1f\x7f]/.test(id) || id.startsWith('.')) return false
  const root = resolve(dir)
  return dirname(resolve(root, `${id}${EXTENSION}`)) === root
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

/** `undefined` for a file that isn't there; throws for one that is there but unreadable. */
async function readRecipe(dir: string, id: string): Promise<Recipe | undefined> {
  const path = join(dir, `${id}${EXTENSION}`)
  try {
    const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
    return parseRecipeMarkdown(text, { id, mtime: info.mtime })
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

/** `slug`, then `slug-2`, `slug-3`, … — the first stem no file has taken yet. */
async function freeId(dir: string, title: string, taken?: (id: string) => Promise<boolean>): Promise<string> {
  const base = slugify(title)
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? base : `${base}-${n}`
    if (taken ? await taken(id) : await exists(join(dir, `${id}${EXTENSION}`))) continue
    return id
  }
}

/**
 * Write-then-rename, so a reader — the kiosk, or a sync tool watching the
 * directory — sees either the old recipe or the new one, never half a file.
 */
async function writeAtomically(dir: string, id: string, content: string): Promise<void> {
  const target = join(dir, `${id}${EXTENSION}`)
  const temp = join(dir, `.${id}${EXTENSION}.tmp`)
  try {
    await writeFile(temp, content, 'utf8')
    await rename(temp, target)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

export function createFileRecipeRepository(dir: string, options: FileRecipeRepositoryOptions = {}): RecipeRepository {
  const report = (file: string, error: unknown): void => options.onInvalid?.(file, error)

  async function readAll(): Promise<Recipe[]> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      // No directory yet is an empty collection, not a failure: it is
      // created by the first save.
      if (isMissing(error)) return []
      throw error
    }

    const names = entries
      .filter((e) => !e.isDirectory() && e.name.endsWith(EXTENSION) && !e.name.startsWith('.'))
      .map((e) => e.name)

    const recipes = await Promise.all(
      names.map(async (name) => {
        const id = name.slice(0, -EXTENSION.length)
        if (!isSafeId(dir, id)) {
          report(name, new Error('file name is not a usable recipe id'))
          return undefined
        }
        try {
          return await readRecipe(dir, id)
        } catch (error) {
          // One unreadable file must not take the whole collection with it.
          report(name, error)
          return undefined
        }
      }),
    )
    return recipes.filter((r): r is Recipe => r !== undefined)
  }

  return {
    async list({ tag, limit = 50 } = {}) {
      return (await readAll())
        .filter((r) => (tag ? r.tags.includes(tag) : true))
        .sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime() || a.id.localeCompare(b.id))
        .slice(0, limit)
    },

    async get(id) {
      if (!isSafeId(dir, id)) return undefined
      try {
        return await readRecipe(dir, id)
      } catch (error) {
        // Consistent with `list`: a file that can't be read is not a recipe.
        report(`${id}${EXTENSION}`, error)
        return undefined
      }
    },

    async save(recipe) {
      if (recipe.id && !isSafeId(dir, recipe.id)) throw new InvalidRecipeIdError(recipe.id)
      await mkdir(dir, { recursive: true })
      const id = recipe.id || (await freeId(dir, recipe.title))

      let importedAt: Date
      if ('importedAt' in recipe) importedAt = recipe.importedAt
      else {
        // An edit is not a new import; keep the date it was first saved.
        const existing = await readRecipe(dir, id).catch(() => undefined)
        importedAt = existing?.importedAt ?? new Date()
      }

      const content = serializeRecipe({
        id,
        title: recipe.title,
        sourceUrl: recipe.sourceUrl,
        ingredients: recipe.ingredients,
        steps: recipe.steps,
        tags: recipe.tags,
        importedAt,
      })
      await writeAtomically(dir, id, content)
      // What a later `get` will return, not what was passed in: items are
      // flattened to one line each on the way to disk.
      return parseRecipeMarkdown(content, { id, mtime: importedAt })
    },

    async delete(id) {
      if (!isSafeId(dir, id)) return false
      try {
        await unlink(join(dir, `${id}${EXTENSION}`))
        return true
      } catch (error) {
        if (isMissing(error)) return false
        throw error
      }
    },
  }
}

/**
 * One-time copy of the SQLite recipes into the directory. Returns `undefined`
 * when it has already run.
 *
 * The guard is a marker file, not "the directory is empty": a household that
 * deliberately deletes every recipe file must not have them resurrected from
 * SQLite on the next boot.
 *
 * Files are named by title slug; the old UUIDs are not kept, since nothing
 * outside the recipes table refers to a recipe id. A run interrupted before
 * the marker is written is safe to repeat: a row is recognised as already
 * copied when a file in its slug series has the same title *and* the same
 * importedAt. Title alone would not do — two different "Sernik" rows from two
 * sites would collapse into one and the second would be lost.
 */
export async function migrateRecipesToFiles(
  source: RecipeRepository,
  dir: string,
): Promise<{ migrated: number; skipped: number } | undefined> {
  const marker = join(dir, MIGRATION_MARKER)
  if (await exists(marker)) return undefined
  await mkdir(dir, { recursive: true })

  const target = createFileRecipeRepository(dir)
  // Oldest first, so of two same-titled recipes the one saved first keeps the
  // unnumbered name — as it would have, had files been the store all along.
  const rows = (await source.list({ limit: 10_000 })).sort((a, b) => a.importedAt.getTime() - b.importedAt.getTime())
  let migrated = 0
  let skipped = 0

  for (const row of rows) {
    let alreadyCopied = false
    const id = await freeId(dir, row.title, async (candidate) => {
      const existing = await readRecipe(dir, candidate).catch(() => null)
      if (existing === undefined) return false
      if (
        existing &&
        existing.title === row.title &&
        existing.importedAt.getTime() === row.importedAt.getTime()
      ) {
        alreadyCopied = true
        return false
      }
      return true
    })
    if (alreadyCopied) {
      skipped += 1
      continue
    }
    await target.save({ ...row, id })
    migrated += 1
  }

  await writeFile(marker, `${new Date().toISOString()} migrated=${migrated} skipped=${skipped}\n`, 'utf8')
  return { migrated, skipped }
}
