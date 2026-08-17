/**
 * Client-side stacked aggregation: Metric × By × Group over daily rollups.
 */

import type { UsageEvent, UsageSummary } from './client-contract.ts'

export type UsageMetric = 'token' | 'request'
export type UsageBreakdown = 'provider' | 'model' | 'workspace'
export type UsageGroup = 'day' | 'week'

export interface DateSpan {
  start: Date
  end: Date
}

export interface StackSegment {
  key: string
  label: string
  value: number
}

export interface StackBucket {
  start: Date
  endExclusive: Date
  label: string
  segments: StackSegment[]
  total: number
}

export interface StackSeries {
  key: string
  label: string
  total: number
  color: string
}

export const OTHER_SERIES_KEY = 'other'
const TOP_SERIES = 6

export const SERIES_COLORS = [
  '#3941ff',
  '#00a8a8',
  '#7c3aed',
  '#0ea5e9',
  '#b1a7ff',
  '#10b981',
] as const

export const OTHER_SERIES_COLOR = '#cbd5e1'

const startOfDay = (date: Date): Date => {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

const startOfWeekMonday = (date: Date): Date => {
  const start = startOfDay(date)
  const weekday = start.getDay()
  const offset = weekday === 0 ? -6 : 1 - weekday
  return addDays(start, offset)
}

const differenceInDays = (start: Date, end: Date): number =>
  Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000)

const tokensOf = (event: UsageEvent): number =>
  event.uncachedInputTokens + event.outputTokens + event.cacheReadTokens + event.cacheWriteTokens

const segmentHidden = (
  key: string,
  hidden: ReadonlySet<string>,
  topKeys: ReadonlySet<string>,
  hideOther: boolean,
): boolean => (topKeys.has(key) ? hidden.has(key) : hideOther)

const metricValue = (event: UsageEvent, metric: UsageMetric): number =>
  metric === 'request' ? event.requests : tokensOf(event)

export function breakdownOf(
  event: UsageEvent,
  breakdown: UsageBreakdown,
): { key: string, label: string } {
  if (breakdown === 'model') {
    return {
      key: `model:${event.provider}:${event.model}`,
      label: `${event.provider} / ${event.model}`,
    }
  }
  if (breakdown === 'workspace') {
    return {
      key: `workspace:${event.workspaceId}`,
      label: event.workspaceTitle,
    }
  }
  return {
    key: `provider:${event.provider}`,
    label: event.provider,
  }
}

export function bucketSpecs(span: DateSpan, group: UsageGroup, locale: string): Array<{
  start: Date
  endExclusive: Date
  label: string
}> {
  const start = startOfDay(span.start)
  const end = startOfDay(span.end)
  const formatter = new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' })
  if (group === 'day') {
    const count = Math.max(1, differenceInDays(start, end) + 1)
    return Array.from({ length: count }, (_, offset) => {
      const bucketStart = addDays(start, offset)
      return {
        start: bucketStart,
        endExclusive: addDays(bucketStart, 1),
        label: formatter.format(bucketStart),
      }
    })
  }
  const first = startOfWeekMonday(start)
  const last = startOfWeekMonday(end)
  const buckets: Array<{ start: Date, endExclusive: Date, label: string }> = []
  for (let cursor = first; cursor.getTime() <= last.getTime(); cursor = addDays(cursor, 7)) {
    const endExclusive = addDays(cursor, 7)
    buckets.push({
      start: cursor,
      endExclusive,
      label: `${formatter.format(cursor)}–${formatter.format(addDays(endExclusive, -1))}`,
    })
  }
  return buckets
}

export function formatBucketTooltipDate(
  bucket: Pick<StackBucket, 'start' | 'endExclusive'>,
  locale: string,
): string {
  const endInclusive = addDays(bucket.endExclusive, -1)
  const formatLong = (date: Date): string => new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
  if (startOfDay(bucket.start).getTime() === startOfDay(endInclusive).getTime()) {
    return formatLong(bucket.start)
  }
  return `${formatLong(bucket.start)} – ${formatLong(endInclusive)}`
}

export function buildStackedSeries(
  events: readonly UsageEvent[],
  span: DateSpan,
  group: UsageGroup,
  metric: UsageMetric,
  breakdown: UsageBreakdown,
  locale: string,
  otherLabel: string,
): { buckets: StackBucket[], series: StackSeries[], hasData: boolean } {
  const specs = bucketSpecs(span, group, locale)
  const raw = specs.map(spec => ({ ...spec, totals: new Map<string, number>() }))
  const labels = new Map<string, string>()
  const seriesTotals = new Map<string, number>()

  for (const event of events) {
    const value = metricValue(event, metric)
    if (value <= 0) continue
    const bucket = raw.find(candidate =>
      event.time >= candidate.start.getTime() && event.time < candidate.endExclusive.getTime())
    if (bucket === undefined) continue
    const segment = breakdownOf(event, breakdown)
    labels.set(segment.key, segment.label)
    bucket.totals.set(segment.key, (bucket.totals.get(segment.key) ?? 0) + value)
    seriesTotals.set(segment.key, (seriesTotals.get(segment.key) ?? 0) + value)
  }

  const ranked = [...seriesTotals.entries()].sort((left, right) => right[1] - left[1])
  const topKeys = ranked.slice(0, TOP_SERIES).map(([key]) => key)
  const topSet = new Set(topKeys)
  const hasOther = ranked.length > TOP_SERIES

  const colorAt = (index: number): string => SERIES_COLORS[index] ?? OTHER_SERIES_COLOR
  const series: StackSeries[] = topKeys.map((key, index) => ({
    key,
    label: labels.get(key) ?? key,
    total: seriesTotals.get(key) ?? 0,
    color: colorAt(index),
  }))
  if (hasOther) {
    const otherTotal = ranked.slice(TOP_SERIES).reduce((sum, [, value]) => sum + value, 0)
    series.push({
      key: OTHER_SERIES_KEY,
      label: otherLabel,
      total: otherTotal,
      color: OTHER_SERIES_COLOR,
    })
  }

  const buckets: StackBucket[] = raw.map(spec => {
    const segments: StackSegment[] = []
    let otherValue = 0
    for (const [key, value] of spec.totals) {
      if (topSet.has(key)) {
        segments.push({ key, label: labels.get(key) ?? key, value })
      } else {
        otherValue += value
      }
    }
    if (hasOther && otherValue > 0) {
      segments.push({ key: OTHER_SERIES_KEY, label: otherLabel, value: otherValue })
    }
    const ordered = series.map(item =>
      segments.find(segment => segment.key === item.key)
      ?? { key: item.key, label: item.label, value: 0 },
    )
    return {
      start: spec.start,
      endExclusive: spec.endExclusive,
      label: spec.label,
      segments: ordered,
      total: ordered.reduce((sum, segment) => sum + segment.value, 0),
    }
  })

  return {
    buckets,
    series,
    hasData: series.some(item => item.total > 0),
  }
}

export function visibleSummary(
  events: readonly UsageEvent[],
  summary: UsageSummary,
  breakdown: UsageBreakdown,
  hidden: ReadonlySet<string>,
  topKeys: ReadonlySet<string>,
  hideOther: boolean,
): UsageSummary {
  if (hidden.size === 0) return summary
  let tokens = 0
  let requests = 0
  let outputTokens = 0
  let cacheKnownInput = 0
  let cacheKnownRead = 0
  let sawCache = false

  for (const event of events) {
    const segment = breakdownOf(event, breakdown)
    if (segmentHidden(segment.key, hidden, topKeys, hideOther)) continue
    tokens += tokensOf(event)
    outputTokens += event.outputTokens
    requests += event.requests
    if (event.cacheReadTokens > 0 || event.uncachedInputTokens > 0) {
      sawCache = sawCache || event.cacheReadTokens > 0
      cacheKnownInput += event.uncachedInputTokens + event.cacheReadTokens
      cacheKnownRead += event.cacheReadTokens
    }
  }

  const costScale = summary.tokens === 0 ? 0 : tokens / summary.tokens
  return {
    tokens,
    requests,
    outputTokens,
    estimatedCostUsd: summary.estimatedCostUsd === null
      ? null
      : summary.estimatedCostUsd * costScale,
    cachedInputRate: !sawCache || cacheKnownInput === 0
      ? null
      : cacheKnownRead / cacheKnownInput,
    pricedRequests: summary.pricedRequests,
    unpricedRequests: summary.unpricedRequests,
  }
}

export interface BreakdownRow {
  key: string
  label: string
  tokens: number
  requests: number
  outputTokens: number
  cachedInputRate: number | null
}

/** One row per By-group, same four numbers as the summary tiles. */
export function breakdownRows(
  events: readonly UsageEvent[],
  breakdown: UsageBreakdown,
  hidden: ReadonlySet<string>,
  topKeys: ReadonlySet<string>,
  hideOther: boolean,
): BreakdownRow[] {
  const rows = new Map<string, {
    label: string
    tokens: number
    requests: number
    outputTokens: number
    cacheKnownInput: number
    cacheKnownRead: number
    sawCache: boolean
  }>()

  for (const event of events) {
    const segment = breakdownOf(event, breakdown)
    if (segmentHidden(segment.key, hidden, topKeys, hideOther)) continue
    const row = rows.get(segment.key) ?? {
      label: segment.label,
      tokens: 0,
      requests: 0,
      outputTokens: 0,
      cacheKnownInput: 0,
      cacheKnownRead: 0,
      sawCache: false,
    }
    row.tokens += tokensOf(event)
    row.requests += event.requests
    row.outputTokens += event.outputTokens
    if (event.cacheReadTokens > 0 || event.uncachedInputTokens > 0) {
      row.sawCache = row.sawCache || event.cacheReadTokens > 0
      row.cacheKnownInput += event.uncachedInputTokens + event.cacheReadTokens
      row.cacheKnownRead += event.cacheReadTokens
    }
    rows.set(segment.key, row)
  }

  return [...rows.entries()]
    .map(([key, row]) => ({
      key,
      label: row.label,
      tokens: row.tokens,
      requests: row.requests,
      outputTokens: row.outputTokens,
      cachedInputRate: !row.sawCache || row.cacheKnownInput === 0
        ? null
        : row.cacheKnownRead / row.cacheKnownInput,
    }))
    .sort((left, right) => right.tokens - left.tokens || left.label.localeCompare(right.label))
}

/** Round a chart max up to 1 / 2 / 5 × 10^n so the Y-axis stays readable. */
export function niceMax(value: number): number {
  if (value <= 1) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return nice * magnitude
}

/** Evenly spaced x-axis ticks, always including first and last. */
export function axisTickIndices(count: number, maxTicks: number): number[] {
  if (count <= 0) return []
  const ticks = Math.min(count, Math.max(2, Math.floor(maxTicks)))
  if (count <= ticks) return Array.from({ length: count }, (_, index) => index)
  const indices: number[] = []
  for (let step = 0; step < ticks; step += 1) {
    const index = Math.round((step * (count - 1)) / (ticks - 1))
    if (indices.at(-1) !== index) indices.push(index)
  }
  return indices
}

/** CodexHub stacked-chart tooltip: follow the cursor, prefer above, flip at edges. */
export const CHART_TOOLTIP_GAP = 16
export const CHART_TOOLTIP_EDGE = 12

export function placeChartTooltip(input: {
  cursorX: number
  cursorY: number
  height: number
  hostHeight: number
  hostWidth: number
  width: number
}): { left: number, top: number } {
  const { cursorX, cursorY, height, hostHeight, hostWidth, width } = input
  const onLeft = cursorX + width + CHART_TOOLTIP_GAP + 8 > hostWidth
  const unclampedLeft = onLeft
    ? cursorX - width - CHART_TOOLTIP_GAP
    : cursorX + CHART_TOOLTIP_GAP
  const left = Math.min(
    Math.max(CHART_TOOLTIP_EDGE, unclampedLeft),
    Math.max(CHART_TOOLTIP_EDGE, hostWidth - width - CHART_TOOLTIP_EDGE),
  )
  const above = cursorY - height - CHART_TOOLTIP_GAP
  if (above >= CHART_TOOLTIP_EDGE) return { left, top: above }
  const below = Math.min(
    cursorY + CHART_TOOLTIP_GAP,
    Math.max(CHART_TOOLTIP_EDGE, hostHeight - height - CHART_TOOLTIP_EDGE),
  )
  const flippedBelowCursor = below >= cursorY + CHART_TOOLTIP_GAP - 0.5
  return { left, top: flippedBelowCursor ? below : above }
}
