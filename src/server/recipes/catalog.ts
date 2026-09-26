/**
 * The recipes card's view of the collection: every recipe as a summary
 * (title and tags — what a list row shows), a page at a time, with the full
 * recipe fetched only when one is opened.
 *
 * Pure, like extract.ts and rejection-log.ts: it takes the whole collection
 * and returns a page of it, so it is testable without Fastify or a
 * directory. The collection itself stays one Markdown file per recipe
 * (adapters/files/recipes.ts). Listing is a read-time concern over that
 * store, not a reason to replace it.
 */
import type { Recipe } from '../domain/types.ts'

export type RecipeSummary = Pick<Recipe, 'id' | 'title' | 'tags' | 'importedAt'>

export const DEFAULT_PAGE_SIZE = 30
export const MAX_PAGE_SIZE = 100
export const MAX_TAG_FACETS = 12

export interface CatalogQuery {
  tag?: string
  /** Full-text search; blank means no search. See scoreRecipe. */
  q?: string
  /** Facet filter: a recipe must carry every one (AND, like search terms). */
  tags?: string[]
  /** From a previous page's `nextCursor`; absent for the first page. */
  cursor?: string
  limit?: number
}

export interface TagFacet {
  tag: string
  /** Recipes in the current result carrying it — what would remain if it were added. */
  count: number
}

export interface CatalogPage {
  items: RecipeSummary[]
  /** Recipes matching the query, not the size of this page. */
  total: number
  /** `null` on the last page. */
  nextCursor: string | null
  /** The most common tags in the whole current result, not just this page. */
  tagFacets: TagFacet[]
}

/** Thrown for a cursor this module did not mint — the client's mistake, a 400. */
export class InvalidCursorError extends Error {
  constructor() {
    super('invalid cursor')
    this.name = 'InvalidCursorError'
  }
}

/**
 * The last row served, as its position in the list's own order. A keyset
 * rather than an offset: a recipe saved mid-scroll would shift an offset by
 * one and serve the boundary row twice; a keyset never repeats a row.
 */
interface CursorKey {
  /** Search score (0 without a query) — see scoreRecipe. */
  s: number
  t: number
  id: string
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string): CursorKey {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw new InvalidCursorError()
  }
  const key = parsed as Partial<CursorKey> | null
  if (!key || typeof key.t !== 'number' || !Number.isFinite(key.t) || typeof key.id !== 'string') {
    throw new InvalidCursorError()
  }
  const score = key.s ?? 0
  if (typeof score !== 'number' || !Number.isFinite(score)) throw new InvalidCursorError()
  return { s: score, t: key.t, id: key.id }
}

export function summarize(recipe: Recipe): RecipeSummary {
  return { id: recipe.id, title: recipe.title, tags: recipe.tags, importedAt: recipe.importedAt }
}

const MAX_QUERY_LENGTH = 200
const MAX_TERMS = 8

/**
 * Lowercase, accents folded, so `zurek` finds `Żurek` — Polish letters are a
 * long-press on the kiosk keyboard. `ł` has no decomposition and is mapped
 * by hand.
 */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
}

export function searchTerms(q: string | undefined): string[] {
  if (!q) return []
  const terms = normalizeSearchText(q.slice(0, MAX_QUERY_LENGTH)).split(/\s+/).filter(Boolean)
  return [...new Set(terms)].slice(0, MAX_TERMS)
}

/** Searched fields, highest priority first — the order results rank in. */
function searchFields(recipe: Recipe): string[] {
  return [
    recipe.title,
    recipe.tags.join(' '),
    recipe.ingredients.join(' '),
    recipe.steps.join(' '),
    recipe.description,
    recipe.sourceUrl ?? '',
  ].map(normalizeSearchText)
}

/**
 * `undefined` when some term is in no field (terms are ANDed: typing more
 * narrows). Otherwise each term counts once, at the best field it appears
 * in, as a base-9 digit for that field: `Σ 9^(5 - field)`. With at most 8
 * terms no digit carries, so comparing scores compares "terms in the title,
 * then terms in tags, …" lexicographically — a title hit outranks any
 * number of hits further down — and the score is one number a cursor can hold.
 */
export function scoreRecipe(recipe: Recipe, terms: readonly string[]): number | undefined {
  if (terms.length === 0) return 0
  const fields = searchFields(recipe)
  let score = 0
  for (const term of terms) {
    const best = fields.findIndex((f) => f.includes(term))
    if (best === -1) return undefined
    score += 9 ** (fields.length - 1 - best)
  }
  return score
}

function keyOf(recipe: Recipe, score: number): CursorKey {
  return { s: score, t: recipe.importedAt.getTime(), id: recipe.id }
}

/** Best match first, then newest, then by id — without a query, the same order RecipeRepository.list uses. */
function compareKeys(a: CursorKey, b: CursorKey): number {
  return b.s - a.s || b.t - a.t || a.id.localeCompare(b.id)
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit)))
}

export function listCatalog(recipes: readonly Recipe[], query: CatalogQuery = {}): CatalogPage {
  const terms = searchTerms(query.q)
  const required = [...(query.tag ? [query.tag] : []), ...(query.tags ?? [])]
  const matching: { recipe: Recipe; key: CursorKey }[] = []
  for (const recipe of recipes) {
    if (!required.every((t) => recipe.tags.includes(t))) continue
    const score = scoreRecipe(recipe, terms)
    if (score !== undefined) matching.push({ recipe, key: keyOf(recipe, score) })
  }
  matching.sort((a, b) => compareKeys(a.key, b.key))

  const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
  const start = after ? matching.findIndex((m) => compareKeys(m.key, after) > 0) : 0
  const limit = clampLimit(query.limit)
  const page = start === -1 ? [] : matching.slice(start, start + limit)
  const last = page[page.length - 1]
  const hasMore = start !== -1 && start + limit < matching.length

  return {
    items: page.map((m) => summarize(m.recipe)),
    total: matching.length,
    nextCursor: hasMore && last ? encodeCursor(last.key) : null,
    tagFacets: tagFacets(
      matching.map((m) => m.recipe),
      query.tags ?? [],
      query.tag,
    ),
  }
}

/**
 * Counted over the whole current result. Selected tags are always kept,
 * past the cap too, so a selected chip can always be un-tapped. The layout's
 * fixed tag is left out: every result carries it, so it is not a choice.
 */
function tagFacets(result: readonly Recipe[], selected: readonly string[], fixed: string | undefined): TagFacet[] {
  const counts = new Map<string, number>()
  for (const recipe of result) {
    for (const tag of new Set(recipe.tags)) if (tag !== fixed) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  const ranked = [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  const top = ranked.slice(0, MAX_TAG_FACETS)
  for (const tag of selected) {
    if (!top.some((f) => f.tag === tag)) top.push({ tag, count: counts.get(tag) ?? 0 })
  }
  return top
}
