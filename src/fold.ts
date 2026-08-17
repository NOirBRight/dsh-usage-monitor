/**
 * Fold a session log into per-step usage samples.
 * Same turn/step replaces the earlier sample instead of double-counting.
 */

import type { TokenBuckets } from './client-contract.ts'

/** Minimal session-log event the fold understands. */
export interface FoldableEvent {
  type: string
  time: number
  data?: unknown
}

/** One model step's usage, stamped with routing and workspace. */
export interface StepUsage {
  time: number
  sessionId: string
  workspaceId: string
  workspaceTitle: string
  provider: string
  model: string
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface FoldSessionInput {
  sessionId: string
  workspaceId: string
  workspaceTitle: string
  events: readonly FoldableEvent[]
}

const UNKNOWN = 'unknown'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) ? value : undefined

const asNonNegInt = (value: unknown): number | undefined => {
  const n = asInt(value)
  return n !== undefined && n >= 0 ? n : undefined
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const bucketsFrom = (usage: Record<string, unknown>): TokenBuckets | undefined => {
  const inputTokens = asNonNegInt(usage.inputTokens)
  const outputTokens = asNonNegInt(usage.outputTokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  return {
    uncachedInputTokens: inputTokens,
    outputTokens,
    cacheReadTokens: asNonNegInt(usage.cacheReadTokens) ?? 0,
    cacheWriteTokens: asNonNegInt(usage.cacheWriteTokens) ?? 0,
  }
}

const usageOf = (event: FoldableEvent): { turn: number, step: number, buckets: TokenBuckets } | undefined => {
  if (!isRecord(event.data)) return undefined
  const turn = asInt(event.data.turn)
  const step = asInt(event.data.step)
  if (turn === undefined || step === undefined) return undefined
  if (event.type === 'assistant/chunk') {
    const chunk = event.data.chunk
    if (!isRecord(chunk) || chunk.type !== 'usage' || !isRecord(chunk.usage)) return undefined
    const buckets = bucketsFrom(chunk.usage)
    return buckets === undefined ? undefined : { turn, step, buckets }
  }
  if (event.type === 'assistant/message') {
    if (!isRecord(event.data.usage)) return undefined
    const buckets = bucketsFrom(event.data.usage)
    return buckets === undefined ? undefined : { turn, step, buckets }
  }
  return undefined
}

const routeOf = (event: FoldableEvent): { provider: string, model: string } | undefined => {
  if (!isRecord(event.data)) return undefined
  if (event.type === 'request/header') {
    const header = event.data.header
    if (!isRecord(header) || !isRecord(header.config)) return undefined
    const provider = asString(header.config.provider)
    const model = asString(header.config.model)
    if (provider === undefined || model === undefined) return undefined
    return { provider, model }
  }
  if (event.type === 'request/context') {
    const provider = asString(event.data.provider)
    const model = asString(event.data.model)
    if (provider === undefined || model === undefined) return undefined
    return { provider, model }
  }
  return undefined
}

const stepKey = (turn: number, step: number): string => `${turn}:${step}`

/** Fold one session's events into per-step usage samples. */
export function foldSessionUsage(input: FoldSessionInput): StepUsage[] {
  let provider = UNKNOWN
  let model = UNKNOWN
  const byStep = new Map<string, StepUsage>()
  const order: string[] = []

  for (const event of input.events) {
    const route = routeOf(event)
    if (route !== undefined) {
      provider = route.provider
      model = route.model
    }
    const usage = usageOf(event)
    if (usage === undefined) continue
    const key = stepKey(usage.turn, usage.step)
    const sample: StepUsage = {
      time: event.time,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      workspaceTitle: input.workspaceTitle,
      provider,
      model,
      ...usage.buckets,
    }
    if (!byStep.has(key)) order.push(key)
    byStep.set(key, sample)
  }

  return order.map(key => byStep.get(key)).filter((sample): sample is StepUsage => sample !== undefined)
}
