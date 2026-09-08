/**
 * The domain records, in the project's own vocabulary.
 *
 * These types know nothing about SQLite, Drizzle or HTTP. That is the point: the
 * core is what the adapters are adapted *to*, and if a type here mentions a
 * column name or a driver, the dependency has been pointed the wrong way.
 */

/** A dish the household has saved. The extracted result, not the source page. */
export interface Recipe {
  id: string
  title: string
  sourceUrl: string | null
  ingredients: string[]
  steps: string[]
  tags: string[]
  importedAt: Date
}

/** One line on the household shopping list. */
export interface ShoppingListItem {
  id: string
  label: string
  category: string | null
  checked: boolean
  createdAt: Date
  updatedAt: Date
}

/** One chat thread; owns its Messages and its context budget. */
export interface Conversation {
  id: string
  title: string | null
  model: string
  createdAt: Date
  updatedAt: Date
}

export type MessageRole = 'user' | 'assistant' | 'system'

/** One turn in a Conversation. Not an AiCall — one Message may cost several. */
export interface Message {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  createdAt: Date
}

export type AiCallPurpose = 'chat' | 'compacting' | 'ascii-art' | 'transcription'

/** One billable request to the gateway. */
export interface AiCall {
  id: string
  conversationId: string | null
  messageId: string | null
  purpose: AiCallPurpose
  model: string
  promptTokens: number
  completionTokens: number
  estimatedCostUsd: number
  createdAt: Date
}
