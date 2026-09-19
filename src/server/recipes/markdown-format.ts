/**
 * The on-disk shape of one recipe: YAML frontmatter for the fields a person
 * rarely touches, then plain Markdown lists for the ones they do.
 *
 * Pure — no filesystem — so the format can be tested without a directory and
 * the adapter stays a thin layer of reads, writes and renames.
 *
 * The writer is strict and the reader is lenient on purpose. The household
 * edits these files by hand, in whatever editor is nearest, and a recipe
 * typed from scratch will not look like one this module wrote: no
 * frontmatter, `*` bullets, `1)` numbering, headings without diacritics. All
 * of that has to read back as a recipe rather than as an error, or the
 * collection quietly shrinks every time someone edits it.
 */
import { parse, stringify } from 'yaml'

import type { Recipe } from '../domain/types.ts'

const INGREDIENTS_HEADING = 'Składniki'
const STEPS_HEADING = 'Kroki'

/** Keyed by {@link normalize}d heading text, so `Składniki`, `SKLADNIKI:` and `Ingredients` all land here. */
const SECTION_BY_HEADING: Record<string, 'ingredients' | 'steps'> = {
  skladniki: 'ingredients',
  ingredients: 'ingredients',
  kroki: 'steps',
  przygotowanie: 'steps',
  'sposob przygotowania': 'steps',
  steps: 'steps',
  instructions: 'steps',
  wykonanie: 'steps',
}

/**
 * Lowercase ASCII-ish text. `ł` is spelled out because it is a letter of its
 * own in Unicode, not `l` plus a combining mark, so NFD leaves it alone.
 */
function foldDiacritics(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function normalize(heading: string): string {
  return foldDiacritics(heading)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A filename-safe stem: `Żurek z jajkiem` → `zurek-z-jajkiem`. */
export function slugify(title: string): string {
  const slug = foldDiacritics(title)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
  return slug || 'przepis'
}

/** One list item is one line; a line break inside it would start a new item on read. */
function oneLine(item: string): string {
  return item.replace(/\s*[\r\n]+\s*/g, ' ').trim()
}

export function serializeRecipe(recipe: Recipe): string {
  const frontmatter: Record<string, unknown> = { title: recipe.title, tags: recipe.tags }
  if (recipe.sourceUrl) frontmatter.sourceUrl = recipe.sourceUrl
  frontmatter.importedAt = recipe.importedAt.toISOString()

  const ingredients = recipe.ingredients.map(oneLine).filter(Boolean)
  const steps = recipe.steps.map(oneLine).filter(Boolean)

  const lines = [
    '---',
    // lineWidth 0: a long title folded across lines is valid YAML and a trap
    // for the next person to edit it by hand.
    stringify(frontmatter, { lineWidth: 0 }).trimEnd(),
    '---',
    '',
    `## ${INGREDIENTS_HEADING}`,
    '',
    ...(ingredients.length ? [...ingredients.map((i) => `- ${i}`), ''] : []),
    `## ${STEPS_HEADING}`,
    '',
    ...steps.map((s, n) => `${n + 1}. ${s}`),
  ]
  return `${lines.join('\n').trimEnd()}\n`
}

function splitFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const lines = text.split('\n')
  if (lines[0]?.trimEnd() !== '---') return { data: {}, body: text }
  const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line))
  if (end === -1) throw new Error('frontmatter opened with --- but never closed')

  const data: unknown = parse(lines.slice(1, end).join('\n'))
  if (data !== null && (typeof data !== 'object' || Array.isArray(data))) {
    throw new Error('frontmatter is not a key: value mapping')
  }
  return { data: (data ?? {}) as Record<string, unknown>, body: lines.slice(end + 1).join('\n') }
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim()
    return text || undefined
  }
  return undefined
}

function readTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return raw.map(scalarText).filter((t): t is string => t !== undefined)
}

function readDate(value: unknown): Date | undefined {
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/

/**
 * `fallback.id` is the filename stem — the file name *is* the id, so a
 * recipe renamed on disk is a recipe with a new id, not a broken one.
 * `fallback.mtime` stands in for a missing or unreadable `importedAt`.
 *
 * Throws on malformed frontmatter: guessing around a broken YAML block could
 * silently drop the title or tags someone typed, so the caller gets to skip
 * the file and say which one it was.
 */
export function parseRecipeMarkdown(text: string, fallback: { id: string; mtime: Date }): Recipe {
  const { data, body } = splitFrontmatter(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'))

  let h1: string | undefined
  const lists = { ingredients: [] as string[], steps: [] as string[] }
  // Where items currently go, and the heading level that opened it: a deeper
  // heading the reader doesn't recognise (`### Ciasto` under `## Składniki`)
  // is a subsection of the list, not the end of it.
  let section: { list: string[]; level: number } | undefined
  let canContinue = false

  for (const line of body.split('\n')) {
    const heading = HEADING.exec(line)
    if (heading) {
      const level = heading[1]!.length
      const name = heading[2]!
      if (level === 1 && h1 === undefined) h1 = name.trim() || undefined
      const known = level <= 3 ? SECTION_BY_HEADING[normalize(name)] : undefined
      if (known) section = { list: lists[known], level }
      else if (section && level <= section.level) section = undefined
      canContinue = false
      continue
    }
    if (!section || line.trim() === '') continue

    const marker = LIST_MARKER.exec(line.trimStart())
    if (marker) {
      const item = line.trimStart().slice(marker[0].length).trim()
      if (item) section.list.push(item)
      canContinue = item !== ''
    } else if (/^\s/.test(line) && canContinue) {
      const last = section.list.length - 1
      section.list[last] = `${section.list[last]} ${line.trim()}`
    } else {
      section.list.push(line.trim())
      canContinue = true
    }
  }

  const title = scalarText(data.title) ?? h1 ?? fallback.id
  if (!title) throw new Error('recipe has no title')

  return {
    id: fallback.id,
    title,
    sourceUrl: scalarText(data.sourceUrl) ?? null,
    ingredients: lists.ingredients,
    steps: lists.steps,
    tags: readTags(data.tags),
    importedAt: readDate(data.importedAt) ?? fallback.mtime,
  }
}
