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

export type AiCallPurpose = 'chat' | 'compacting' | 'ascii-art' | 'transcription' | 'recipe-extraction'

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

export type Upstream = 'open-meteo' | 'google-calendar' | 'kilo-gateway' | 'rss' | 'ics' | 'unsplash'

export type CalendarSource =
  | { mode: 'google'; calendarId: string }
  | { mode: 'ics'; url: string }

/** A configured calendar source for the calendar card — one tab, one fetch. */
export interface Calendar {
  id: string
  name: string
  showInMain: boolean
  source: CalendarSource
}

/**
 * One entry from any calendar source, mapped to a shared shape here because
 * both `upstream/ics-calendar.ts` and `upstream/google-calendar.ts` produce
 * it — the first case in this codebase of two upstreams feeding the same
 * domain concept, unlike every other upstream (weather, comic, models),
 * which is the only source of its own shape. Matches the client's own
 * `CalendarEvent` (`client/lib/calendar.ts`) field-for-field; kept as a
 * separate declaration rather than a cross-boundary import, per Phase 1's
 * decision that no client code imports server types today.
 */
export interface CalendarEvent {
  id: string
  title: string
  /** ISO 8601 — either a timestamp or a bare `YYYY-MM-DD` for an all-day event. */
  start: string
  end: string
  allDay?: boolean
}

/**
 * An upstream response, always carrying its own age.
 *
 * There is no variant of this without `ageSeconds`, on purpose: the rule is that
 * the cache never lies about freshness, and the way to enforce a rule like that
 * is to make the honest field impossible to omit rather than easy to forget.
 */
export interface Aged<T> {
  data: T
  fetchedAt: Date
  ageSeconds: number
  /** `live` means the network answered this time; `cache` means it did not. */
  source: 'live' | 'cache'
  /** Older than the caller's freshness window. */
  stale: boolean
}

/** What a cached upstream response looks like in the store. */
export interface CacheEntry {
  key: string
  upstream: Upstream
  payload: unknown
  fetchedAt: Date
}

/**
 * `warn` is a degraded-but-handled condition the design already accounts for
 * (an upstream unreachable, serving a stale cache). `error` is everything the
 * design did not expect: an uncaught server exception or a client JS crash.
 * The household reads the same log either way — the split only changes
 * whether GlitchTip also hears about it (`observability.ts`'s own call sites
 * decide that; this type just carries the label along).
 */
export type IssueSeverity = 'warn' | 'error'

/** Where the entry came from: an Upstream name, `server` or `client`. */
export type IssueSource = Upstream | 'server' | 'client'

/**
 * One row in the household-visible issue log — "comic-of-the-day fell back to
 * yesterday's image", "the calendar card crashed", that sort of thing. Kept in
 * SQLite rather than only in GlitchTip because GlitchTip is opt-in (no DSN is
 * a supported way to run, `observability.ts`) and because "what went wrong
 * today" is a question the household should be able to ask the dashboard
 * itself, not an external dashboard nobody in the kitchen has open.
 */
export interface IssueLogEntry {
  id: string
  severity: IssueSeverity
  source: IssueSource
  message: string
  detail: string | null
  createdAt: Date
}
