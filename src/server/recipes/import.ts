/**
 * Orchestrates a recipe import: fetch the page, try the exact strategy, fall
 * back to the heuristic one, and hand back an *unsaved* Recipe.
 *
 * Deliberately does not touch storage. The route this backs is a review step
 * — POST /api/recipes/import extracts and returns; a separate POST
 * /api/recipes persists what the household confirms. A card must not present
 * placeholder data as real, and neither may it persist a guess as reviewed.
 */
import { resolvePinned, type PinnedResolution } from '../security/dns-pin.ts'
import { isFetchableUrl } from '../security/network.ts'
import { fetchWithTimeout } from '../upstream/freshness.ts'
import { extractFallback, extractJsonLd, type ExtractedRecipe } from './extract.ts'

export type RecipeImportErrorReason = 'invalid-url' | 'fetch-failed' | 'extraction-failed'

export class RecipeImportError extends Error {
  /** Safe to send to the client verbatim: never carries page content or a stack. */
  readonly reason: RecipeImportErrorReason

  constructor(message: string, reason: RecipeImportErrorReason) {
    super(message)
    this.name = 'RecipeImportError'
    this.reason = reason
  }
}

/** `isFetchableUrl` (`security/network.ts`), narrowed to this module's own error type. */
function assertImportable(url: URL): void {
  if (!isFetchableUrl(url)) {
    throw new RecipeImportError('refusing to import from a local, private, or non-http(s) address', 'invalid-url')
  }
}

export interface ImportRecipeOptions {
  /** Injectable so tests never touch the network. */
  fetcher?: (url: string) => Promise<{ text(): Promise<string> }>
}

export async function importRecipeFromUrl(rawUrl: string, options: ImportRecipeOptions = {}): Promise<ExtractedRecipe> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new RecipeImportError('not a valid URL', 'invalid-url')
  }
  assertImportable(url)

  let html: string
  if (options.fetcher) {
    // Test injection — no real network, so no DNS resolution happens at all.
    try {
      const res = await options.fetcher(url.toString())
      html = await res.text()
    } catch (error) {
      throw new RecipeImportError(
        `could not fetch the page: ${error instanceof Error ? error.message : 'unknown error'}`,
        'fetch-failed',
      )
    }
  } else {
    // assertImportable only checked the literal address in the URL — a
    // hostname that *resolves* to one is not caught by that (the
    // household's own LAN A records, localtest.me, 127.0.0.1.nip.io — found
    // live, 2026-09-15, against the deployed server via a real canary
    // listener). resolvePinned closes that: one DNS lookup, reject if any
    // answer is private, then connect only to the vetted address — never
    // re-resolving, so a later DNS answer can't swap the target after the
    // check (DNS rebinding). 'error' rather than the default 'follow' for
    // the same reason a plain hostname check isn't enough on its own: a
    // public URL could still 3xx to an internal one.
    let pinned: PinnedResolution
    try {
      pinned = await resolvePinned(url.hostname)
    } catch (error) {
      throw new RecipeImportError(
        `refusing to import: ${error instanceof Error ? error.message : 'unresolvable or unsafe host'}`,
        'invalid-url',
      )
    }
    try {
      const res = await fetchWithTimeout(url.toString(), 10_000, undefined, 'error', pinned.dispatcher)
      // Read the body before closing: the dispatcher owns the connection
      // the response streams over.
      html = await res.text()
    } catch (error) {
      throw new RecipeImportError(
        `could not fetch the page: ${error instanceof Error ? error.message : 'unknown error'}`,
        'fetch-failed',
      )
    } finally {
      pinned.close()
    }
  }

  const recipe = extractJsonLd(html, url.toString()) ?? extractFallback(html, url.toString())
  if (!recipe) {
    throw new RecipeImportError('no recipe could be extracted from this page', 'extraction-failed')
  }
  return recipe
}
