/**
 * The chat HTTP surface, tested with Fastify's `.inject()` against a fake
 * gateway/model-catalog and a real in-memory repository stack — no network,
 * no real Kilo Gateway call.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import Fastify, { type FastifyInstance } from 'fastify'

import { createRepositories, openDatabase } from '../src/server/adapters/drizzle/index.ts'
import { runMigrations } from '../src/server/db/migrate.ts'
import { createConversationService } from '../src/server/ai/conversation-service.ts'
import { registerChatRoutes } from '../src/server/routes/chat.ts'
import type { Repositories } from '../src/server/ports/repositories.ts'
import type { GatewayChunk, GatewayModel, KiloGatewayClient, ModelCatalog } from '../src/server/upstream/kilo.ts'

let repos: Repositories
let app: FastifyInstance
let reportedErrors: unknown[]

const FAKE_MODELS: GatewayModel[] = [
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', contextLength: 200_000, maxCompletionTokens: 8000, pricing: { promptUsdPerToken: 0.000002, completionUsdPerToken: 0.00001 } },
  { id: 'kilo-auto/efficient', name: 'Auto Efficient', contextLength: 1_000_000, maxCompletionTokens: 65_536, pricing: null },
]

function fakeModelCatalog(): ModelCatalog {
  return {
    async list() {
      return FAKE_MODELS
    },
    async get(id) {
      return FAKE_MODELS.find((m) => m.id === id)
    },
  }
}

function fakeGateway(): Pick<KiloGatewayClient, 'chatCompletion' | 'chatCompletionOnce'> {
  return {
    async *chatCompletion(): AsyncGenerator<GatewayChunk> {
      yield { choices: [{ delta: { content: 'cze' }, finish_reason: null }] }
      yield { choices: [{ delta: { content: 'sc!' }, finish_reason: null }] }
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } }
    },
    async chatCompletionOnce() {
      return { content: 'streszczenie', usage: { prompt_tokens: 5, completion_tokens: 2 } }
    },
  }
}

beforeEach(async () => {
  const db = openDatabase(':memory:')
  runMigrations(db)
  repos = createRepositories(db)
  reportedErrors = []

  const modelCatalog = fakeModelCatalog()
  const conversationService = createConversationService({
    conversations: repos.conversations,
    aiCalls: repos.aiCalls,
    modelCatalog,
    gateway: fakeGateway(),
  })

  app = Fastify()
  await registerChatRoutes(app, {
    conversations: repos.conversations,
    aiCalls: repos.aiCalls,
    modelCatalog,
    conversationService,
    reportError: (err) => reportedErrors.push(err),
  })
  await app.ready()
})

describe('GET /api/gateway/models', () => {
  it('returns the slim model shape from the catalogue', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/gateway/models' })
    assert.equal(res.statusCode, 200)
    const body = res.json() as { id: string; pricing: unknown }[]
    assert.equal(body.length, 2)
    assert.equal(body[0]?.id, 'anthropic/claude-sonnet-5')
    assert.deepEqual(body[1]?.pricing, null)
  })
})

describe('conversation CRUD', () => {
  it('creates, lists and fetches messages for a conversation', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/chat/conversations',
      payload: { model: 'anthropic/claude-sonnet-5', title: 'obiad' },
    })
    assert.equal(create.statusCode, 201)
    const conversation = create.json() as { id: string }

    const list = await app.inject({ method: 'GET', url: '/api/chat/conversations' })
    assert.equal(list.statusCode, 200)
    assert.equal((list.json() as unknown[]).length, 1)

    const messages = await app.inject({ method: 'GET', url: `/api/chat/conversations/${conversation.id}/messages` })
    assert.equal(messages.statusCode, 200)
    assert.deepEqual(messages.json(), [])
  })

  it('rejects a conversation without a model', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/chat/conversations', payload: {} })
    assert.equal(res.statusCode, 400)
  })

  it('404s messages for an unknown conversation', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/chat/conversations/does-not-exist/messages' })
    assert.equal(res.statusCode, 404)
  })
})

describe('POST /api/chat/conversations/:id/messages (SSE)', () => {
  it('streams delta then done frames and persists the turn', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/chat/conversations',
      payload: { model: 'anthropic/claude-sonnet-5' },
    })
    const conversation = created.json() as { id: string }

    const res = await app.inject({
      method: 'POST',
      url: `/api/chat/conversations/${conversation.id}/messages`,
      payload: { content: 'siema' },
    })

    assert.equal(res.statusCode, 200)
    assert.match(res.headers['content-type'] as string, /text\/event-stream/)
    assert.match(res.body, /event: delta\ndata: \{"type":"delta","content":"cze"\}/)
    assert.match(res.body, /event: delta\ndata: \{"type":"delta","content":"sc!"\}/)
    assert.match(res.body, /event: done\ndata: \{"type":"done"/)

    const history = await repos.conversations.messages(conversation.id)
    assert.deepEqual(
      history.map((m) => m.role),
      ['user', 'assistant'],
    )
    assert.equal(history[1]?.content, 'czesc!')
  })

  it('400s an empty message body', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/chat/conversations', payload: { model: 'anthropic/claude-sonnet-5' } })
    const conversation = created.json() as { id: string }
    const res = await app.inject({
      method: 'POST',
      url: `/api/chat/conversations/${conversation.id}/messages`,
      payload: { content: '' },
    })
    assert.equal(res.statusCode, 400)
  })
})

describe('GET /api/chat/cost-history', () => {
  it('reflects recorded ai_calls', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/chat/conversations', payload: { model: 'anthropic/claude-sonnet-5' } })
    const conversation = created.json() as { id: string }
    await app.inject({ method: 'POST', url: `/api/chat/conversations/${conversation.id}/messages`, payload: { content: 'hej' } })

    const res = await app.inject({ method: 'GET', url: '/api/chat/cost-history' })
    assert.equal(res.statusCode, 200)
    const body = res.json() as { recent: unknown[]; totals: { calls: number; costUsd: number } }
    assert.equal(body.recent.length, 1)
    assert.equal(body.totals.calls, 1)
    assert.ok(body.totals.costUsd > 0)
  })
})
