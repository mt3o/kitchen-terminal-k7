/**
 * The persistence schema.
 *
 * Table and column names follow the ratified domain vocabulary rather than
 * whatever reads well in SQL: a Recipe, a ShoppingListItem, a Conversation, a
 * Message, an AiCall. Where the domain model drew a distinction, the schema
 * keeps it — see `aiCalls` below, which exists precisely because an AiCall is
 * not a Message.
 *
 * Timestamps are integer epoch milliseconds. SQLite has no date type, and a
 * TEXT ISO string sorts correctly but costs a parse on every read.
 */
import { sql } from 'drizzle-orm'
import { blob, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const now = sql`(unixepoch() * 1000)`

/** A dish the household has saved. The extracted result, not the source page. */
export const recipes = sqliteTable('recipes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  /** Free text. Null for a recipe saved before this column existed, or with none typed. */
  description: text('description'),
  /** Where it was imported from. Null for one typed in by hand. */
  sourceUrl: text('source_url'),
  /** JSON arrays: the shapes vary too much between sources for columns. */
  ingredients: text('ingredients', { mode: 'json' }).$type<string[]>().notNull(),
  steps: text('steps', { mode: 'json' }).$type<string[]>().notNull(),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
  importedAt: integer('imported_at', { mode: 'timestamp_ms' }).notNull().default(now),
})

/**
 * One line on the household shopping list.
 *
 * The list itself is a singleton and is not modelled. The id is a UUID rather
 * than a rowid because the same item may later be owned by the separate Zakupy
 * project — the domain model says it is the same item whichever store backs it,
 * and an integer rowid would not survive that move.
 */
export const shoppingListItems = sqliteTable(
  'shopping_list',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    category: text('category'),
    checked: integer('checked', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [index('shopping_list_checked_idx').on(t.checked)],
)

/** One chat thread. The unit the rolling window and compacting operate on. */
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title'),
  /** The model this thread defaults to, as provider/model-name. */
  model: text('model').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
})

/** One turn in a Conversation. No identity outside it, hence the cascade. */
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
)

/**
 * One billable request to the gateway.
 *
 * Both foreign keys are nullable, and that is the whole point of this table
 * existing separately: a single Message may cost several AiCalls, and compacting
 * spends them with no Message to show for it. `set null` rather than `cascade`
 * on delete — deleting a conversation must not erase what it cost.
 */
export const aiCalls = sqliteTable(
  'ai_calls',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
    /** Why the call happened: a turn, a compaction, a daily ASCII render. */
    purpose: text('purpose', { enum: ['chat', 'compacting', 'ascii-art', 'transcription', 'recipe-extraction', 'recipe-tagging'] }).notNull(),
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    /** Estimated, not billed: computed from the gateway's published price. */
    estimatedCostUsd: real('estimated_cost_usd').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [index('ai_calls_created_idx').on(t.createdAt)],
)

/**
 * Last-good responses from upstreams the household does not control.
 *
 * This exists because the common failure is the internet being down while the
 * LAN is up: the server still answers, and what matters is that it can answer
 * with the last weather it saw rather than an error. A Service Worker cannot
 * help with that at all — it is not the network that is missing.
 *
 * `fetched_at` is the whole point of the table. Anything served from here is
 * served with its age, because a cache that cannot say how old it is has to
 * either lie or refuse.
 */
export const upstreamCache = sqliteTable('upstream_cache', {
  /** Stable per request shape — the same location and units hit the same row. */
  key: text('key').primaryKey(),
  upstream: text('upstream', { enum: ['open-meteo', 'google-calendar', 'kilo-gateway', 'rss', 'ics', 'unsplash'] }).notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull().default(now),
})

export type UpstreamCacheRow = typeof upstreamCache.$inferSelect

/**
 * The household-visible issue log — see `IssueLogEntry`'s own doc comment for
 * why this exists alongside GlitchTip rather than instead of it. `source` is
 * left as free text rather than the `upstream` enum above: `server` and
 * `client` are not upstreams, and a new upstream must not need a migration
 * just to be nameable here.
 */
export const issueLog = sqliteTable(
  'issue_log',
  {
    id: text('id').primaryKey(),
    severity: text('severity', { enum: ['warn', 'error'] }).notNull(),
    source: text('source').notNull(),
    message: text('message').notNull(),
    detail: text('detail'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [index('issue_log_created_idx').on(t.createdAt)],
)

export type IssueLogRow = typeof issueLog.$inferSelect

/**
 * A recipe add/import attempt the server rejected — see `RecipeRejection`'s
 * own doc comment for why this is a separate table from `issueLog` rather
 * than an extension of it. `attemptedInput` is JSON for the same
 * "shapes vary too much for columns" reason `recipes.ingredients`/`steps`/
 * `tags` already are.
 */
export const recipeRejections = sqliteTable(
  'recipe_rejections',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['save', 'import'] }).notNull(),
    reason: text('reason').notNull(),
    attemptedInput: text('attempted_input', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [index('recipe_rejections_created_idx').on(t.createdAt)],
)

export type RecipeRejectionRow = typeof recipeRejections.$inferSelect

export type RecipeRow = typeof recipes.$inferSelect
export type ShoppingListItemRow = typeof shoppingListItems.$inferSelect
export type ConversationRow = typeof conversations.$inferSelect
export type MessageRow = typeof messages.$inferSelect
export type AiCallRow = typeof aiCalls.$inferSelect

/**
 * An OAuth credential the household granted through the browser, rather than
 * one pasted into `.env.local` by hand.
 *
 * One row per provider — this is not a general secrets cabinet, and should not
 * grow into one without a decision saying so. The refresh token is never stored
 * in the clear: `ciphertext`/`iv`/`auth_tag` are AES-256-GCM, keyed from
 * `K7_SECRET_KEY` (see `crypto/secret-box.ts`). That protects a database file
 * that leaks on its own — a backup, a copy handed over for debugging — and not
 * an attacker with shell access on the host, who can read the key from the same
 * `.env.local` where today's plaintext token already lives.
 *
 * `scope` and `account_email` exist for the admin view to say *what* is
 * connected without decrypting anything.
 */
export const oauthCredentials = sqliteTable('oauth_credentials', {
  provider: text('provider', { enum: ['google'] }).primaryKey(),
  ciphertext: blob('ciphertext', { mode: 'buffer' }).notNull(),
  /** Fresh per write. Reusing an IV with the same key breaks GCM outright. */
  iv: blob('iv', { mode: 'buffer' }).notNull(),
  authTag: blob('auth_tag', { mode: 'buffer' }).notNull(),
  /** What Google actually granted, which is not necessarily what was asked. */
  scope: text('scope').notNull(),
  /** Display only: "connected as …". Null when Google did not tell us. */
  accountEmail: text('account_email'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
})

export type OauthCredentialRow = typeof oauthCredentials.$inferSelect
