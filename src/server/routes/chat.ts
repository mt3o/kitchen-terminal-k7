/**
 * Chat routes: model catalogue, conversation CRUD, the SSE turn endpoint, and
 * the cost-history view. Kept in its own module rather than inline in
 * `index.ts` — that file is a single flat module every Faza-4/5 sibling
 * worktree also edits, so this phase's whole route surface is one small,
 * additive registration call there instead of a block of new routes mixed in.
 *
 * This module has no ConversationService logic of its own: it is a thin
 * adapter that turns HTTP requests into `streamTurn` calls and `ChatEvent`s
 * into SSE frames, exactly the boundary `[node:4730c1bc]` (CONVSERVICE)
 * requires.
 */
import type { FastifyInstance } from 'fastify'

import type { ConversationService } from '../ai/conversation-service.ts'
import type { ModelCatalog } from '../upstream/kilo.ts'
import type { AiCallRepository, ConversationRepository } from '../ports/repositories.ts'

/** Defaults mirror docs/handoff/layout.schema.yaml's params.chat. */
const DEFAULT_MARGIN_PERCENT = 20
const DEFAULT_COMPACTING_THRESHOLD_PERCENT = 80
const DEFAULT_COST_HISTORY_DAYS = 30

export interface ChatRouteDeps {
  conversations: ConversationRepository
  aiCalls: AiCallRepository
  modelCatalog: ModelCatalog
  conversationService: ConversationService
  /** Wraps Sentry.captureException so this module never imports observability directly. */
  reportError: (err: unknown, extra?: Record<string, unknown>) => void
}

function clampPercent(raw: unknown, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback
}

export async function registerChatRoutes(app: FastifyInstance, deps: ChatRouteDeps): Promise<void> {
  app.get('/api/gateway/models', async () => {
    const models = await deps.modelCatalog.list()
    return models.map((m) => ({ id: m.id, name: m.name, contextLength: m.contextLength, pricing: m.pricing }))
  })

  app.get('/api/chat/conversations', async (req) => {
    const limit = Number((req.query as { limit?: string }).limit)
    return deps.conversations.list(Number.isFinite(limit) && limit > 0 ? limit : undefined)
  })

  app.post('/api/chat/conversations', async (req, reply) => {
    const body = req.body as { model?: unknown; title?: unknown }
    if (typeof body?.model !== 'string' || body.model.trim() === '') {
      return reply.code(400).send({ error: 'model is required' })
    }
    const conversation = await deps.conversations.create({
      model: body.model,
      title: typeof body.title === 'string' && body.title.trim() !== '' ? body.title.trim() : null,
    })
    return reply.code(201).send(conversation)
  })

  app.get('/api/chat/conversations/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string }
    const conversation = await deps.conversations.get(id)
    if (!conversation) return reply.code(404).send({ error: 'no such conversation' })
    return deps.conversations.messages(id)
  })

  /**
   * The one streaming endpoint in this codebase. `stream_options.include_usage`
   * is always requested from the gateway (see upstream/kilo.ts), so the SSE
   * frames sent downstream are: zero or more `event: compacting`/`event: delta`,
   * then exactly one of `event: done` or `event: error`.
   */
  app.post('/api/chat/conversations/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string }
    const conversation = await deps.conversations.get(id)
    if (!conversation) return reply.code(404).send({ error: 'no such conversation' })

    const body = req.body as { content?: unknown; contextWindowMarginPercent?: unknown; compactingThresholdPercent?: unknown }
    if (typeof body?.content !== 'string' || body.content.trim() === '') {
      return reply.code(400).send({ error: 'content is required' })
    }

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })

    const controller = new AbortController()
    req.raw.on('close', () => controller.abort())

    const send = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      for await (const ev of deps.conversationService.streamTurn(
        {
          conversationId: id,
          model: conversation.model,
          userContent: body.content,
          budget: {
            contextWindowMarginPercent: clampPercent(body.contextWindowMarginPercent, DEFAULT_MARGIN_PERCENT),
            compactingThresholdPercent: clampPercent(body.compactingThresholdPercent, DEFAULT_COMPACTING_THRESHOLD_PERCENT),
          },
        },
        controller.signal,
      )) {
        send(ev.type, ev)
      }
    } catch (err) {
      // A turn's own gateway/network errors are yielded as `error` events by
      // streamTurn itself; reaching here means something broke in the route
      // adapter (e.g. JSON.stringify on a pathological value) rather than the
      // conversation, so it is reported like any other unhandled error —
      // scrubbed the same way (chat content is not a credential shape and is
      // deliberately not included as `extra` here, per the redaction design).
      deps.reportError(err, { conversationId: id })
      send('error', { type: 'error', error: 'internal error' })
    } finally {
      reply.raw.end()
    }
  })

  app.get('/api/chat/cost-history', async (req) => {
    const days = Number((req.query as { days?: string }).days)
    const since = new Date(Date.now() - (Number.isFinite(days) && days > 0 ? days : DEFAULT_COST_HISTORY_DAYS) * 86_400_000)
    const [recent, totals] = await Promise.all([deps.aiCalls.listRecent(50), deps.aiCalls.totalCostSince(since)])
    return { recent, totals }
  })
}
