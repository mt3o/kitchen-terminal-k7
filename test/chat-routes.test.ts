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
import { createRecipeDrafter } from '../src/server/ai/recipe-drafter.ts'
import { registerChatRoutes } from '../src/server/routes/chat.ts'
import type { Repositories } from '../src/server/ports/repositories.ts'
import type { GatewayChunk, GatewayModel, KiloGatewayClient, ModelCatalog } from '../src/server/upstream/kilo.ts'

let repos: Repositories
let app: FastifyInstance
let reportedErrors: unknown[]
let reportedRefusals: unknown[]
/** The streamed answer, one delta per element — set per-test where the content matters. */
let streamedDeltas: string[]

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

/** What the single-shot call answers — compacting summaries and recipe extraction share it. */
let onceContent: string

function fakeGateway(): Pick<KiloGatewayClient, 'chatCompletion' | 'chatCompletionOnce'> {
  return {
    async *chatCompletion(): AsyncGenerator<GatewayChunk> {
      for (const content of streamedDeltas) yield { choices: [{ delta: { content }, finish_reason: null }] }
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } }
    },
    async chatCompletionOnce() {
      return { content: onceContent, usage: { prompt_tokens: 5, completion_tokens: 2 } }
    },
  }
}

/** Set per-test to exercise both the happy path and a gateway failure. */
let transcribeImpl: Pick<KiloGatewayClient, 'transcribeAudio'>['transcribeAudio']

function fakeKiloGateway(): Pick<KiloGatewayClient, 'transcribeAudio'> {
  return {
    transcribeAudio: (...args) => transcribeImpl(...args),
  }
}

beforeEach(async () => {
  const db = openDatabase(':memory:')
  runMigrations(db)
  repos = createRepositories(db)
  reportedErrors = []
  reportedRefusals = []
  streamedDeltas = ['cze', 'sc!']
  onceContent = 'streszczenie'

  const modelCatalog = fakeModelCatalog()
  const conversationService = createConversationService({
    conversations: repos.conversations,
    aiCalls: repos.aiCalls,
    modelCatalog,
    gateway: fakeGateway(),
  })

  transcribeImpl = async () => ({ text: 'kup mleko', model: 'thinkingmachines/inkling-small:free' })

  app = Fastify()
  await registerChatRoutes(app, {
    conversations: repos.conversations,
    aiCalls: repos.aiCalls,
    modelCatalog,
    conversationService,
    recipeDrafter: createRecipeDrafter({
      conversations: repos.conversations,
      aiCalls: repos.aiCalls,
      modelCatalog,
      gateway: fakeGateway(),
    }),
    kiloGateway: fakeKiloGateway(),
    reportError: (err, extra) => reportedErrors.push({ err, extra }),
    reportRefusedMarkdown: (kinds, extra) => reportedRefusals.push({ kinds, extra }),
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

async function createConversation(title?: string): Promise<{ id: string; title: string | null; model: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/chat/conversations',
    payload: { model: 'anthropic/claude-sonnet-5', ...(title === undefined ? {} : { title }) },
  })
  return res.json() as { id: string; title: string | null; model: string }
}

describe('conversation archive: titles, PATCH, DELETE', () => {
  it('collapses whitespace and caps a long title with an ellipsis', async () => {
    const conversation = await createConversation(`  ${'a'.repeat(50)}\n${'b'.repeat(50)}  `)
    assert.equal(conversation.title?.length, 80)
    assert.ok(conversation.title?.endsWith('…'))
    assert.ok(!conversation.title?.includes('\n'))
  })

  it('renames and switches model without reordering the archive', async () => {
    const older = await createConversation('starszy')
    await repos.conversations.addMessage({ conversationId: older.id, role: 'user', content: 'hej' })
    const newer = await createConversation('nowszy')
    // updatedAt has millisecond resolution; two turns in the same tick would tie.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await repos.conversations.addMessage({ conversationId: newer.id, role: 'user', content: 'hej' })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/chat/conversations/${older.id}`,
      payload: { title: 'zupa pomidorowa', model: 'kilo-auto/efficient' },
    })
    assert.equal(res.statusCode, 200)
    const updated = res.json() as { title: string; model: string }
    assert.equal(updated.title, 'zupa pomidorowa')
    assert.equal(updated.model, 'kilo-auto/efficient')

    const list = (await app.inject({ method: 'GET', url: '/api/chat/conversations' })).json() as { id: string }[]
    assert.deepEqual(list.map((c) => c.id), [newer.id, older.id], 'a rename is not a turn')
  })

  it('fetches one thread by id, 404s an unknown one', async () => {
    const conversation = await createConversation('obiad')
    const res = await app.inject({ method: 'GET', url: `/api/chat/conversations/${conversation.id}` })
    assert.equal(res.statusCode, 200)
    assert.equal((res.json() as { title: string }).title, 'obiad')
    assert.equal((await app.inject({ method: 'GET', url: '/api/chat/conversations/nope' })).statusCode, 404)
  })

  it('400s an empty or ill-typed patch, 404s an unknown thread', async () => {
    const conversation = await createConversation()
    for (const payload of [{}, { title: 3 }, { model: '' }]) {
      const res = await app.inject({ method: 'PATCH', url: `/api/chat/conversations/${conversation.id}`, payload })
      assert.equal(res.statusCode, 400, JSON.stringify(payload))
    }
    const missing = await app.inject({ method: 'PATCH', url: '/api/chat/conversations/nope', payload: { title: 'x' } })
    assert.equal(missing.statusCode, 404)
  })

  it('deletes a thread and its messages but keeps what it cost', async () => {
    const conversation = await createConversation()
    await app.inject({
      method: 'POST',
      url: `/api/chat/conversations/${conversation.id}/messages`,
      payload: { content: 'hej' },
    })
    const res = await app.inject({ method: 'DELETE', url: `/api/chat/conversations/${conversation.id}` })
    assert.equal(res.statusCode, 204)
    const again = await app.inject({ method: 'DELETE', url: `/api/chat/conversations/${conversation.id}` })
    assert.equal(again.statusCode, 404)
    const messages = await app.inject({ method: 'GET', url: `/api/chat/conversations/${conversation.id}/messages` })
    assert.equal(messages.statusCode, 404)
    const { calls } = await repos.aiCalls.totalCostSince(new Date(0))
    assert.equal(calls, 1)
  })
})

describe('GET /api/chat/context', () => {
  it('reports an empty window for a thread that does not exist yet', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/chat/context?model=anthropic/claude-sonnet-5' })
    assert.equal(res.statusCode, 200)
    const body = res.json() as Record<string, unknown>
    assert.equal(body.contextLength, 200_000)
    assert.equal(body.reservedForResponseTokens, 40_000, 'default 20% margin')
    assert.equal(body.historyBudgetTokens, 160_000)
    assert.equal(body.compactingTriggerTokens, 128_000, 'default 80% threshold')
    assert.equal(body.windowTokens, 0)
    assert.equal(body.contextLengthKnown, true)
  })

  it("uses the thread's own model and honours the budget knobs", async () => {
    const conversation = await createConversation()
    await repos.conversations.addMessage({ conversationId: conversation.id, role: 'user', content: 'x'.repeat(400) })
    const res = await app.inject({
      method: 'GET',
      url: `/api/chat/context?conversationId=${conversation.id}&contextWindowMarginPercent=50&compactingThresholdPercent=50`,
    })
    const body = res.json() as Record<string, unknown>
    assert.equal(body.model, 'anthropic/claude-sonnet-5')
    assert.equal(body.reservedForResponseTokens, 100_000)
    assert.equal(body.compactingTriggerTokens, 50_000)
    assert.equal(body.windowTokens, 100)
    assert.equal(body.windowMessages, 1)
  })

  it('400s without a model or thread and 404s an unknown thread', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/chat/context' })).statusCode, 400)
    assert.equal((await app.inject({ method: 'GET', url: '/api/chat/context?conversationId=nope' })).statusCode, 404)
  })
})

describe('POST /api/chat/conversations/:id/recipe-draft', () => {
  it('returns an unsaved draft from the last assistant answer and logs the extraction call', async () => {
    const conversation = await createConversation()
    await repos.conversations.addMessage({ conversationId: conversation.id, role: 'assistant', content: 'Szakszuka: ...' })
    onceContent = '```json\n{"title":"Szakszuka","ingredients":["- 4 jajka"],"steps":["1. Podsmaż"],"tags":["Jajka"]}\n```'

    const res = await app.inject({ method: 'POST', url: `/api/chat/conversations/${conversation.id}/recipe-draft` })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.json(), {
      title: 'Szakszuka',
      sourceUrl: null,
      ingredients: ['4 jajka'],
      steps: ['Podsmaż'],
      tags: ['jajka'],
    })
    const [call] = await repos.aiCalls.listRecent(1)
    assert.equal(call?.purpose, 'recipe-extraction')
  })

  it('422s when there is no assistant answer or no recipe in it, 404s an unknown thread', async () => {
    const conversation = await createConversation()
    const empty = await app.inject({ method: 'POST', url: `/api/chat/conversations/${conversation.id}/recipe-draft` })
    assert.equal(empty.statusCode, 422)
    assert.equal((empty.json() as { reason: string }).reason, 'no-assistant-message')

    await repos.conversations.addMessage({ conversationId: conversation.id, role: 'assistant', content: 'Dzień dobry' })
    onceContent = '{"title": ""}'
    const notRecipe = await app.inject({ method: 'POST', url: `/api/chat/conversations/${conversation.id}/recipe-draft` })
    assert.equal(notRecipe.statusCode, 422)
    assert.equal((notRecipe.json() as { reason: string }).reason, 'not-a-recipe')

    const missing = await app.inject({ method: 'POST', url: '/api/chat/conversations/nope/recipe-draft' })
    assert.equal(missing.statusCode, 404)
  })

  it('502s an unparseable model reply', async () => {
    const conversation = await createConversation()
    await repos.conversations.addMessage({ conversationId: conversation.id, role: 'assistant', content: 'przepis' })
    onceContent = 'nie umiem'
    const res = await app.inject({ method: 'POST', url: `/api/chat/conversations/${conversation.id}/recipe-draft` })
    assert.equal(res.statusCode, 502)
    assert.equal((res.json() as { reason: string }).reason, 'extraction-failed')
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

  it('reports refused markdown in a finished answer by kind, without its content', async () => {
    streamedDeltas = ['zobacz ![zdjęcie](http://x.example/a.png)', ' i <b>to</b>']
    const created = await app.inject({ method: 'POST', url: '/api/chat/conversations', payload: { model: 'anthropic/claude-sonnet-5' } })
    const conversation = created.json() as { id: string }

    await app.inject({ method: 'POST', url: `/api/chat/conversations/${conversation.id}/messages`, payload: { content: 'siema' } })

    assert.deepEqual(reportedRefusals, [
      { kinds: ['image', 'html'], extra: { conversationId: conversation.id, model: 'anthropic/claude-sonnet-5' } },
    ])
  })

  it('reports nothing for an answer within the markdown allowlist', async () => {
    streamedDeltas = ['### Składniki\n', '- mąka\n- **cukier**\n\n| a | b |\n|---|---|\n| 1<br>2 | 3 |']
    const created = await app.inject({ method: 'POST', url: '/api/chat/conversations', payload: { model: 'anthropic/claude-sonnet-5' } })
    const conversation = created.json() as { id: string }

    await app.inject({ method: 'POST', url: `/api/chat/conversations/${conversation.id}/messages`, payload: { content: 'siema' } })

    assert.deepEqual(reportedRefusals, [])
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

describe('POST /api/chat/transcribe', () => {
  it('transcribes an audio/* body and records a 0-cost ai_call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/transcribe',
      headers: { 'content-type': 'audio/webm' },
      payload: Buffer.from([1, 2, 3, 4]),
    })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.json(), { text: 'kup mleko' })

    const history = await repos.aiCalls.listRecent(1)
    assert.equal(history[0]?.purpose, 'transcription')
    assert.equal(history[0]?.model, 'thinkingmachines/inkling-small:free')
    assert.equal(history[0]?.estimatedCostUsd, 0)
    assert.equal(history[0]?.conversationId, null)
  })

  it('rejects a non-audio content-type with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/transcribe',
      headers: { 'content-type': 'text/plain' },
      payload: 'not audio',
    })
    assert.equal(res.statusCode, 400)
  })

  it('rejects an empty audio body with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/transcribe',
      headers: { 'content-type': 'audio/webm' },
      payload: Buffer.alloc(0),
    })
    assert.equal(res.statusCode, 400)
  })

  it('502s a gateway failure without leaking audio bytes or transcript text into the error report', async () => {
    transcribeImpl = async () => {
      throw new Error('kilo gateway responded 500: <secret-looking upstream body>')
    }
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat/transcribe',
      headers: { 'content-type': 'audio/webm' },
      payload: Buffer.from([9, 9, 9]),
    })
    assert.equal(res.statusCode, 502)
    assert.deepEqual(res.json(), { error: 'transcription failed' })

    assert.equal(reportedErrors.length, 1)
    const reported = reportedErrors[0] as { extra?: Record<string, unknown> }
    // Only the route name may travel as `extra` — never the audio buffer or
    // any transcript-shaped text, per [node:a1245ccd].
    assert.deepEqual(reported.extra, { route: '/api/chat/transcribe' })
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
