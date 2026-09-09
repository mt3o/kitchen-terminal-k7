/**
 * Orchestrates a recipe import: fetch the page, try the exact strategy, fall
 * back to the heuristic one, and hand back an *unsaved* Recipe.
 *
 * Deliberately does not touch storage. The route this backs is a review step
 * — POST /api/recipes/import extracts and returns; a separate POST
 * /api/recipes persists what the household confirms. A card must not present
 * placeholder data as real, and neither may it persist a guess as reviewed.
 */
import { isPrivateAddress } from '../security/network.ts'
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

/**
 * Only http/https, and only a public-looking host.
 *
 * This is a genuine but partial guard, disclosed as such in the plan: a
 * literal private IP is caught, a hostname that *resolves* to one is not,
 * because that needs a DNS lookup this function does not perform. Full
 * DNS-rebinding protection for outbound fetches is out of this change's
 * scope — see plan.md's Risks section.
 */
function assertImportable(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RecipeImportError(`unsupported URL scheme ${url.protocol}`, 'invalid-url')
  }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || isPrivateAddress(host)) {
    throw new RecipeImportError('refusing to import from a local or private address', 'invalid-url')
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
