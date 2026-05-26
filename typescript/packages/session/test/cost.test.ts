import { describe, it, expect } from 'vitest'
import { computeMessageCost, aggregateBlame } from '../src/cost.js'

describe('cost', () => {
  it('computes cost for sonnet usage', () => {
    const blame = computeMessageCost(
      { input_tokens: 10000, output_tokens: 500, cache_read_input_tokens: 5000 },
      'claude-sonnet-4-20250514'
    )

    // Input: 10000 * $3/1M = $0.03
    expect(blame.inputCost).toBeCloseTo(0.03, 4)
    // Output: 500 * $15/1M = $0.0075
    expect(blame.outputCost).toBeCloseTo(0.0075, 4)
    // Cache savings: 5000 * ($3 - $0.30) / 1M = $0.0135
    expect(blame.cacheSavings).toBeCloseTo(0.0135, 4)
    expect(blame.totalCost).toBeGreaterThan(0)
  })

  it('uses default pricing for unknown models', () => {
    const blame = computeMessageCost(
      { input_tokens: 1000, output_tokens: 100 },
      'unknown-model-v99'
    )
    expect(blame.totalCost).toBeGreaterThan(0)
    expect(blame.inputTokens).toBe(1000)
  })

  it('aggregates multiple blames correctly', () => {
    const b1 = computeMessageCost(
      { input_tokens: 1000, output_tokens: 100 },
      'claude-sonnet-4-20250514'
    )
    const b2 = computeMessageCost(
      { input_tokens: 2000, output_tokens: 200, cache_read_input_tokens: 500 },
      'claude-sonnet-4-20250514'
    )

    const total = aggregateBlame([b1, b2])
    expect(total.inputTokens).toBe(3000)
    expect(total.outputTokens).toBe(300)
    expect(total.cacheReadTokens).toBe(500)
    expect(total.totalCost).toBeCloseTo(b1.totalCost + b2.totalCost, 6)
  })

  it('handles zero cache tokens', () => {
    const blame = computeMessageCost(
      { input_tokens: 500, output_tokens: 50 },
      'claude-opus-4-20250514'
    )
    expect(blame.cacheReadTokens).toBe(0)
    expect(blame.cacheSavings).toBe(0)
  })
})
