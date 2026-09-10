/**
 * ConversationService owns one chat turn end to end: the rolling window,
 * per-model context budgeting, compacting, the gateway call, and logging the
 * spend. It knows nothing about Fastify, HTTP or SSE — `streamTurn` is a
 * plain async generator over domain-shaped events, which is what satisfies
 * the project's standing rule that this service stay decoupled from the chat
 * HTTP endpoint (docs/handoff/HANDOFF.md, CLAUDE.md): a future MCP tool or a
 * dedicated skill can drive a turn by iterating the same generator, with no
 * HTTP layer involved at all. The route (`routes/chat.ts`) is the only place
 * that ever turns a `ChatEvent` into bytes on the wire.
 *
 * Compacting persists without any new schema: the summary is an ordinary
 * `Message` with `role: 'system'` and its content prefixed `[COMPACT] `.
 * Building the working window for a turn scans history oldest-first and, if
 * such a message exists, starts from the most recent one — older messages
 * stay in the database untouched (the full transcript still shows them) but
 * are excluded from what is sent to the gateway. A hard, estimator-independent
 * rolling-window safety net runs after compacting regardless of whether it
 * ran or succeeded: it keeps dropping the oldest non-summary message from the
 * working window until the estimated token count fits the model's budget, so
 * an inaccurate `estimateTokens` guess can never result in an over-budget
 * request reaching the gateway.
 */
import type { AiCallRepository, ConversationRepository } from '../ports/repositories.ts'
import type { Message } from '../domain/types.ts'
import { estimateCostUsd, type ChatMessage, type GatewayUsage, type KiloGatewayClient, type ModelCatalog } from '../upstream/kilo.ts'
import { estimateTokens } from './tokens.ts'

const COMPACT_PREFIX = '[COMPACT] '
const DEFAULT_COMPACTING_MODEL = 'kilo-auto/efficient'
const COMPACT_TAIL_SIZE = 4
/** Used only when the model catalogue has nothing for the requested model. */
const FALLBACK_CONTEXT_LENGTH = 8000

export interface BudgetConfig {
  /** Percent of the whole context window reserved for the model's response. */
  contextWindowMarginPercent: number
  /** Percent of the remaining history budget that, once filled, triggers compacting. */
  compactingThresholdPercent: number
}

export interface ChatTurnInput {
  conversationId: string
  model: string
  userContent: string
  budget: BudgetConfig
}

export type ChatEvent =
  | { type: 'compacting'; summarisedMessageCount: number }
  | { type: 'delta'; content: string }
  | {
      type: 'done'
      message: Message
      usage: { promptTokens: number; completionTokens: number; costUsd: number }
    }
  | { type: 'error'; error: string }

export interface ConversationServiceDeps {
  conversations: ConversationRepository
  aiCalls: AiCallRepository
  modelCatalog: ModelCatalog
  gateway: Pick<KiloGatewayClient, 'chatCompletion' | 'chatCompletionOnce'>
  /** Defaults to a real, live model id from the Kilo catalogue — see kilo.ts. */
  compactingModel?: string
}

export interface ConversationService {
  streamTurn(input: ChatTurnInput, signal?: AbortSignal): AsyncGenerator<ChatEvent>
}

function toChatMessage(m: Message): ChatMessage {
  return { role: m.role, content: m.content }
}

function isCompactSummary(m: Message): boolean {
  return m.role === 'system' && m.content.startsWith(COMPACT_PREFIX)
}

function windowTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
}

/** The working window since the most recent compaction point, inclusive. */
function selectWorkingWindow(history: Message[]): Message[] {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i]
    if (m && isCompactSummary(m)) return history.slice(i)
  }
  return history.slice()
}

/**
 * Drop the oldest non-summary message repeatedly until the window fits the
 * budget. Never drops the summary itself (there is at most one, and it is
 * what makes the rest of history affordable) and always leaves at least one
 * message, however oversized, rather than sending an empty request.
 */
function dropOldestUntilWithinBudget(working: Message[], historyBudgetTokens: number): Message[] {
  let trimmed = working
  while (windowTokens(trimmed) > historyBudgetTokens && trimmed.length > 1) {
    const dropIndex = trimmed.findIndex((m, i) => i < trimmed.length - 1 && !isCompactSummary(m))
    if (dropIndex === -1) break
    trimmed = [...trimmed.slice(0, dropIndex), ...trimmed.slice(dropIndex + 1)]
  }
  return trimmed
}

export function createConversationService(deps: ConversationServiceDeps): ConversationService {
  const compactingModel = deps.compactingModel ?? DEFAULT_COMPACTING_MODEL

  async function maybeCompact(
    working: Message[],
    conversationId: string,
    compactingTriggerTokens: number,
    signal: AbortSignal | undefined,
  ): Promise<{ working: Message[]; event?: ChatEvent }> {
    if (windowTokens(working) <= compactingTriggerTokens || working.length <= COMPACT_TAIL_SIZE) {
      return { working }
    }

    const tail = working.slice(-COMPACT_TAIL_SIZE)
    const head = working.slice(0, -COMPACT_TAIL_SIZE).filter((m) => !isCompactSummary(m))
    if (head.length === 0) return { working }

    try {
      const summaryPrompt: ChatMessage[] = [
        {
          role: 'system',
          content:
            'Streść poniższą historię rozmowy zwięźle i rzeczowo, po polsku, zachowując wszystkie ' +
            'fakty i ustalenia istotne dla dalszej rozmowy. Nie dodawaj własnych komentarzy.',
        },
        ...head.map(toChatMessage),
      ]
      const { content: summary, usage } = await deps.gateway.chatCompletionOnce(
        { model: compactingModel, messages: summaryPrompt },
        { signal },
      )
      const compactingGatewayModel = await deps.modelCatalog.get(compactingModel)
      const costUsd = estimateCostUsd(usage, compactingGatewayModel?.pricing ?? null)

      const summaryMessage = await deps.conversations.addMessage({
        conversationId,
        role: 'system',
        content: `${COMPACT_PREFIX}${summary}`,
      })
      await deps.aiCalls.record({
        conversationId,
        messageId: null,
        purpose: 'compacting',
        model: compactingModel,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        estimatedCostUsd: costUsd,
      })
      return {
        working: [summaryMessage, ...tail],
        event: { type: 'compacting', summarisedMessageCount: head.length },
      }
    } catch {
      // Compacting is an optimisation, not a requirement for correctness: the
      // hard rolling-window drop below still guarantees the budget is met, so
      // a summarisation failure degrades the turn (a shorter effective
      // history) rather than failing it outright.
      return { working }
    }
  }

  async function* streamTurn(input: ChatTurnInput, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    const { conversationId, model, userContent, budget } = input

    // 1. Persist the user's own message immediately — a mid-stream failure
    // later must not lose what the person actually typed.
    await deps.conversations.addMessage({ conversationId, role: 'user', content: userContent })

    const gatewayModel = await deps.modelCatalog.get(model)
    const contextLength =
      gatewayModel && gatewayModel.contextLength > 0 ? gatewayModel.contextLength : FALLBACK_CONTEXT_LENGTH
    const historyBudgetTokens = Math.floor(contextLength * (1 - budget.contextWindowMarginPercent / 100))
    const compactingTriggerTokens = Math.floor(historyBudgetTokens * (budget.compactingThresholdPercent / 100))

    const history = await deps.conversations.messages(conversationId)
    let working = selectWorkingWindow(history)

    const compacted = await maybeCompact(working, conversationId, compactingTriggerTokens, signal)
    working = compacted.working
    if (compacted.event) yield compacted.event

    // Hard safety net, independent of whether compacting ran or helped.
    working = dropOldestUntilWithinBudget(working, historyBudgetTokens)

    let assistantContent = ''
    let finalUsage: GatewayUsage | undefined
    try {
      for await (const chunk of deps.gateway.chatCompletion({ model, messages: working.map(toChatMessage) }, { signal })) {
        const delta = chunk.choices[0]?.delta.content
        if (delta) {
          assistantContent += delta
          yield { type: 'delta', content: delta }
        }
        if (chunk.usage) finalUsage = chunk.usage
      }
    } catch (err) {
      yield { type: 'error', error: err instanceof Error ? err.message : String(err) }
      return
    }

    if (!finalUsage) {
      // The gateway is expected to always send a final usage-carrying chunk
      // (stream_options.include_usage is always set) — this is a genuine
      // protocol surprise, not a normal empty response.
      yield { type: 'error', error: 'gateway stream ended without usage information' }
      return
    }

    const assistantMessage = await deps.conversations.addMessage({
      conversationId,
      role: 'assistant',
      content: assistantContent,
    })
    const costUsd = estimateCostUsd(finalUsage, gatewayModel?.pricing ?? null)
    await deps.aiCalls.record({
      conversationId,
      messageId: assistantMessage.id,
      purpose: 'chat',
      model,
      promptTokens: finalUsage.prompt_tokens,
      completionTokens: finalUsage.completion_tokens,
      estimatedCostUsd: costUsd,
    })
    yield {
      type: 'done',
      message: assistantMessage,
      usage: { promptTokens: finalUsage.prompt_tokens, completionTokens: finalUsage.completion_tokens, costUsd },
    }
  }

  return { streamTurn }
}
