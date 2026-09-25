/**
 * Regenerate design-system/tokens.css from the theme the layout names.
 *
 * The server generates this stylesheet per request, so the app never reads the
 * committed file — but Storybook has no server and imports it directly, and
 * DESIGN.md points readers at it. Leaving it hand-maintained beside a generator
 * is how the two quietly disagree, and the disagreement would show up as
 * Storybook proving a design the kiosk does not have.
 *
 * `--check` regenerates in memory and fails if the committed file has drifted,
 * which is what CI runs.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { parse } from 'yaml'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'design-system/tokens.css')

// pathToFileURL, not the bare path: ESM refuses an absolute Windows path
// ("C:\..." reads as protocol 'c:'), so this line is what stops the script
// running anywhere but POSIX.
const { generateTokensCss } = await import(pathToFileURL(resolve(ROOT, 'src/server/theme/generate.ts')).href)

const layout = parse(await readFile(resolve(ROOT, 'layout.yaml'), 'utf8'))
const theme = parse(await readFile(resolve(ROOT, layout.theme), 'utf8'))
const css = generateTokensCss(theme)

// Line endings are not drift: a Windows checkout with core.autocrlf holds this
// file as CRLF while the generator emits LF, which would otherwise fail the
// check on every such machine for a file whose content matches exactly.
const sameContent = (a, b) => a.replace(/\r\n/g, '\n').trim() === b.replace(/\r\n/g, '\n').trim()

if (process.argv.includes('--check')) {
  const current = await readFile(OUT, 'utf8').catch(() => '')
  if (!sameContent(current, css)) {
    process.stderr.write(
      'design-system/tokens.css has drifted from the theme file.\n' +
        'Run: npm run tokens\n',
    )
    process.exit(1)
  }
  process.stdout.write('tokens.css matches the theme\n')
} else {
  await writeFile(OUT, css)
  process.stdout.write(`wrote ${OUT}\n`)
}
