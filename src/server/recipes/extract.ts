/**
 * Recipe extraction: two genuinely separate strategies, tried in order by
 * `importRecipeFromUrl` (see ./import.ts).
 *
 * `extractJsonLd` reads the structured data a site chose to publish —
 * schema.org/Recipe is exact when present, so it always wins when it parses.
 * `extractFallback` is a distinct, swappable heuristic for pages that publish
 * no structured data at all: Readability isolates the article, then a
 * list-shaped heuristic guesses which list is the ingredients and which is the
 * method. The two are kept apart on purpose — mixing signals from an exact
 * source with signals from a guess would make a wrong guess undetectable.
 */
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

import type { Recipe } from '../domain/types.ts'

/** What both strategies produce: everything but storage identity. */
export type ExtractedRecipe = Omit<Recipe, 'id' | 'importedAt'>

const MIN_TITLE_LENGTH = 1
const MIN_LIST_ITEMS = 2
/** A recipe ingredient line is short. A paragraph that ends up in the same
 *  list by mistake is not — this is what tells the two apart without reading
 *  the words at all. */
const MAX_LIST_ITEM_LENGTH = 200

function text(node: { textContent: string | null } | null | undefined): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function toStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return []
}

/**
 * `recipeInstructions` is the single messiest field in the vocabulary: a bare
 * string, a newline-joined string, an array of strings, an array of
 * `HowToStep`, or an array of `HowToSection` each nesting its own
 * `itemListElement` of `HowToStep`. All of them collapse to a flat step list.
 */
function extractInstructions(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(/\r?\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (!Array.isArray(value)) return []
  const steps: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      steps.push(entry.trim())
      continue
    }
    if (entry && typeof entry === 'object') {
      const o = entry as Record<string, unknown>
      const type = o['@type']
      if (type === 'HowToSection' && Array.isArray(o.itemListElement)) {
        steps.push(...extractInstructions(o.itemListElement))
        continue
      }
      if (typeof o.text === 'string') {
        steps.push(o.text.trim())
        continue
      }
      if (typeof o.name === 'string') {
        steps.push(o.name.trim())
      }
    }
  }
  return steps.filter(Boolean)
}

function extractTags(node: Record<string, unknown>): string[] {
  const keywords = node.keywords
  const keywordList = typeof keywords === 'string' ? keywords.split(',') : toStringArray(keywords)
  const raw = [...keywordList, ...toStringArray(node.recipeCategory)]
  return [...new Set(raw.map((s) => s.trim()).filter(Boolean))]
}

/** `@type` may be a bare string or an array carrying several types at once. */
function hasType(node: Record<string, unknown>, wanted: string): boolean {
  const type = node['@type']
  if (typeof type === 'string') return type === wanted
  if (Array.isArray(type)) return type.includes(wanted)
  return false
}

/** JSON-LD nests real nodes under `@graph`, or ships one node, or an array of
 *  them — walk all three shapes looking for the first schema.org/Recipe. */
function findRecipeNode(parsed: unknown): Record<string, unknown> | undefined {
  const candidates: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    const node = candidate as Record<string, unknown>
    if (hasType(node, 'Recipe')) return node
    if (Array.isArray(node['@graph'])) {
      const nested = findRecipeNode(node['@graph'])
      if (nested) return nested
    }
  }
  return undefined
}

export function extractJsonLd(html: string, sourceUrl: string): ExtractedRecipe | undefined {
  const dom = new JSDOM(html, { url: sourceUrl })
  try {
    const scripts = dom.window.document.querySelectorAll('script[type="application/ld+json"]')
    for (const script of scripts) {
      let parsed: unknown
      try {
        parsed = JSON.parse(script.textContent ?? '')
      } catch {
        continue // One malformed block must not sink every other block on the page.
      }
      const node = findRecipeNode(parsed)
      if (!node) continue
      const title = typeof node.name === 'string' ? node.name.trim() : ''
      if (title.length < MIN_TITLE_LENGTH) continue
      return {
        title,
        sourceUrl,
        ingredients: toStringArray(node.recipeIngredient ?? node.ingredients),
        steps: extractInstructions(node.recipeInstructions),
        tags: extractTags(node),
      }
    }
    return undefined
  } finally {
    dom.window.close()
  }
}

/** Does this list look like ingredients/steps rather than, say, a nav menu or
 *  a related-recipes teaser? Short items, at least a couple of them. */
function looksLikeRecipeList(items: string[]): boolean {
  return (
    items.length >= MIN_LIST_ITEMS &&
    items.every((item) => item.length > 0 && item.length <= MAX_LIST_ITEM_LENGTH)
  )
}

export function extractFallback(html: string, sourceUrl: string): ExtractedRecipe | undefined {
  const dom = new JSDOM(html, { url: sourceUrl })
  let tags: string[] = []
  try {
    // Keywords live in the page's <head>, which Readability discards along
    // with everything else outside the article body — read it here, first.
    const keywordsMeta = dom.window.document.querySelector('meta[name="keywords"]')
    tags = (keywordsMeta?.getAttribute('content') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    // Readability mutates the document it is given, so this pass owns its own
    // DOM rather than sharing one with the keywords read above.
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    if (!article?.title || !article.content) return undefined

    const contentDom = new JSDOM(article.content)
    try {
      const lists = [...contentDom.window.document.querySelectorAll('ul, ol')]
        .map((list) => [...list.querySelectorAll('li')].map((li) => text(li)))
        .filter(looksLikeRecipeList)

      const ingredients = lists[0] ?? []
      // A page with an article-shaped body but no list-shaped block at all is
      // not a recipe this heuristic can find — every real recipe page has at
      // least an ingredients list. Returning a title-only "recipe" here would
      // be exactly the placeholder-presented-as-real failure the review step
      // exists to prevent, so an empty ingredients list is a failed
      // extraction, not a thin one.
      if (ingredients.length === 0) return undefined
      // A second list-shaped block is almost always the method; a page with
      // only one list-shaped block genuinely has no fallback steps to offer,
      // which is honest — a made-up "step 1: see ingredients" would not be.
      const steps = lists[1] ?? []

      return {
        title: article.title.trim(),
        sourceUrl,
        ingredients,
        steps,
        tags,
      }
    } finally {
      contentDom.window.close()
    }
  } finally {
    dom.window.close()
  }
}
