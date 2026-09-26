/**
 * The model-backed URL import: what a reply must look like to be believed, the
 * retry that names the problem, the fallback to the markup-only extractors,
 * and the page-to-text step that feeds the model.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { createRepositories, openDatabase } from '../src/server/adapters/drizzle/index.ts'
import { runMigrations } from '../src/server/db/migrate.ts'
import { createRecipeImportAgent, validateRecipeReply } from '../src/server/ai/recipe-import-agent.ts'
import { pageToText } from '../src/server/recipes/page-text.ts'
import { importRecipeFromUrl } from '../src/server/recipes/import.ts'
import type { Repositories } from '../src/server/ports/repositories.ts'
import type { ChatCompletionRequest } from '../src/server/upstream/kilo.ts'

const URL_ = 'https://example.com/zurek'

describe('validateRecipeReply', () => {
  it('accepts a complete recipe and stamps the source URL', () => {
    const r = validateRecipeReply('{"title":"Żurek","description":"","ingredients":["zakwas"],"steps":["1. gotuj"],"tags":["#Zupa"]}', URL_)
    assert.ok('recipe' in r)
    assert.equal(r.recipe.sourceUrl, URL_)
    assert.deepEqual(r.recipe.steps, ['gotuj'])
    assert.deepEqual(r.recipe.tags, ['zupa'])
  })

  it('rejects steps that are the ingredient list again', () => {
    const r = validateRecipeReply('{"title":"X","ingredients":["500 g mąki","2 jajka"],"steps":["500 g mąki","2 jajka"],"tags":[]}', URL_)
    assert.ok('problem' in r)
    assert.match(r.problem, /składniki zamiast kroków/)
  })

  it('rejects no ingredients, no title, and non-JSON', () => {
    assert.ok('problem' in validateRecipeReply('{"title":"X","ingredients":[],"steps":["a"]}', URL_))
    assert.ok('problem' in validateRecipeReply('{"title":"","ingredients":[],"steps":[]}', URL_))
    assert.ok('problem' in validateRecipeReply('nie wiem', URL_))
  })
})

describe('createRecipeImportAgent', () => {
  let repos: Repositories
  let requests: ChatCompletionRequest[]

  beforeEach(() => {
    const db = openDatabase(':memory:')
    runMigrations(db)
    repos = createRepositories(db)
    requests = []
  })

  function agent(replies: (string | Error)[]) {
    return createRecipeImportAgent({
      aiCalls: repos.aiCalls,
      modelCatalog: { get: async () => undefined },
      model: 'test/model',
      gateway: {
        async chatCompletionOnce(request) {
          requests.push(request)
          const next = replies.shift()
          if (next === undefined) throw new Error('no more replies')
          if (next instanceof Error) throw next
          return { content: next, usage: { prompt_tokens: 10, completion_tokens: 5 } }
        },
      },
    })
  }

  const html = '<html><body><h1>Żurek</h1><ul><li>zakwas</li></ul><p>Gotuj.</p></body></html>'
  const good = '{"title":"Żurek","description":"","ingredients":["zakwas"],"steps":["Gotuj."],"tags":[]}'

  it('sends the page text and the hint, asks for a json_schema, and records the spend', async () => {
    const recipe = await agent([good]).extract({ html, sourceUrl: URL_, hint: { title: 'zły', description: '', sourceUrl: URL_, ingredients: [], steps: [], tags: [] } })
    assert.deepEqual(recipe.steps, ['Gotuj.'])
    assert.equal(requests[0]?.responseFormat?.type, 'json_schema')
    const user = requests[0]?.messages[1]?.content ?? ''
    assert.match(user, /## Żurek/)
    assert.match(user, /- zakwas/)
    assert.match(user, /DANE STRUKTURALNE/)
    const calls = await repos.aiCalls.listRecent(5)
    assert.equal(calls[0]?.purpose, 'recipe-import')
  })

  it('retries once, naming the problem, when the reply has no steps', async () => {
    const recipe = await agent(['{"title":"Żurek","ingredients":["zakwas"],"steps":[],"tags":[]}', good]).extract({ html, sourceUrl: URL_ })
    assert.deepEqual(recipe.steps, ['Gotuj.'])
    assert.equal(requests.length, 2)
    assert.match(requests[1]?.messages.at(-1)?.content ?? '', /steps jest puste/)
  })

  it('accepts a page with no method after the retry rather than inventing one', async () => {
    const empty = '{"title":"Żurek","ingredients":["zakwas"],"steps":[],"tags":[]}'
    const recipe = await agent([empty, empty]).extract({ html, sourceUrl: URL_ })
    assert.deepEqual(recipe.steps, [])
  })

  it('drops the json_schema and tries again when the model refuses it', async () => {
    const recipe = await agent([new Error('kilo gateway responded 400'), good]).extract({ html, sourceUrl: URL_ })
    assert.equal(recipe.title, 'Żurek')
    assert.equal(requests[0]?.responseFormat !== undefined, true)
    assert.equal(requests[1]?.responseFormat, undefined)
  })

  it('throws when the reply stays unusable', async () => {
    await assert.rejects(agent(['nie wiem', 'nadal nie wiem']).extract({ html, sourceUrl: URL_ }), /unusable/)
  })
})

describe('pageToText', () => {
  it('keeps headings and list items, drops chrome, and does not split a method at a blank line', () => {
    const text = pageToText(
      '<html><head><title>T</title><script>evil()</script></head><body><nav>Menu</nav>' +
        '<h2>Składniki</h2><ul><li>mąka</li><li>jajko</li></ul>' +
        '<h2>Przygotowanie</h2><p>Wymieszaj.</p><p></p><p>&nbsp;</p><p>Upiecz.</p><footer>stopka</footer></body></html>',
    )
    assert.match(text, /## Składniki\n- mąka\n- jajko\n## Przygotowanie\nWymieszaj\.\nUpiecz\./)
    assert.doesNotMatch(text, /evil|Menu|stopka/)
  })

  it('caps very long pages', () => {
    const text = pageToText(`<body>${'<p>słowo </p>'.repeat(10_000)}</body>`)
    assert.ok(text.length < 25_000)
    assert.match(text, /truncated/)
  })
})

describe('importRecipeFromUrl with an agent', () => {
  const html = '<html><body><script type="application/ld+json">{"@type":"Recipe","name":"Żurek","description":"Opis strony","recipeIngredient":["zakwas"],"recipeInstructions":[]}</script></body></html>'
  const fetcher = async () => ({ text: async () => html })
  const read = { title: 'Żurek', description: 'z modelu', sourceUrl: URL_, ingredients: ['zakwas'], steps: ['Gotuj.'], tags: [] }

  it('prefers the agent, keeping the page-authored description', async () => {
    const recipe = await importRecipeFromUrl(URL_, { fetcher, agent: async () => read })
    assert.deepEqual(recipe.steps, ['Gotuj.'])
    assert.equal(recipe.description, 'Opis strony')
  })

  it('falls back to the markup-only result, and says why', async () => {
    let told: unknown
    const recipe = await importRecipeFromUrl(URL_, {
      fetcher,
      agent: async () => {
        throw new Error('gateway down')
      },
      onAgentError: (e) => {
        told = e
      },
    })
    assert.deepEqual(recipe.ingredients, ['zakwas'])
    assert.match(String(told), /gateway down/)
  })

  it('still imports a page the markup extractors cannot read, when the agent can', async () => {
    const recipe = await importRecipeFromUrl(URL_, {
      fetcher: async () => ({ text: async () => '<html><body><p>przepis w prozie</p></body></html>' }),
      agent: async () => read,
    })
    assert.equal(recipe.title, 'Żurek')
  })
})
