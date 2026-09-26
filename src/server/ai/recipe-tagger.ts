/**
 * Fills in tags for a recipe saved without any — one model call inside
 * POST /api/recipes, prompted from what the household already reviewed.
 *
 * Not a breach of review-before-save (recipes/import.ts, recipe-drafter.ts):
 * POST /api/recipes is still reached only through ZAPISZ, tags are the one
 * field the household left empty, and the saved response carries them so the
 * card shows them at once and EDYTUJ can change them. Synchronous rather than
 * a save-then-retag job, because a background re-save would race an EDYTUJ
 * opened right after ZAPISZ and the file store has no compare-and-set.
 *
 * Like the drafter, this knows nothing about HTTP.
 */
import type { Recipe } from '../domain/types.ts'
import type { AiCallRepository } from '../ports/repositories.ts'
import { estimateCostUsd, type KiloGatewayClient, type ModelCatalog } from '../upstream/kilo.ts'

export type TaggableRecipe = Pick<Recipe, 'title' | 'description' | 'ingredients' | 'steps'>

export interface RecipeTaggerDeps {
  aiCalls: AiCallRepository
  modelCatalog: Pick<ModelCatalog, 'get'>
  gateway: Pick<KiloGatewayClient, 'chatCompletionOnce'>
}

export interface RecipeTagger {
  /** Throws when the call itself fails; an unusable reply yields `[]`. */
  suggestTags(recipe: TaggableRecipe, signal?: AbortSignal): Promise<string[]>
}

/** No conversation to borrow a model from, and a chore like this should stay free. */
export const TAGGING_MODEL = 'kilo-auto/free'

/** The gateway's own 45 s default is too long for someone waiting on ZAPISZ. */
export const TAGGING_TIMEOUT_MS = 15_000

const MAX_TAGS = 4

const TAGGING_PROMPT =
  'Zaproponuj tagi dla przepisu z wiadomości użytkownika. Odpowiedz WYŁĄCZNIE obiektem JSON, bez komentarza ' +
  'i bez bloku kodu, w formacie {"tags": string[]}. ' +
  `tags: 1-${MAX_TAGS} krótkie tagi małymi literami (rodzaj dania, główny składnik, kuchnia). ` +
  'Pisz w języku przepisu.'

/** A small budget: the reply is a handful of words. */
const TAGGING_MAX_TOKENS = 200

export function buildTaggingInput(recipe: TaggableRecipe): string {
  const parts = [`Tytuł: ${recipe.title}`]
  if (recipe.description.trim()) parts.push(`Opis: ${recipe.description.trim()}`)
  if (recipe.ingredients.length) parts.push(`Składniki:\n${recipe.ingredients.map((i) => `- ${i}`).join('\n')}`)
  if (recipe.steps.length) parts.push(`Kroki:\n${recipe.steps.map((s, n) => `${n + 1}. ${s}`).join('\n')}`)
  return parts.join('\n\n')
}

/**
 * Same outermost-`{...}` tolerance as parseRecipeDraft, but never throws:
 * the only caller treats "no tags" as the failure, whatever caused it.
 */
export function parseRecipeTags(content: string): string[] {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(content.slice(start, end + 1))
  } catch {
    return []
  }
  const tags = (parsed as { tags?: unknown } | null)?.tags
  if (!Array.isArray(tags)) return []
  const cleaned = tags
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.replace(/\s+/g, ' ').trim().replace(/^#/, '').trim().toLowerCase())
    .filter(Boolean)
  return [...new Set(cleaned)].slice(0, MAX_TAGS)
}

export function createRecipeTagger(deps: RecipeTaggerDeps): RecipeTagger {
  async function suggestTags(recipe: TaggableRecipe, signal?: AbortSignal): Promise<string[]> {
    const reply = await deps.gateway.chatCompletionOnce(
      {
        model: TAGGING_MODEL,
        messages: [
          { role: 'system', content: TAGGING_PROMPT },
          { role: 'user', content: buildTaggingInput(recipe) },
        ],
        maxTokens: TAGGING_MAX_TOKENS,
        temperature: 0,
      },
      { signal, timeoutMs: TAGGING_TIMEOUT_MS },
    )

    // Recorded before parsing: the call was spent whether or not its reply is
    // usable. Cost lookup is best-effort, as in ascii-art.ts.
    const gatewayModel = await deps.modelCatalog.get(TAGGING_MODEL).catch(() => undefined)
    await deps.aiCalls.record({
      conversationId: null,
      messageId: null,
      purpose: 'recipe-tagging',
      model: TAGGING_MODEL,
      promptTokens: reply.usage.prompt_tokens,
      completionTokens: reply.usage.completion_tokens,
      estimatedCostUsd: estimateCostUsd(reply.usage, gatewayModel?.pricing ?? null),
    })

    return parseRecipeTags(reply.content)
  }

  return { suggestTags }
}

/**
 * The route's whole policy, kept out of index.ts so it can be tested: tags
 * the household typed are never touched, and a failed or empty suggestion
 * saves the recipe untagged rather than failing the save.
 */
export async function fillMissingTags(
  recipe: TaggableRecipe & { tags: string[] },
  tagger: RecipeTagger | undefined,
  onError: (err: unknown) => void,
): Promise<string[]> {
  if (recipe.tags.length > 0 || !tagger) return recipe.tags
  try {
    const tags = await tagger.suggestTags(recipe)
    if (tags.length === 0) onError(new Error('model returned no usable tags'))
    return tags
  } catch (err) {
    onError(err)
    return []
  }
}
