/**
 * Persistence tests, written against the *ports* rather than the adapter.
 *
 * Every assertion here would still hold if the Drizzle adapter were replaced,
 * which is the point of having a port at all: these tests are the executable
 * form of the claim that the storage engine is swappable.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { createRepositories, openDatabase } from '../src/server/adapters/drizzle/index.ts'
import { runMigrations } from '../src/server/db/migrate.ts'
import type { Repositories } from '../src/server/ports/repositories.ts'

let repos: Repositories

beforeEach(() => {
  const db = openDatabase(':memory:')
  runMigrations(db)
  repos = createRepositories(db)
})

describe('migrations', () => {
  it('build a schema an empty database can be used against', async () => {
    assert.deepEqual(await repos.recipes.list(), [])
    assert.deepEqual(await repos.shoppingList.list(), [])
    assert.deepEqual(await repos.conversations.list(), [])
  })
})

describe('RecipeRepository', () => {
  it('round-trips the JSON columns as real arrays', async () => {
    const saved = await repos.recipes.save({
      id: '',
      title: 'Naleśniki',
      sourceUrl: 'https://example.test/nalesniki',
      ingredients: ['mąka', 'mleko', 'jajka'],
      steps: ['wymieszać', 'smażyć'],
      tags: ['śniadanie'],
    })
    const got = await repos.recipes.get(saved.id)
    assert.deepEqual(got?.ingredients, ['mąka', 'mleko', 'jajka'])
    assert.equal(got?.tags[0], 'śniadanie', 'Polish diacritics survived the round trip')
    assert.ok(got?.importedAt instanceof Date, 'timestamp came back as a Date, not a number')
  })

  it('filters by tag and deletes', async () => {
    await repos.recipes.save({ id: '', title: 'A', sourceUrl: null, ingredients: [], steps: [], tags: ['obiad'] })
    const b = await repos.recipes.save({ id: '', title: 'B', sourceUrl: null, ingredients: [], steps: [], tags: ['deser'] })
    assert.equal((await repos.recipes.list({ tag: 'obiad' })).length, 1)
    assert.equal(await repos.recipes.delete(b.id), true)
    assert.equal(await repos.recipes.delete(b.id), false, 'deleting twice reported success')
  })
})

describe('ShoppingListRepository', () => {
  it('hides checked items unless asked', async () => {
    const milk = await repos.shoppingList.add({ label: 'mleko', category: 'nabiał' })
    await repos.shoppingList.add({ label: 'chleb', category: 'pieczywo' })
    await repos.shoppingList.setChecked(milk.id, true)

    assert.deepEqual((await repos.shoppingList.list()).map((i) => i.label), ['chleb'])
    assert.equal((await repos.shoppingList.list({ includeChecked: true })).length, 2)
  })

  it('reports a miss instead of inventing a row', async () => {
    assert.equal(await repos.shoppingList.setChecked('nope', true), undefined)
  })
})

describe('Conversation and Message', () => {
  it('orders messages oldest-first, which is what the rolling window trims from', async () => {
    const c = await repos.conversations.create({ title: 'obiad', model: 'kilo-auto/free' })
    for (const content of ['pierwsza', 'druga', 'trzecia']) {
      await repos.conversations.addMessage({ conversationId: c.id, role: 'user', content })
    }
    assert.deepEqual((await repos.conversations.messages(c.id)).map((m) => m.content), [
      'pierwsza',
      'druga',
      'trzecia',
    ])
  })

  it('refuses a message for a conversation that does not exist', async () => {
    // Foreign keys are OFF by default in SQLite. If this passes, the pragma was
    // never set and every cascade in the schema is decorative.
    await assert.rejects(
      () => repos.conversations.addMessage({ conversationId: 'ghost', role: 'user', content: 'x' }),
      /FOREIGN KEY/i,
    )
  })
})

describe('AiCall', () => {
  it('outlives the conversation it was spent on', async () => {
    // The domain model is explicit that an AiCall is not a Message: deleting a
    // thread must not erase what it cost. That is `set null`, not `cascade`.
    const c = await repos.conversations.create({ title: null, model: 'kilo-auto/free' })
    await repos.aiCalls.record({
      conversationId: c.id,
      messageId: null,
      purpose: 'compacting',
      model: 'kilo-auto/free',
      promptTokens: 1200,
      completionTokens: 80,
      estimatedCostUsd: 0.0004,
    })
    assert.equal((await repos.aiCalls.totalCostSince(new Date(0))).calls, 1)

    assert.equal(await repos.conversations.delete(c.id), true)

    const after = await repos.aiCalls.totalCostSince(new Date(0))
    assert.equal(after.calls, 1, 'the cost record vanished with its conversation')
    assert.ok(Math.abs(after.costUsd - 0.0004) < 1e-9, 'the cost was lost')
  })

  it('records a call with no conversation at all', async () => {
    // The daily ASCII render costs money and belongs to no thread.
    const call = await repos.aiCalls.record({
      conversationId: null,
      messageId: null,
      purpose: 'ascii-art',
      model: 'kilo-auto/free',
      promptTokens: 40,
      completionTokens: 300,
      estimatedCostUsd: 0.0001,
    })
    assert.equal(call.conversationId, null)
  })
})
