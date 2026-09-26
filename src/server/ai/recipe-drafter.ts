/**
 * Turns an assistant chat answer into an *unsaved* Recipe draft — the server
 * half of the chat card's `/przepis` command.
 *
 * Same contract as URL import (recipes/import.ts): extract and return, never
 * persist. The draft travels to the recipes card's review form, and ZAPISZ
 * there (POST /api/recipes) is still the only path into storage — a model's
 * guess at "the ingredients" is exactly the kind of extraction the household
 * has to see before it becomes a recipe.
 *
 * A model does the extraction rather than a Markdown heuristic: a chat answer
 * has no stable shape (headings in one reply, a prose paragraph in the next,
 * two alternative recipes in a third), and the model that wrote it is the
 * cheapest reader of it. Like ConversationService, this knows nothing about
 * HTTP — a future MCP tool can call it directly.
 */
import type { AiCallRepository, ConversationRepository } from '../ports/repositories.ts'
import type { ExtractedRecipe } from '../recipes/extract.ts'
import { estimateCostUsd, type KiloGatewayClient, type ModelCatalog } from '../upstream/kilo.ts'

export type RecipeDraftErrorReason =
  | 'no-such-conversation'
  | 'no-assistant-message'
  | 'not-a-recipe'
  | 'extraction-failed'

export class RecipeDraftError extends Error {
  /** Safe to send to the client verbatim: never carries message content. */
  readonly reason: RecipeDraftErrorReason

  constructor(message: string, reason: RecipeDraftErrorReason) {
    super(message)
    this.name = 'RecipeDraftError'
    this.reason = reason
  }
}

export interface RecipeDrafterDeps {
  conversations: ConversationRepository
  aiCalls: AiCallRepository
  modelCatalog: ModelCatalog
  gateway: Pick<KiloGatewayClient, 'chatCompletionOnce'>
}

export interface RecipeDrafter {
  /** Drafts from `messageId`, or from the thread's latest non-empty assistant message. */
  draftFromConversation(
    input: { conversationId: string; messageId?: string },
    signal?: AbortSignal,
  ): Promise<ExtractedRecipe>
}

const EXTRACTION_PROMPT =
  'Wyodrębnij przepis z wiadomości użytkownika. Odpowiedz WYŁĄCZNIE obiektem JSON, bez komentarza ' +
  'i bez bloku kodu, w formacie {"title": string, "ingredients": string[], "steps": string[], "tags": string[]}. ' +
  'ingredients: jeden składnik z ilością na element. steps: kroki w kolejności, jeden na element, bez numeracji. ' +
  'tags: 1-4 krótkie tagi małymi literami (rodzaj dania, główny składnik). Zachowaj język oryginału. ' +
  'Jeśli wiadomość zawiera kilka przepisów, wybierz pierwszy pełny. ' +
  'Jeśli nie zawiera żadnego przepisu, odpowiedz {"title": ""}.'

/** Enough for a long recipe's JSON; a reply cut off here fails to parse, honestly. */
const EXTRACTION_MAX_TOKENS = 2000

function cleanList(value: unknown, strip: RegExp): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.replace(/\s+/g, ' ').replace(strip, '').trim())
    .filter(Boolean)
}

/**
 * Tolerant of the ways models wrap JSON despite being told not to — a
 * ```json fence, a sentence before or after — by parsing the outermost
 * `{...}` span. Anything that still is not a usable recipe fails with a
 * reason rather than yielding a half-empty draft.
 */
export function parseRecipeDraft(content: string): ExtractedRecipe {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  let parsed: unknown
  try {
    if (start === -1 || end <= start) throw new Error('no JSON object in reply')
    parsed = JSON.parse(content.slice(start, end + 1))
  } catch {
    throw new RecipeDraftError('model reply was not valid JSON', 'extraction-failed')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new RecipeDraftError('model reply was not a JSON object', 'extraction-failed')
  }
  const o = parsed as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title.replace(/\s+/g, ' ').trim() : ''
  const ingredients = cleanList(o.ingredients, /^[-*•]\s+/)
  const steps = cleanList(o.steps, /^\d+[.)]\s+/)
  if (!title || (ingredients.length === 0 && steps.length === 0)) {
    throw new RecipeDraftError('the message does not contain a recipe', 'not-a-recipe')
  }
  const tags = [...new Set(cleanList(o.tags, /^#/).map((t) => t.toLowerCase()))]
  // Not asked of the model: same "no guess presented as authored data" reasoning as extractFallback.
  return { title, description: '', sourceUrl: null, ingredients, steps, tags }
}

export function createRecipeDrafter(deps: RecipeDrafterDeps): RecipeDrafter {
  async function draftFromConversation(
    input: { conversationId: string; messageId?: string },
    signal?: AbortSignal,
  ): Promise<ExtractedRecipe> {
    const conversation = await deps.conversations.get(input.conversationId)
    if (!conversation) throw new RecipeDraftError('no such conversation', 'no-such-conversation')

    const history = await deps.conversations.messages(input.conversationId)
    const source = input.messageId
      ? history.find((m) => m.id === input.messageId && m.role === 'assistant')
      : [...history].reverse().find((m) => m.role === 'assistant' && m.content.trim() !== '')
    if (!source) throw new RecipeDraftError('no assistant message to draft from', 'no-assistant-message')

    // The thread's own model: the household already chose what this
    // conversation costs, and a free model stays free for this call too.
    const model = conversation.model
    let reply: Awaited<ReturnType<RecipeDrafterDeps['gateway']['chatCompletionOnce']>>
    try {
      reply = await deps.gateway.chatCompletionOnce(
        {
          model,
          messages: [
            { role: 'system', content: EXTRACTION_PROMPT },
            { role: 'user', content: source.content },
          ],
          maxTokens: EXTRACTION_MAX_TOKENS,
          temperature: 0,
        },
        { signal },
      )
    } catch (err) {
      throw new RecipeDraftError(
        `extraction call failed: ${err instanceof Error ? err.message : String(err)}`,
        'extraction-failed',
      )
    }

    // Recorded before parsing: the call was spent whether or not its reply is usable.
    const gatewayModel = await deps.modelCatalog.get(model)
    await deps.aiCalls.record({
      conversationId: input.conversationId,
      messageId: null,
      purpose: 'recipe-extraction',
      model,
      promptTokens: reply.usage.prompt_tokens,
      completionTokens: reply.usage.completion_tokens,
      estimatedCostUsd: estimateCostUsd(reply.usage, gatewayModel?.pricing ?? null),
    })

    return parseRecipeDraft(reply.content)
  }

  return { draftFromConversation }
}
