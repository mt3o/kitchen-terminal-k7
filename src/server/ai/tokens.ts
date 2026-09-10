/**
 * Token estimation, for context budgeting only — never for billing.
 *
 * No tokenizer dependency is added for this: Kilo Gateway fronts dozens of
 * providers and does not disclose which tokenizer any given model uses, so a
 * real count would mean picking and pinning one per model family for an
 * approximation anyway. A `length/4` heuristic is close enough to decide
 * *when* to compact; it never decides *what gets billed* — the gateway's own
 * `usage.prompt_tokens`/`completion_tokens` does that, always, after the
 * fact. See ConversationService's hard rolling-window safety net for why an
 * inaccurate estimate here can never send an over-budget request.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}
