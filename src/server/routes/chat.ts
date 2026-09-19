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
import { RecipeDraftError, type RecipeDrafter, type RecipeDraftErrorReason } from '../ai/recipe-drafter.ts'
import type { KiloGatewayClient, ModelCatalog } from '../upstream/kilo.ts'
import type { AiCallRepository, ConversationRepository } from '../ports/repositories.ts'

/** Defaults mirror docs/handoff/layout.schema.yaml's params.chat. */
const DEFAULT_MARGIN_PERCENT = 20
const DEFAULT_COMPACTING_THRESHOLD_PERCENT = 80
const DEFAULT_COST_HISTORY_DAYS = 30

/** An archive row is one line on a half-width card; the rest of a long first message adds nothing there. */
const MAX_TITLE_LENGTH = 80

const RECIPE_DRAFT_STATUS: Record<RecipeDraftErrorReason, number> = {
  'no-such-conversation': 404,
  'no-assistant-message': 422,
  'not-a-recipe': 422,
  'extraction-failed': 502,
}

/**
 * The gateway's transcription response carries no `Content-Length` promise
 * this codebase controls, so the raw audio body itself is the thing capped —
 * generous enough for several minutes of a compressed voice note, small
 * enough that a runaway upload can't exhaust the LAN box's memory.
 */
const TRANSCRIBE_BODY_LIMIT_BYTES = 10_000_000

export interface ChatRouteDeps {
  conversations: ConversationRepository
  aiCalls: AiCallRepository
  modelCatalog: ModelCatalog
  conversationService: ConversationService
  recipeDrafter: RecipeDrafter
  /** Only `transcribeAudio` is used here — kept narrow so a fake in tests doesn't need the whole client. */
  kiloGateway: Pick<KiloGatewayClient, 'transcribeAudio'>
  /** Wraps Sentry.captureException so this module never imports observability directly. */
  reportError: (err: unknown, extra?: Record<string, unknown>) => void
  /**
   * Best-effort local backup of a transcription's audio + text
   * (k7-transcript-archive) — absent disables archiving entirely (e.g. in
   * tests), never fails the transcribe request itself if it throws.
   */
  archiveTranscription?: (entry: { audio: Buffer; contentType: string; text: string; model: string }) => Promise<void>
}

function clampPercent(raw: unknown, fallback: number): number {
  // Number(undefined) is NaN but Number('') and Number(null) are 0 — an
  // absent query parameter must mean "the default", not "reserve nothing".
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback
}

/** Whitespace collapsed, capped with an ellipsis; blank means "no title". */
function cleanTitle(raw: string): string | null {
  const title = raw.replace(/\s+/g, ' ').trim()
  if (title === '') return null
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : title
}

export async function registerChatRoutes(app: FastifyInstance, deps: ChatRouteDeps): Promise<void> {
  // No `@fastify/multipart` here: the client posts exactly one raw audio body
  // per request with no other form fields, so a plain buffer parser for any
  // `audio/*` content-type is all this route needs — see `[node:16b0ad21]`.
  // Any other content-type still goes through Fastify's built-in parsers
  // (or its own default 415), so this cannot shadow an existing route.
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer' }, (_req, payload, done) => {
    done(null, payload)
  })

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
      title: typeof body.title === 'string' ? cleanTitle(body.title) : null,
    })
    return reply.code(201).send(conversation)
  })

  /** One thread's own record — the card resuming the thread it last had open needs its model and title. */
  app.get('/api/chat/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const conversation = await deps.conversations.get(id)
    return conversation ?? reply.code(404).send({ error: 'no such conversation' })
  })

  /** Rename a thread (`/tytul`), or switch the model its next turns use (`/model`, the picker). */
  app.patch('/api/chat/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = (req.body ?? {}) as { title?: unknown; model?: unknown }
    const patch: { title?: string | null; model?: string } = {}
    if (body.title === null) patch.title = null
    else if (typeof body.title === 'string') patch.title = cleanTitle(body.title)
    else if (body.title !== undefined) return reply.code(400).send({ error: 'title must be a string or null' })
    if (typeof body.model === 'string' && body.model.trim() !== '') patch.model = body.model.trim()
    else if (body.model !== undefined) return reply.code(400).send({ error: 'model must be a non-empty string' })
    if (patch.title === undefined && patch.model === undefined) {
      return reply.code(400).send({ error: 'nothing to update: send title and/or model' })
    }
    const updated = await deps.conversations.update(id, patch)
    return updated ?? reply.code(404).send({ error: 'no such conversation' })
  })

  /** Removes the thread and its messages; its ai_calls rows survive (set null — see schema.ts). */
  app.delete('/api/chat/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const deleted = await deps.conversations.delete(id)
    return deleted ? reply.code(204).send() : reply.code(404).send({ error: 'no such conversation' })
  })

  /**
   * The `/context` command's data: how much of the model's window the thread
   * uses, what is reserved for the reply, and where compacting kicks in. A
   * thread that does not exist yet is a valid question (an empty window);
   * a named thread that does not exist is a 404, not an empty answer.
   */
  app.get('/api/chat/context', async (req, reply) => {
    const q = req.query as {
      model?: string
      conversationId?: string
      contextWindowMarginPercent?: string
      compactingThresholdPercent?: string
    }
    let model = q.model?.trim() || undefined
    if (q.conversationId) {
      const conversation = await deps.conversations.get(q.conversationId)
      if (!conversation) return reply.code(404).send({ error: 'no such conversation' })
      model = model ?? conversation.model
    }
    if (!model) return reply.code(400).send({ error: 'model or conversationId is required' })
    return deps.conversationService.describeContext({
      conversationId: q.conversationId || undefined,
      model,
      budget: {
        contextWindowMarginPercent: clampPercent(q.contextWindowMarginPercent, DEFAULT_MARGIN_PERCENT),
        compactingThresholdPercent: clampPercent(q.compactingThresholdPercent, DEFAULT_COMPACTING_THRESHOLD_PERCENT),
      },
    })
  })

  /**
   * `/przepis`: an unsaved recipe draft extracted from an assistant message.
   * Returns the same shape POST /api/recipes/import does, for the same
   * review-before-save form — nothing here writes a Recipe.
   */
  app.post('/api/chat/conversations/:id/recipe-draft', async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = (req.body ?? {}) as { messageId?: unknown }
    const controller = new AbortController()
    req.raw.on('close', () => controller.abort())
    try {
      return await deps.recipeDrafter.draftFromConversation(
        { conversationId: id, messageId: typeof body.messageId === 'string' ? body.messageId : undefined },
        controller.signal,
      )
    } catch (err) {
      if (err instanceof RecipeDraftError) {
        return reply.code(RECIPE_DRAFT_STATUS[err.reason]).send({ error: err.message, reason: err.reason })
      }
      // Message content never reaches `extra` — same rule as the SSE route.
      deps.reportError(err, { route: '/api/chat/conversations/:id/recipe-draft' })
      return reply.code(500).send({ error: 'internal error' })
    }
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

  /**
   * Voice input for the chat composer (k7-chat-voice-input): transcribes a
   * recorded clip and hands the text back for the household to review before
   * sending — this route never touches `ConversationService` or persists a
   * `Message`, matching the "transcribe before send, don't auto-send" UX
   * decision. See `upstream/kilo.ts`'s module doc comment for how much of
   * the downstream gateway contract is a verified fact versus a documented
   * best-effort guess.
   */
  app.post('/api/chat/transcribe', { bodyLimit: TRANSCRIBE_BODY_LIMIT_BYTES }, async (req, reply) => {
    const contentType = req.headers['content-type']
    if (typeof contentType !== 'string' || !contentType.startsWith('audio/')) {
      return reply.code(400).send({ error: 'expected an audio/* request body' })
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return reply.code(400).send({ error: 'empty audio body' })
    }

    try {
      const { text, model } = await deps.kiloGateway.transcribeAudio({ data: req.body, contentType })
      // No `usage` in a transcription response to cost from (see kilo.ts) —
      // 0 is the honest number here, not an invented token estimate.
      await deps.aiCalls.record({
        conversationId: null,
        messageId: null,
        purpose: 'transcription',
        model,
        promptTokens: 0,
        completionTokens: 0,
        estimatedCostUsd: 0,
      })
      // Best-effort: a household member should never see "transcription
      // failed" because the debug backup couldn't be written — the transcript
      // they asked for already exists by this point.
      try {
        await deps.archiveTranscription?.({ audio: req.body, contentType, text, model })
      } catch (archiveErr) {
        deps.reportError(archiveErr, { route: '/api/chat/transcribe', stage: 'archive' })
      }
      return { text }
    } catch (err) {
      // Same discipline as the SSE route above: audio bytes and the
      // transcript itself never reach `extra` here — only which route
      // failed — matching `[node:a1245ccd]`'s "chat content never reaches
      // Sentry" precedent, applied to audio/transcript content.
      deps.reportError(err, { route: '/api/chat/transcribe' })
      return reply.code(502).send({ error: 'transcription failed' })
    }
  })

  app.get('/api/chat/cost-history', async (req) => {
    const days = Number((req.query as { days?: string }).days)
    const since = new Date(Date.now() - (Number.isFinite(days) && days > 0 ? days : DEFAULT_COST_HISTORY_DAYS) * 86_400_000)
    const [recent, totals] = await Promise.all([deps.aiCalls.listRecent(50), deps.aiCalls.totalCostSince(since)])
    return { recent, totals }
  })
}
