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

import { parse } from 'yaml'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'design-system/tokens.css')

const { generateTokensCss } = await import(resolve(ROOT, 'src/server/theme/generate.ts'))

const layout = parse(await readFile(resolve(ROOT, 'layout.yaml'), 'utf8'))
const theme = parse(await readFile(resolve(ROOT, layout.theme), 'utf8'))
const css = generateTokensCss(theme)

if (process.argv.includes('--check')) {
  const current = await readFile(OUT, 'utf8').catch(() => '')
  if (current.trim() !== css.trim()) {
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
