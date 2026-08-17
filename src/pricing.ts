/**
 * Local USD estimates. Missing rates stay unknown — never invent a number.
 */

import type { TokenBuckets } from './client-contract.ts'

/** Per-million-token USD rates for one model. */
export interface ModelPricing {
  inputPerMillion: number
  outputPerMillion: number
  cachedInputPerMillion?: number
  cacheWritePerMillion?: number
}

export type PricingTable = Readonly<Record<string, ModelPricing>>

/**
 * Published API rates we can stand behind. Subscription / local routes stay
 * off this table so the UI can say Unknown instead of guessing.
 */
export const BUILTIN_PRICING: PricingTable = Object.freeze({
  'deepseek/deepseek-chat': {
    inputPerMillion: 0.28,
    cachedInputPerMillion: 0.028,
    outputPerMillion: 0.42,
  },
  'deepseek/deepseek-reasoner': {
    inputPerMillion: 0.28,
    cachedInputPerMillion: 0.028,
    outputPerMillion: 0.42,
  },
})

const aliasesOf = (provider: string, model: string): string[] => {
  const trimmedModel = model.trim()
  const trimmedProvider = provider.trim()
  const bare = trimmedModel.includes('/')
    ? trimmedModel.slice(trimmedModel.lastIndexOf('/') + 1)
    : trimmedModel
  return [
    `${trimmedProvider}/${trimmedModel}`,
    `${trimmedProvider}/${bare}`,
    trimmedModel,
    bare,
  ]
}

/** Look up rates for a provider/model pair. */
export function lookupPricing(
  table: PricingTable,
  provider: string,
  model: string,
): ModelPricing | undefined {
  for (const key of aliasesOf(provider, model)) {
    const found = table[key]
    if (found !== undefined) return found
  }
  return undefined
}

/** USD cost for one sample, or null when the model has no rates. */
export function estimateCost(
  buckets: TokenBuckets,
  pricing: ModelPricing | undefined,
): number | null {
  if (pricing === undefined) return null
  const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion
  const writeRate = pricing.cacheWritePerMillion ?? pricing.inputPerMillion
  return (
    buckets.uncachedInputTokens * pricing.inputPerMillion
    + buckets.cacheReadTokens * cachedRate
    + buckets.cacheWriteTokens * writeRate
    + buckets.outputTokens * pricing.outputPerMillion
  ) / 1_000_000
}

/** Providers known to report cache-read tokens when a cache hit occurs. */
export const CACHE_CAPABLE_PROVIDERS = new Set([
  'deepseek',
  'openai-codex',
  'kimi-coding',
  'official',
  'openai',
])

export function reportsCache(provider: string, cacheReadTokens: number): boolean {
  return cacheReadTokens > 0 || CACHE_CAPABLE_PROVIDERS.has(provider)
}
