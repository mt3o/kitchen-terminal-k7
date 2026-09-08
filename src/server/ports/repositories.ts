/**
 * The repository ports.
 *
 * The application core talks to these and never to a driver. Swapping SQLite for
 * something else, or the shopping list for the Zakupy project's API, is writing
 * one more adapter — not touching the core. That is the claim the hexagonal
 * decision makes, and keeping the port free of Drizzle types is what keeps it
 * true rather than aspirational.
 */
import type {
  AiCall,
  Conversation,
  Message,
  Recipe,
  ShoppingListItem,
} from '../domain/types.ts'

/** Fields the caller supplies; the store owns ids and timestamps. */
export type New<T, K extends keyof T = never> = Omit<T, 'id' | 'createdAt' | 'updatedAt' | K>

export interface RecipeRepository {
  list(options?: { tag?: string; limit?: number }): Promise<Recipe[]>
  get(id: string): Promise<Recipe | undefined>
  save(recipe: Omit<Recipe, 'importedAt'> | Recipe): Promise<Recipe>
  delete(id: string): Promise<boolean>
}

export interface ShoppingListRepository {
  list(options?: { includeChecked?: boolean }): Promise<ShoppingListItem[]>
  add(item: New<ShoppingListItem, 'checked'> & { checked?: boolean }): Promise<ShoppingListItem>
  setChecked(id: string, checked: boolean): Promise<ShoppingListItem | undefined>
  delete(id: string): Promise<boolean>
}

export interface ConversationRepository {
  list(limit?: number): Promise<Conversation[]>
  get(id: string): Promise<Conversation | undefined>
  create(conversation: New<Conversation>): Promise<Conversation>
  /** Deleting a thread must not erase what it cost — see AiCallRepository. */
  delete(id: string): Promise<boolean>
  /** Ordered oldest-first: the rolling window trims from the front. */
  messages(conversationId: string): Promise<Message[]>
  addMessage(message: New<Message>): Promise<Message>
}

export interface AiCallRepository {
  record(call: New<AiCall>): Promise<AiCall>
  /** What the household has spent since a moment, for the cost view. */
  totalCostSince(since: Date): Promise<{ calls: number; costUsd: number }>
}

/** Everything the core needs from storage, in one injectable bundle. */
export interface Repositories {
  recipes: RecipeRepository
  shoppingList: ShoppingListRepository
  conversations: ConversationRepository
  aiCalls: AiCallRepository
}
