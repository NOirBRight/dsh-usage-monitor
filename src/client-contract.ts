/** Browser-safe constants and JSON decoders shared by Host and Web faces. */

/** Private Connection RPC channel used by this package's Host and Web faces. */
export const USAGE_RPC_CHANNEL = '/usage-monitor'
/** Windowed usage snapshot. */
export const USAGE_QUERY_ENDPOINT = 'usage/query'

/** Token buckets reported by one model step. */
export interface TokenBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** One calendar-day rollup of steps that share provider, model, and workspace. */
export interface UsageEvent {
  time: number
  day: string
  provider: string
  model: string
  workspaceId: string
  workspaceTitle: string
  requests: number
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Window-scoped totals shown in the summary tiles. */
export interface UsageSummary {
  tokens: number
  requests: number
  outputTokens: number
  estimatedCostUsd: number | null
  cachedInputRate: number | null
  pricedRequests: number
  unpricedRequests: number
}

/** Host reply for {@link USAGE_QUERY_ENDPOINT}. */
export interface UsageSnapshot {
  summary: UsageSummary
  events: UsageEvent[]
}

/** Client request for {@link USAGE_QUERY_ENDPOINT}. */
export interface UsageQueryRequest {
  start: number
  end: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asFinite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const asNonNegInt = (value: unknown): number | undefined => {
  const n = asFinite(value)
  return n !== undefined && Number.isInteger(n) && n >= 0 ? n : undefined
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const decodeEvent = (value: unknown): UsageEvent | undefined => {
  if (!isRecord(value)) return undefined
  const time = asFinite(value.time)
  const day = asString(value.day)
  const provider = asString(value.provider)
  const model = asString(value.model)
  const workspaceId = asString(value.workspaceId)
  const workspaceTitle = asString(value.workspaceTitle)
  const requests = asNonNegInt(value.requests)
  const uncachedInputTokens = asNonNegInt(value.uncachedInputTokens)
  const outputTokens = asNonNegInt(value.outputTokens)
  const cacheReadTokens = asNonNegInt(value.cacheReadTokens)
  const cacheWriteTokens = asNonNegInt(value.cacheWriteTokens)
  if (
    time === undefined
    || day === undefined
    || provider === undefined
    || model === undefined
    || workspaceId === undefined
    || workspaceTitle === undefined
    || requests === undefined
    || uncachedInputTokens === undefined
    || outputTokens === undefined
    || cacheReadTokens === undefined
    || cacheWriteTokens === undefined
  ) return undefined
  return {
    time,
    day,
    provider,
    model,
    workspaceId,
    workspaceTitle,
    requests,
    uncachedInputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  }
}

const decodeSummary = (value: unknown): UsageSummary | undefined => {
  if (!isRecord(value)) return undefined
  const tokens = asNonNegInt(value.tokens)
  const requests = asNonNegInt(value.requests)
  const outputTokens = asNonNegInt(value.outputTokens)
  const pricedRequests = asNonNegInt(value.pricedRequests)
  const unpricedRequests = asNonNegInt(value.unpricedRequests)
  const estimatedCostUsd = value.estimatedCostUsd === null
    ? null
    : asFinite(value.estimatedCostUsd)
  const cachedInputRate = value.cachedInputRate === null
    ? null
    : asFinite(value.cachedInputRate)
  if (
    tokens === undefined
    || requests === undefined
    || outputTokens === undefined
    || pricedRequests === undefined
    || unpricedRequests === undefined
    || estimatedCostUsd === undefined
    || cachedInputRate === undefined
  ) return undefined
  return { tokens, requests, outputTokens, estimatedCostUsd, cachedInputRate, pricedRequests, unpricedRequests }
}

/** Decode a client query payload. Extra fields are rejected. */
export function decodeUsageQueryRequest(value: unknown): UsageQueryRequest | undefined {
  if (!isRecord(value)) return undefined
  const keys = Object.keys(value)
  if (keys.some(key => key !== 'start' && key !== 'end')) return undefined
  const start = asFinite(value.start)
  const end = asFinite(value.end)
  if (start === undefined || end === undefined || end < start) return undefined
  return { start, end }
}

/** Decode a Host usage snapshot. */
export function decodeUsageSnapshot(value: unknown): UsageSnapshot | undefined {
  if (!isRecord(value)) return undefined
  const summary = decodeSummary(value.summary)
  if (summary === undefined || !Array.isArray(value.events)) return undefined
  const events: UsageEvent[] = []
  for (const item of value.events) {
    const event = decodeEvent(item)
    if (event === undefined) return undefined
    events.push(event)
  }
  return { summary, events }
}
