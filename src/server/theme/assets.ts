/**
 * Theme files — fonts, background pictures, ornament images — as the server
 * sees them.
 *
 * A theme lives in `design-system/themes/`, outside the built client, so its
 * files are not reachable through the static root. They are served by a route
 * instead, and that route serves exactly the files the active theme names
 * (`themeAssetPaths`): not the theme's directory, not a pattern of extensions.
 * A request for anything else is a 404 whatever it looks like, which is what
 * makes pointing a static-looking URL at a directory full of YAML safe.
 *
 * URLs carry a content hash (`?v=`) so the one response that can be cached
 * forever is the one whose bytes cannot change under it. The service worker
 * caches same-origin files by full URL, so a changed picture arrives on the
 * next load as a new URL rather than hiding behind the old one.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'

/** Route prefix the generated stylesheet points at. */
export const THEME_ASSET_PREFIX = '/theme-assets/'

/** The only file types a theme may ship. Anything else is refused even if named. */
export const THEME_ASSET_TYPES: Readonly<Record<string, string>> = {
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export interface ResolvedThemeAsset {
  file: string
  type: string
}

/**
 * A requested path, resolved against the theme's directory — or undefined when
 * it must not be served: not declared by the theme, not a permitted type, or
 * resolving outside the directory (a theme naming `../../.env` is refused here
 * even though the theme file itself is trusted configuration).
 */
export function resolveThemeAsset(
  themeDir: string,
  requested: string,
  declared: readonly string[],
): ResolvedThemeAsset | undefined {
  if (!declared.includes(requested)) return undefined
  const type = THEME_ASSET_TYPES[extname(requested).toLowerCase()]
  if (!type) return undefined
  const file = resolve(themeDir, requested)
  const rel = relative(themeDir, file)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined
  return { file, type }
}

/** Short content hash for a URL's `?v=`. */
export function assetVersion(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12)
}

/**
 * Versions for every declared file that exists. A missing file is left out
 * rather than failing the stylesheet: its URL is then emitted unversioned and
 * 404s visibly, which costs one ornament instead of the whole theme.
 */
export async function assetVersions(themeDir: string, paths: readonly string[]): Promise<Map<string, string>> {
  const versions = new Map<string, string>()
  await Promise.all(
    paths.map(async (path) => {
      const asset = resolveThemeAsset(themeDir, path, paths)
      if (!asset) return
      try {
        versions.set(path, assetVersion(await readFile(asset.file)))
      } catch {
        // Not there. See the doc comment.
      }
    }),
  )
  return versions
}

/** The served URL for a theme-relative path. Each segment is encoded; the separators are not. */
export function themeAssetUrl(path: string, version: string | undefined): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `${THEME_ASSET_PREFIX}${encoded}${version ? `?v=${version}` : ''}`
}
