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

export interface FoldSessionStamp {
  sessionId: string
  workspaceId: string
  workspaceTitle: string
}

export interface FoldSessionInput extends FoldSessionStamp {
  events: readonly FoldableEvent[]
}

export interface FoldRawSessionInput extends FoldSessionStamp {
  content: string
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

class SessionUsageReducer {
  private provider = UNKNOWN
  private model = UNKNOWN
  private readonly byStep = new Map<string, StepUsage>()
  private readonly order: string[] = []

  private readonly stamp: FoldSessionStamp

  constructor(stamp: FoldSessionStamp) {
    this.stamp = {
      sessionId: stamp.sessionId,
      workspaceId: stamp.workspaceId,
      workspaceTitle: stamp.workspaceTitle,
    }
  }

  accept(event: FoldableEvent): void {
    const route = routeOf(event)
    if (route !== undefined) {
      this.provider = route.provider
      this.model = route.model
    }
    const usage = usageOf(event)
    if (usage === undefined) return
    const key = stepKey(usage.turn, usage.step)
    const sample: StepUsage = {
      time: event.time,
      ...this.stamp,
      provider: this.provider,
      model: this.model,
      ...usage.buckets,
    }
    if (!this.byStep.has(key)) this.order.push(key)
    this.byStep.set(key, sample)
  }

  finish(): StepUsage[] {
    return this.order
      .map(key => this.byStep.get(key))
      .filter((sample): sample is StepUsage => sample !== undefined)
  }
}

/** Fold one session's events into per-step usage samples. */
export function foldSessionUsage(input: FoldSessionInput): StepUsage[] {
  const reducer = new SessionUsageReducer(input)
  for (const event of input.events) reducer.accept(event)
  return reducer.finish()
}

/**
 * Fold a raw JSONL session without first allocating an event array. Each line
 * is parsed and reduced before the scanner advances to the next newline.
 */
export function foldRawSessionUsage(input: FoldRawSessionInput): StepUsage[] {
  const reducer = new SessionUsageReducer(input)
  let start = 0
  while (start <= input.content.length) {
    const newline = input.content.indexOf('\n', start)
    const end = newline === -1 ? input.content.length : newline
    if (end > start) {
      const event = parseRawFoldableEvent(input.content.slice(start, end))
      if (event !== undefined) reducer.accept(event)
    }
    if (newline === -1) break
    start = newline + 1
  }
  return reducer.finish()
}

/** Parse one raw JSONL line when it can participate in usage folding. */
export function parseRawFoldableEvent(line: string): FoldableEvent | undefined {
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(record)) return undefined
  const { type, time, data } = record
  if (typeof type !== 'string' || typeof time !== 'number' || !Number.isFinite(time)) return undefined
  return { type, time, ...(data === undefined ? {} : { data }) }
}
