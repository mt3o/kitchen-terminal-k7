/**
 * The `/przepis` extraction: the tolerant reply parser, and which message the
 * drafter reads — against a fake gateway and a real in-memory store.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { createRepositories, openDatabase } from '../src/server/adapters/drizzle/index.ts'
import { runMigrations } from '../src/server/db/migrate.ts'
import { createRecipeDrafter, parseRecipeDraft, RecipeDraftError } from '../src/server/ai/recipe-drafter.ts'
import type { Repositories } from '../src/server/ports/repositories.ts'
import type { ChatCompletionRequest, ModelCatalog } from '../src/server/upstream/kilo.ts'

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    return err instanceof RecipeDraftError ? err.reason : `unexpected ${String(err)}`
  }
  return undefined
}

describe('parseRecipeDraft', () => {
  it('reads JSON wrapped in prose or a code fence', () => {
    const draft = parseRecipeDraft('Oto przepis:\n```json\n{"title":" Żurek ","ingredients":["zakwas"],"steps":["gotuj"],"tags":[]}\n```\nSmacznego')
    assert.equal(draft.title, 'Żurek')
    assert.deepEqual(draft.ingredients, ['zakwas'])
    assert.equal(draft.sourceUrl, null)
    // Not asked of the model for this extraction — see parseRecipeDraft's own comment.
    assert.equal(draft.description, '')
  })

  it('strips list markers the model left in, drops non-strings and blanks, dedupes tags', () => {
    const draft = parseRecipeDraft(
      JSON.stringify({
        title: 'Placki',
        ingredients: ['- mąka', '* jajko', 3, '  '],
        steps: ['1. wymieszaj', '2) smaż'],
        tags: ['#Obiad', 'obiad', 'ziemniaki'],
      }),
    )
    assert.deepEqual(draft.ingredients, ['mąka', 'jajko'])
    assert.deepEqual(draft.steps, ['wymieszaj', 'smaż'])
    assert.deepEqual(draft.tags, ['obiad', 'ziemniaki'])
  })

  it('fails with a reason instead of yielding a half-empty draft', () => {
    assert.equal(reasonOf(() => parseRecipeDraft('nie wiem')), 'extraction-failed')
    assert.equal(reasonOf(() => parseRecipeDraft('{"title": ')), 'extraction-failed')
    assert.equal(reasonOf(() => parseRecipeDraft('{"title": ""}')), 'not-a-recipe')
    assert.equal(reasonOf(() => parseRecipeDraft('{"title": "Coś", "ingredients": [], "steps": []}')), 'not-a-recipe')
  })
})

describe('createRecipeDrafter', () => {
  let repos: Repositories
  let requests: ChatCompletionRequest[]

  const catalog: ModelCatalog = {
    async list() {
      return []
    },
    async get() {
      return undefined
    },
  }

  beforeEach(() => {
    const db = openDatabase(':memory:')
    runMigrations(db)
    repos = createRepositories(db)
    requests = []
  })

  function drafter() {
    return createRecipeDrafter({
      conversations: repos.conversations,
      aiCalls: repos.aiCalls,
      modelCatalog: catalog,
      gateway: {
        async chatCompletionOnce(request) {
          requests.push(request)
          return { content: '{"title":"T","ingredients":["a"],"steps":[],"tags":[]}', usage: { prompt_tokens: 1, completion_tokens: 1 } }
        },
      },
    })
  }

  it("reads the latest non-empty assistant answer with the thread's own model", async () => {
    const conversation = await repos.conversations.create({ title: null, model: 'kilo-auto/free' })
    await repos.conversations.addMessage({ conversationId: conversation.id, role: 'assistant', content: 'pierwszy' })
    await repos.conversations.addMessage({ conversationId: conversation.id, role: 'user', content: 'jeszcze raz' })
    await repos.conversations.addMessage({ conversationId: conversation.id, role: 'assistant', content: 'drugi' })
    await repos.conversations.addMessage({ conversationId: conversation.id, role: 'assistant', content: '' })

    await drafter().draftFromConversation({ conversationId: conversation.id })
    assert.equal(requests[0]?.model, 'kilo-auto/free')
    assert.equal(requests[0]?.messages.at(-1)?.content, 'drugi')
  })

  it('reads a specific assistant message when one is named, never a user message', async () => {
    const conversation = await repos.conversations.create({ title: null, model: 'kilo-auto/free' })
    const first = await repos.conversations.addMessage({ conversationId: conversation.id, role: 'assistant', content: 'pierwszy' })
    const user = await repos.conversations.addMessage({ conversationId: conversation.id, role: 'user', content: 'moje' })
    await repos.conversations.addMessage({ conversationId: conversation.id, role: 'assistant', content: 'drugi' })

    await drafter().draftFromConversation({ conversationId: conversation.id, messageId: first.id })
    assert.equal(requests[0]?.messages.at(-1)?.content, 'pierwszy')

    await assert.rejects(
      drafter().draftFromConversation({ conversationId: conversation.id, messageId: user.id }),
      (err: unknown) => err instanceof RecipeDraftError && err.reason === 'no-assistant-message',
    )
  })
})
