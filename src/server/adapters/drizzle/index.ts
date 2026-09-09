/**
 * The Drizzle/SQLite adapter: the only file that knows both the domain and the
 * database. Every mapping between a row and a domain record lives here, so the
 * core stays free of column names and the port stays free of Drizzle types.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type {
  AiCall,
  CacheEntry,
  Conversation,
  Message,
  Recipe,
  ShoppingListItem,
} from '../../domain/types.ts'
import type {
  AiCallRepository,
  ConversationRepository,
  RecipeRepository,
  Repositories,
  ShoppingListRepository,
  UpstreamCacheRepository,
} from '../../ports/repositories.ts'
import * as schema from '../../db/schema.ts'

export type Db = BetterSQLite3Database<typeof schema>

/**
 * Open the store.
 *
 * WAL is on because the kiosk reads constantly while the backend writes: the
 * default rollback journal makes every read wait behind a write, which on a
 * screen that refreshes on a timer is visible as a stutter.
 *
 * Foreign keys are OFF by default in SQLite — every session must ask. The
 * cascade on messages and the set-null on ai_calls are load-bearing, so this is
 * not optional.
 */
export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}

const toRecipe = (r: schema.RecipeRow): Recipe => ({
  id: r.id,
  title: r.title,
  sourceUrl: r.sourceUrl,
  ingredients: r.ingredients,
  steps: r.steps,
  tags: r.tags,
  importedAt: r.importedAt,
})

const toItem = (r: schema.ShoppingListItemRow): ShoppingListItem => ({ ...r })
const toConversation = (r: schema.ConversationRow): Conversation => ({ ...r })
const toMessage = (r: schema.MessageRow): Message => ({ ...r })
const toAiCall = (r: schema.AiCallRow): AiCall => ({ ...r })

export function createRepositories(db: Db): Repositories {
  const recipes: RecipeRepository = {
    async list({ tag, limit = 50 } = {}) {
      const rows = await db.select().from(schema.recipes).orderBy(desc(schema.recipes.importedAt)).limit(limit)
      // Tags are a JSON array, so the filter is in JS rather than SQL. At
      // household scale that is cheaper than a join table nobody else needs.
      return rows.map(toRecipe).filter((r) => (tag ? r.tags.includes(tag) : true))
    },
    async get(id) {
      const [row] = await db.select().from(schema.recipes).where(eq(schema.recipes.id, id)).limit(1)
      return row ? toRecipe(row) : undefined
    },
    async save(recipe) {
      const id = recipe.id || randomUUID()
      const values = { ...recipe, id, importedAt: 'importedAt' in recipe ? recipe.importedAt : new Date() }
      const [row] = await db
        .insert(schema.recipes)
        .values(values)
        .onConflictDoUpdate({ target: schema.recipes.id, set: values })
        .returning()
      return toRecipe(row!)
    },
    async delete(id) {
      const rows = await db.delete(schema.recipes).where(eq(schema.recipes.id, id)).returning()
      return rows.length > 0
    },
  }

  const shoppingList: ShoppingListRepository = {
    async list({ includeChecked = false } = {}) {
      const where = includeChecked ? undefined : eq(schema.shoppingListItems.checked, false)
      const rows = await db.select().from(schema.shoppingListItems).where(where)
      return rows.map(toItem)
    },
    async add(item) {
      const [row] = await db
        .insert(schema.shoppingListItems)
        .values({ ...item, id: randomUUID(), checked: item.checked ?? false })
        .returning()
      return toItem(row!)
    },
    async setChecked(id, checked) {
      const [row] = await db
        .update(schema.shoppingListItems)
        .set({ checked, updatedAt: new Date() })
        .where(eq(schema.shoppingListItems.id, id))
        .returning()
      return row ? toItem(row) : undefined
    },
    async delete(id) {
      const rows = await db.delete(schema.shoppingListItems).where(eq(schema.shoppingListItems.id, id)).returning()
      return rows.length > 0
    },
  }

  const conversations: ConversationRepository = {
    async list(limit = 20) {
      const rows = await db
        .select()
        .from(schema.conversations)
        .orderBy(desc(schema.conversations.updatedAt))
        .limit(limit)
      return rows.map(toConversation)
    },
    async get(id) {
      const [row] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).limit(1)
      return row ? toConversation(row) : undefined
    },
    async create(conversation) {
      const [row] = await db
        .insert(schema.conversations)
        .values({ ...conversation, id: randomUUID() })
        .returning()
      return toConversation(row!)
    },
    async delete(id) {
      const rows = await db.delete(schema.conversations).where(eq(schema.conversations.id, id)).returning()
      return rows.length > 0
    },
    async messages(conversationId) {
      const rows = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId))
        .orderBy(schema.messages.createdAt)
      return rows.map(toMessage)
    },
    async addMessage(message) {
      const [row] = await db
        .insert(schema.messages)
        .values({ ...message, id: randomUUID() })
        .returning()
      // A thread's position in the list is about its last turn, not its birth.
      await db
        .update(schema.conversations)
        .set({ updatedAt: new Date() })
        .where(eq(schema.conversations.id, message.conversationId))
      return toMessage(row!)
    },
  }

  const aiCalls: AiCallRepository = {
    async record(call) {
      const [row] = await db
        .insert(schema.aiCalls)
        .values({ ...call, id: randomUUID() })
        .returning()
      return toAiCall(row!)
    },
    async totalCostSince(since) {
      const [row] = await db
        .select({
          calls: sql<number>`count(*)`,
          costUsd: sql<number>`coalesce(sum(${schema.aiCalls.estimatedCostUsd}), 0)`,
        })
        .from(schema.aiCalls)
        .where(and(gte(schema.aiCalls.createdAt, since)))
      return { calls: Number(row?.calls ?? 0), costUsd: Number(row?.costUsd ?? 0) }
    },
    async listRecent(limit = 50) {
      const rows = await db.select().from(schema.aiCalls).orderBy(desc(schema.aiCalls.createdAt)).limit(limit)
      return rows.map(toAiCall)
    },
  }

  const upstreamCache: UpstreamCacheRepository = {
    async get(key) {
      const [row] = await db.select().from(schema.upstreamCache).where(eq(schema.upstreamCache.key, key)).limit(1)
      return row ? ({ ...row } as CacheEntry) : undefined
    },
    async put(key, upstream, payload, fetchedAt) {
      const values = { key, upstream, payload, fetchedAt: fetchedAt ?? new Date() }
      const [row] = await db
        .insert(schema.upstreamCache)
        .values(values)
        .onConflictDoUpdate({ target: schema.upstreamCache.key, set: values })
        .returning()
      return { ...row! } as CacheEntry
    },
  }

  return { recipes, shoppingList, conversations, aiCalls, upstreamCache }
}
