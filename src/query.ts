/**
 * Window a folded corpus into daily rollups plus summary tiles.
 */

import type { UsageEvent, UsageSnapshot, UsageSummary } from './client-contract.ts'
import type { StepUsage } from './fold.ts'
import { estimateCost, lookupPricing, reportsCache, type PricingTable } from './pricing.ts'

export interface UsageQueryInput {
  steps: readonly StepUsage[]
  start: number
  end: number
  pricing: PricingTable
}

const dayKey = (time: number): string => {
  const date = new Date(time)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const dayStart = (time: number): number => {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const rollupKey = (step: StepUsage, day: string): string =>
  `${day}\0${step.provider}\0${step.model}\0${step.workspaceId}`

const emptyRollup = (step: StepUsage, day: string, time: number): UsageEvent => ({
  time,
  day,
  provider: step.provider,
  model: step.model,
  workspaceId: step.workspaceId,
  workspaceTitle: step.workspaceTitle,
  requests: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

const addStep = (target: UsageEvent, step: StepUsage): void => {
  target.requests += 1
  target.uncachedInputTokens += step.uncachedInputTokens
  target.outputTokens += step.outputTokens
  target.cacheReadTokens += step.cacheReadTokens
  target.cacheWriteTokens += step.cacheWriteTokens
}

const tokensOf = (step: Pick<StepUsage, 'uncachedInputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): number =>
  step.uncachedInputTokens + step.outputTokens + step.cacheReadTokens + step.cacheWriteTokens

/** Filter steps to `[start, end)`, roll up by local day, and compute tiles. */
export function queryUsage(input: UsageQueryInput): UsageSnapshot {
  const rollups = new Map<string, UsageEvent>()
  let tokens = 0
  let requests = 0
  let outputTokens = 0
  let pricedRequests = 0
  let unpricedRequests = 0
  let estimatedCostUsd = 0
  let cacheKnownInput = 0
  let cacheKnownRead = 0
  let sawCacheCapable = false

  for (const step of input.steps) {
    if (step.time < input.start || step.time >= input.end) continue
    const day = dayKey(step.time)
    const key = rollupKey(step, day)
    const existing = rollups.get(key)
    const rollup = existing ?? emptyRollup(step, day, dayStart(step.time))
    addStep(rollup, step)
    if (existing === undefined) rollups.set(key, rollup)

    tokens += tokensOf(step)
    outputTokens += step.outputTokens
    requests += 1
    const cost = estimateCost(step, lookupPricing(input.pricing, step.provider, step.model))
    if (cost === null) unpricedRequests += 1
    else {
      pricedRequests += 1
      estimatedCostUsd += cost
    }
    if (reportsCache(step.provider, step.cacheReadTokens)) {
      sawCacheCapable = true
      cacheKnownInput += step.uncachedInputTokens + step.cacheReadTokens
      cacheKnownRead += step.cacheReadTokens
    }
  }

  const summary: UsageSummary = {
    tokens,
    requests,
    outputTokens,
    estimatedCostUsd: pricedRequests === 0 ? null : estimatedCostUsd,
    cachedInputRate: !sawCacheCapable || cacheKnownInput === 0
      ? null
      : cacheKnownRead / cacheKnownInput,
    pricedRequests,
    unpricedRequests,
  }

  const events = [...rollups.values()].sort((left, right) => {
    if (left.time !== right.time) return left.time - right.time
    if (left.provider !== right.provider) return left.provider.localeCompare(right.provider)
    if (left.model !== right.model) return left.model.localeCompare(right.model)
    return left.workspaceId.localeCompare(right.workspaceId)
  })

  return { summary, events }
}
