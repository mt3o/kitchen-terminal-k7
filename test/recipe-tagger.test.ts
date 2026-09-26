/**
 * Auto-tagging on save: the tolerant reply parser, what the prompt carries,
 * cost bookkeeping, and the route's fill-only-when-empty policy — against a
 * fake gateway and a real in-memory store.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { createRepositories, openDatabase } from '../src/server/adapters/drizzle/index.ts'
import { runMigrations } from '../src/server/db/migrate.ts'
import {
  buildTaggingInput,
  createRecipeTagger,
  fillMissingTags,
  parseRecipeTags,
  TAGGING_MODEL,
  TAGGING_TIMEOUT_MS,
  type RecipeTagger,
} from '../src/server/ai/recipe-tagger.ts'
import type { Repositories } from '../src/server/ports/repositories.ts'
import type { ChatCompletionRequest, ModelCatalog } from '../src/server/upstream/kilo.ts'

const recipe = {
  title: 'Żurek',
  description: 'Na zakwasie, mrozi się dobrze',
  ingredients: ['zakwas', 'biała kiełbasa'],
  steps: ['gotuj wywar', 'dodaj zakwas'],
  tags: [] as string[],
}

describe('parseRecipeTags', () => {
  it('reads JSON wrapped in prose or a code fence', () => {
    assert.deepEqual(parseRecipeTags('Proszę:\n```json\n{"tags":["zupa","polska"]}\n```'), ['zupa', 'polska'])
  })

  it('strips #, lowercases, drops blanks and non-strings, dedupes, caps at four', () => {
    assert.deepEqual(parseRecipeTags('{"tags":["#Zupa","zupa"," ",3,"Polska","obiad","zakwas","kiełbasa"]}'), [
      'zupa',
      'polska',
      'obiad',
      'zakwas',
    ])
  })

  it('strips a # that follows leading whitespace', () => {
    assert.deepEqual(parseRecipeTags('{"tags":[" #zupa "]}'), ['zupa'])
  })

  it('returns no tags instead of throwing on an unusable reply', () => {
    assert.deepEqual(parseRecipeTags('nie wiem'), [])
    assert.deepEqual(parseRecipeTags('{"tags": '), [])
    assert.deepEqual(parseRecipeTags('{"tags": "zupa"}'), [])
    assert.deepEqual(parseRecipeTags('null'), [])
  })
})

describe('buildTaggingInput', () => {
  it('carries title, description, ingredients and steps', () => {
    const input = buildTaggingInput(recipe)
    for (const part of ['Żurek', 'Na zakwasie', 'biała kiełbasa', 'dodaj zakwas']) assert.ok(input.includes(part), part)
  })

  it('omits an empty description rather than sending a blank section', () => {
    assert.ok(!buildTaggingInput({ ...recipe, description: '' }).includes('Opis'))
  })
})

describe('createRecipeTagger', () => {
  let repos: Repositories
  let requests: ChatCompletionRequest[]
  let timeouts: (number | undefined)[]

  const catalog: Pick<ModelCatalog, 'get'> = {
    async get() {
      return undefined
    },
  }

  beforeEach(() => {
    const db = openDatabase(':memory:')
    runMigrations(db)
    repos = createRepositories(db)
    requests = []
    timeouts = []
  })

  it('asks the free model and records the call as recipe-tagging', async () => {
    const tagger = createRecipeTagger({
      aiCalls: repos.aiCalls,
      modelCatalog: catalog,
      gateway: {
        async chatCompletionOnce(request, opts) {
          requests.push(request)
          timeouts.push(opts?.timeoutMs)
          return { content: '{"tags":["zupa"]}', usage: { prompt_tokens: 12, completion_tokens: 3 } }
        },
      },
    })

    assert.deepEqual(await tagger.suggestTags(recipe), ['zupa'])
    assert.equal(requests[0]?.model, TAGGING_MODEL)
    assert.equal(timeouts[0], TAGGING_TIMEOUT_MS, 'the short timeout is what keeps ZAPISZ from hanging 45 s')
    assert.ok(requests[0]?.messages.at(-1)?.content.includes('Żurek'))
    const calls = await repos.aiCalls.listRecent()
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.purpose, 'recipe-tagging')
    assert.equal(calls[0]?.conversationId, null)
  })
})

describe('fillMissingTags', () => {
  function taggerReturning(result: string[] | Error): RecipeTagger & { calls: number } {
    return {
      calls: 0,
      async suggestTags() {
        this.calls++
        if (result instanceof Error) throw result
        return result
      },
    }
  }

  it('never touches tags the household typed', async () => {
    const tagger = taggerReturning(['zupa'])
    assert.deepEqual(await fillMissingTags({ ...recipe, tags: ['moje'] }, tagger, () => assert.fail()), ['moje'])
    assert.equal(tagger.calls, 0)
  })

  it('fills empty tags from the tagger', async () => {
    assert.deepEqual(await fillMissingTags(recipe, taggerReturning(['zupa']), () => assert.fail()), ['zupa'])
  })

  it('saves untagged when no tagger is configured', async () => {
    assert.deepEqual(await fillMissingTags(recipe, undefined, () => assert.fail()), [])
  })

  it('saves untagged and reports when the call fails or yields nothing', async () => {
    const errors: unknown[] = []
    assert.deepEqual(await fillMissingTags(recipe, taggerReturning(new Error('timeout')), (e) => errors.push(e)), [])
    assert.deepEqual(await fillMissingTags(recipe, taggerReturning([]), (e) => errors.push(e)), [])
    assert.equal(errors.length, 2)
  })
})
