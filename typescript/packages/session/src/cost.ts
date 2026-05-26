/**
 * Cost — blame attribution for token spend.
 *
 * Like `git blame` but for money:
 * which goal caused which spend, and how much cache saved you.
 */
import type { TokenUsage, Blame } from './types.js'

// Per-million-token pricing (USD)
const PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0, cacheRead: 0.30 },
  'claude-opus-4-20250514': { input: 15.0, output: 75.0, cacheRead: 1.50 },
  'claude-opus-4-6-20250515': { input: 15.0, output: 75.0, cacheRead: 1.50 },
  'claude-haiku-3-20250307': { input: 0.25, output: 1.25, cacheRead: 0.03 },
  'claude-sonnet-3-5-20241022': { input: 3.0, output: 15.0, cacheRead: 0.30 },
}

const DEFAULT_PRICING = { input: 3.0, output: 15.0, cacheRead: 0.30 }

function getPricing(model: string) {
  // Try exact match first, then prefix match
  if (PRICING[model]) return PRICING[model]
  for (const [key, pricing] of Object.entries(PRICING)) {
    if (model.startsWith(key.split('-').slice(0, 3).join('-'))) return pricing
  }
  return DEFAULT_PRICING
}

/**
 * Compute cost for a single message's token usage.
 */
export function computeMessageCost(usage: TokenUsage, model: string): Blame {
  const pricing = getPricing(model)
  const perToken = 1 / 1_000_000

  const inputTokens = usage.input_tokens
  const outputTokens = usage.output_tokens
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0

  const inputCost = inputTokens * pricing.input * perToken
  const outputCost = outputTokens * pricing.output * perToken
  const cacheReadCost = cacheReadTokens * pricing.cacheRead * perToken

  // Cache savings = tokens that were cache-read × (full price - cache price)
  const cacheSavings = cacheReadTokens * (pricing.input - pricing.cacheRead) * perToken

  const totalCost = inputCost + outputCost + cacheReadCost

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    inputCost,
    outputCost,
    cacheSavings,
    totalCost,
  }
}

/**
 * Aggregate multiple blame entries into one summary.
 * Like squashing commits — gives you the total picture.
 */
export function aggregateBlame(blames: Blame[]): Blame {
  return blames.reduce(
    (acc, b) => ({
      inputTokens: acc.inputTokens + b.inputTokens,
      outputTokens: acc.outputTokens + b.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + b.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + b.cacheWriteTokens,
      inputCost: acc.inputCost + b.inputCost,
      outputCost: acc.outputCost + b.outputCost,
      cacheSavings: acc.cacheSavings + b.cacheSavings,
      totalCost: acc.totalCost + b.totalCost,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputCost: 0,
      outputCost: 0,
      cacheSavings: 0,
      totalCost: 0,
    }
  )
}
