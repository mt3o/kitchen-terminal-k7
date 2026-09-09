/**
 * Generate the service worker's precache manifest from what the build actually
 * emitted.
 *
 * Reading the real output rather than guessing filenames is the point: Vite
 * hashes asset names, so a hand-maintained list is wrong the first time anyone
 * changes a stylesheet, and wrong in the specific way that caches a file that no
 * longer exists while missing the one that does.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const DIST = resolve(import.meta.dirname, '../dist/client')

/** Everything the shell needs to paint with no network. */
const INCLUDE = /\.(html|css|js|woff2?|svg|png|webmanifest)$/i
/** The manifest cannot list itself, and the worker is fetched by the browser. */
const EXCLUDE = new Set(['precache.json', 'sw.js'])

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

const files = (await walk(DIST))
  .map((f) => relative(DIST, f))
  .filter((f) => INCLUDE.test(f) && !EXCLUDE.has(f))
  .sort()

// The revision is a hash of the file list plus each file's own hash, so a change
// to any shell file produces a new cache name and the old one is dropped on
// activate. Using a timestamp instead would churn the cache on every rebuild.
const hash = createHash('sha256')
for (const f of files) {
  hash.update(f)
  hash.update(await readFile(join(DIST, f)))
}
const revision = hash.digest('hex').slice(0, 12)

const manifest = { revision, assets: files.map((f) => `/${f}`) }
await writeFile(join(DIST, 'precache.json'), JSON.stringify(manifest, null, 2))
process.stdout.write(`precache: ${files.length} assets, revision ${revision}\n`)
