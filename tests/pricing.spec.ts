import { describe, expect, it } from 'vitest'
import { estimateCost, lookupPricing } from '../src/pricing.ts'

const table = {
  'deepseek/deepseek-chat': {
    inputPerMillion: 1,
    cachedInputPerMillion: 0.1,
    outputPerMillion: 2,
  },
}

describe('lookupPricing', () => {
  it('matches provider/model and bare model aliases', () => {
    expect(lookupPricing(table, 'deepseek', 'deepseek-chat')?.inputPerMillion).toBe(1)
    expect(lookupPricing(table, 'deepseek', 'deepseek/deepseek-chat')?.inputPerMillion).toBe(1)
    expect(lookupPricing(table, 'other', 'glm-5.2')).toBeUndefined()
  })
})

describe('estimateCost', () => {
  it('prices uncached, cached, and output tokens per million', () => {
    expect(estimateCost({
      uncachedInputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
      outputTokens: 500_000,
    }, table['deepseek/deepseek-chat'])).toBeCloseTo(2.1, 8)
  })

  it('returns null when the model has no rates', () => {
    expect(estimateCost({
      uncachedInputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1,
    }, undefined)).toBeNull()
  })
})
