/**
 * Reads a web page's recipe with a model and returns it as structured data —
 * the "smart" half of URL import (recipes/import.ts).
 *
 * The deterministic extractors trust the markup: JSON-LD's field boundaries,
 * or "the first list is ingredients, the second is the method". Real pages
 * break that all the time — a blank line inside the method splits it in two,
 * a page publishes only the ingredients as structured data, a site puts
 * ingredients in `recipeInstructions`. The result was recipes with no steps, or
 * ingredients sitting in the steps. A model reads the page the way a person
 * does, so it decides what is a step.
 *
 * Its answer is not trusted either: it must be a JSON object of the exact
 * shape below, and a reply with no ingredients, no steps, or steps that are
 * really the ingredient list is sent back once with the problem named. What is
 * still unusable after that is an error — the caller falls back to the
 * deterministic result — never a guess dressed up as a recipe.
 *
 * Like the drafter and tagger this knows nothing about HTTP.
 */
import type { AiCallRepository } from '../ports/repositories.ts'
import type { ExtractedRecipe } from '../recipes/extract.ts'
import { pageToText } from '../recipes/page-text.ts'
import { estimateCostUsd, type ChatMessage, type KiloGatewayClient, type ModelCatalog } from '../upstream/kilo.ts'

export interface RecipeImportAgentDeps {
  aiCalls: AiCallRepository
  modelCatalog: Pick<ModelCatalog, 'get'>
  gateway: Pick<KiloGatewayClient, 'chatCompletionOnce'>
  model: string
}

export interface RecipeImportAgent {
  /**
   * `hint` is what the deterministic extractors found, if anything: shown to
   * the model as a possibly-wrong starting point, never as the answer.
   * Throws when no usable recipe came out.
   */
  extract(input: { html: string; sourceUrl: string; hint?: ExtractedRecipe }, signal?: AbortSignal): Promise<ExtractedRecipe>
}

/** A page's recipe as JSON is a few KB; this leaves room for a long one and for a model that thinks aloud first. */
const IMPORT_MAX_TOKENS = 4000
/** Someone is watching a spinner, but a smarter model on a long page is legitimately slower than the 45 s default. */
const IMPORT_TIMEOUT_MS = 90_000

export const RECIPE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'ingredients', 'steps', 'tags'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    ingredients: { type: 'array', items: { type: 'string' } },
    steps: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
  },
} as const

const SYSTEM_PROMPT =
  'Jesteś parserem przepisów kulinarnych. Dostajesz tekst strony internetowej i zwracasz z niego JEDEN przepis ' +
  'jako obiekt JSON — WYŁĄCZNIE JSON, bez komentarza i bez bloku kodu — o polach: ' +
  '{"title": string, "description": string, "ingredients": string[], "steps": string[], "tags": string[]}.\n' +
  'Zasady:\n' +
  '- ingredients: jeden składnik z ilością na element, w kolejności ze strony. Jeśli składniki są podzielone na ' +
  'grupy (np. „Ciasto”, „Sos”), zachowaj kolejność i dopisz grupę w nawiasie na końcu linii albo jako osobną pozycję.\n' +
  '- steps: sposób przygotowania — jeden krok (jedna czynność lub akapit) na element, w kolejności, bez numeracji. ' +
  'Puste linie, numery, nagłówki i reklamy w środku metody NIE dzielą jej na osobne przepisy ani nie kończą kroków: ' +
  'to nadal ta sama metoda. Nigdy nie umieszczaj składników w steps ani kroków w ingredients.\n' +
  '- Nie wymyślaj niczego: bierz tylko to, co jest na stronie. Jeśli strona nie podaje kroków, steps to []. ' +
  'Pomiń komentarze czytaczy, reklamy, „przepisy powiązane”, wartości odżywcze i historię autora.\n' +
  '- description: jedno–dwa zdania opisu ze strony, albo "" jeśli go nie ma.\n' +
  '- tags: 1-4 krótkie tagi małymi literami (rodzaj dania, główny składnik). ' +
  '- Zachowaj język oryginału.\n' +
  '- Jeśli na stronie nie ma przepisu, odpowiedz {"title": "", "description": "", "ingredients": [], "steps": [], "tags": []}. ' +
  'Jeśli jest kilka przepisów, weź główny (ten, o którym jest strona).'

export class RecipeImportAgentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecipeImportAgentError'
  }
}

function cleanList(value: unknown, strip: RegExp): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.replace(/\s+/g, ' ').replace(strip, '').trim())
    .filter(Boolean)
}

function normalise(line: string): string {
  return line.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/**
 * The reply as a recipe, or a sentence saying what is wrong with it — that
 * sentence is what the retry shows the model. Exported for the tests.
 */
export function validateRecipeReply(content: string, sourceUrl: string): { recipe: ExtractedRecipe } | { problem: string } {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  let parsed: unknown
  try {
    if (start === -1 || end <= start) throw new Error('no JSON object')
    parsed = JSON.parse(content.slice(start, end + 1))
  } catch {
    return { problem: 'Odpowiedź nie była poprawnym obiektem JSON.' }
  }
  if (!parsed || typeof parsed !== 'object') return { problem: 'Odpowiedź nie była obiektem JSON.' }
  const o = parsed as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title.replace(/\s+/g, ' ').trim() : ''
  const ingredients = cleanList(o.ingredients, /^[-*•]\s+/)
  const steps = cleanList(o.steps, /^(\d+[.)]\s+|[-*•]\s+)/)
  const description = typeof o.description === 'string' ? o.description.replace(/\s+/g, ' ').trim() : ''
  const tags = [...new Set(cleanList(o.tags, /^#/).map((t) => t.toLowerCase()))].slice(0, 4)

  if (!title) return { problem: 'Brak tytułu (lub strona nie zawiera przepisu).' }
  if (ingredients.length === 0) return { problem: 'Lista ingredients jest pusta — a przepis musi mieć składniki.' }

  if (steps.length > 0) {
    // Steps that are the ingredient list again: the exact failure this agent exists to fix.
    const known = new Set(ingredients.map(normalise))
    const echoed = steps.filter((s) => known.has(normalise(s))).length
    if (echoed / steps.length >= 0.5) {
      return { problem: 'Pole steps zawiera składniki zamiast kroków przygotowania. Kroki to czynności (np. „Wymieszaj…”).' }
    }
  }
  return { recipe: { title, description, sourceUrl, ingredients, steps, tags } }
}

export function createRecipeImportAgent(deps: RecipeImportAgentDeps): RecipeImportAgent {
  async function extract(
    input: { html: string; sourceUrl: string; hint?: ExtractedRecipe },
    signal?: AbortSignal,
  ): Promise<ExtractedRecipe> {
    const pageText = pageToText(input.html, input.sourceUrl)
    const parts = [`URL: ${input.sourceUrl}`, `TEKST STRONY:\n${pageText}`]
    if (input.hint) {
      parts.push(
        'DANE STRUKTURALNE ODCZYTANE AUTOMATYCZNIE (mogą być niepełne lub źle podzielone — sprawdź je z tekstem strony):\n' +
          JSON.stringify({ title: input.hint.title, ingredients: input.hint.ingredients, steps: input.hint.steps }),
      )
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: parts.join('\n\n') },
    ]

    const gatewayModel = await deps.modelCatalog.get(deps.model)
    let structured = true
    let lastProblem = 'brak odpowiedzi'

    // Attempt 2 exists to show the model what was wrong with attempt 1.
    for (let attempt = 1; attempt <= 2; attempt++) {
      let reply: Awaited<ReturnType<RecipeImportAgentDeps['gateway']['chatCompletionOnce']>>
      const request = {
        model: deps.model,
        messages,
        maxTokens: IMPORT_MAX_TOKENS,
        temperature: 0,
      }
      try {
        try {
          reply = await deps.gateway.chatCompletionOnce(
            {
              ...request,
              ...(structured
                ? { responseFormat: { type: 'json_schema', json_schema: { name: 'recipe', strict: true, schema: RECIPE_JSON_SCHEMA } } }
                : {}),
            },
            { signal, timeoutMs: IMPORT_TIMEOUT_MS },
          )
        } catch (err) {
          // Not every routed model accepts a json_schema; the prompt alone still
          // asks for the same JSON, so drop the constraint and try once more.
          if (!structured || signal?.aborted) throw err
          structured = false
          reply = await deps.gateway.chatCompletionOnce(request, { signal, timeoutMs: IMPORT_TIMEOUT_MS })
        }
      } catch (err) {
        throw new RecipeImportAgentError(`model call failed: ${err instanceof Error ? err.message : String(err)}`)
      }

      // Recorded before validating: the call was spent whether or not its reply is usable.
      await deps.aiCalls.record({
        conversationId: null,
        messageId: null,
        purpose: 'recipe-import',
        model: deps.model,
        promptTokens: reply.usage?.prompt_tokens ?? 0,
        completionTokens: reply.usage?.completion_tokens ?? 0,
        estimatedCostUsd: reply.usage ? estimateCostUsd(reply.usage, gatewayModel?.pricing ?? null) : 0,
      })

      const checked = validateRecipeReply(reply.content, input.sourceUrl)
      if ('recipe' in checked) {
        // A page that genuinely publishes no method is a thin but honest recipe;
        // the retry is for the cases a second look can actually fix.
        if (checked.recipe.steps.length > 0 || attempt === 2) return checked.recipe
        lastProblem = 'Pole steps jest puste, a strona zwykle zawiera sposób przygotowania — poszukaj go w tekście strony.'
      } else {
        lastProblem = checked.problem
      }
      messages.push(
        { role: 'assistant', content: reply.content },
        { role: 'user', content: `${lastProblem} Popraw i odpowiedz ponownie samym obiektem JSON.` },
      )
    }
    throw new RecipeImportAgentError(`model reply unusable: ${lastProblem}`)
  }

  return { extract }
}
