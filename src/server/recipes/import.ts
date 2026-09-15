/**
 * Orchestrates a recipe import: fetch the page, try the exact strategy, fall
 * back to the heuristic one, and hand back an *unsaved* Recipe.
 *
 * Deliberately does not touch storage. The route this backs is a review step
 * — POST /api/recipes/import extracts and returns; a separate POST
 * /api/recipes persists what the household confirms. A card must not present
 * placeholder data as real, and neither may it persist a guess as reviewed.
 */
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

  const fetcher = options.fetcher ?? ((u: string) => fetchWithTimeout(u, 10_000))
  let html: string
  try {
    const res = await fetcher(url.toString())
    html = await res.text()
  } catch (error) {
    throw new RecipeImportError(
      `could not fetch the page: ${error instanceof Error ? error.message : 'unknown error'}`,
      'fetch-failed',
    )
  }

  const recipe = extractJsonLd(html, url.toString()) ?? extractFallback(html, url.toString())
  if (!recipe) {
    throw new RecipeImportError('no recipe could be extracted from this page', 'extraction-failed')
  }
  return recipe
}
