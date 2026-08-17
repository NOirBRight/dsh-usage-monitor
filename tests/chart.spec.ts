import { describe, expect, it } from 'vitest'
import { axisTickIndices, breakdownOf, breakdownRows, buildStackedSeries, formatBucketTooltipDate, niceMax, OTHER_SERIES_KEY, placeChartTooltip, visibleSummary } from '../src/chart.ts'
import type { UsageEvent } from '../src/client-contract.ts'

const event = (overrides: Partial<UsageEvent>): UsageEvent => ({
  time: new Date('2026-08-16T00:00:00').getTime(),
  day: '2026-08-16',
  provider: 'openai-codex',
  model: 'gpt-5.6-sol',
  workspaceId: 'w1',
  workspaceTitle: 'Repo',
  requests: 2,
  uncachedInputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 20,
  cacheWriteTokens: 0,
  ...overrides,
})

describe('breakdownOf', () => {
  it('keys model by provider so the same id on two routes stays apart', () => {
    const left = breakdownOf(event({ provider: 'openai-codex', model: 'k3' }), 'model')
    const right = breakdownOf(event({ provider: 'kimi-coding', model: 'k3' }), 'model')
    expect(left.key).not.toBe(right.key)
  })
})

describe('formatBucketTooltipDate', () => {
  it('shows a single long date for a day bucket', () => {
    expect(formatBucketTooltipDate({
      start: new Date('2026-08-10T00:00:00'),
      endExclusive: new Date('2026-08-11T00:00:00'),
    }, 'en-US')).toBe('Aug 10, 2026')
  })

  it('shows the inclusive week span for a week bucket', () => {
    expect(formatBucketTooltipDate({
      start: new Date('2026-08-10T00:00:00'),
      endExclusive: new Date('2026-08-17T00:00:00'),
    }, 'en-US')).toBe('Aug 10, 2026 – Aug 16, 2026')
  })
})

describe('buildStackedSeries', () => {
  it('stacks token totals by provider across day buckets', () => {
    const span = {
      start: new Date('2026-08-16T00:00:00'),
      end: new Date('2026-08-17T00:00:00'),
    }
    const stacked = buildStackedSeries(
      [
        event({ provider: 'openai-codex', uncachedInputTokens: 10, outputTokens: 0, cacheReadTokens: 0 }),
        event({
          time: new Date('2026-08-17T00:00:00').getTime(),
          day: '2026-08-17',
          provider: 'kimi-coding',
          uncachedInputTokens: 4,
          outputTokens: 0,
          cacheReadTokens: 0,
        }),
      ],
      span,
      'day',
      'token',
      'provider',
      'en-US',
      'Other',
    )
    expect(stacked.series.map(item => item.key)).toEqual([
      'provider:openai-codex',
      'provider:kimi-coding',
    ])
    expect(stacked.buckets).toHaveLength(2)
    expect(stacked.buckets[0]?.total).toBe(10)
    expect(stacked.buckets[1]?.total).toBe(4)
    expect(stacked.buckets[0]?.segments.map(segment => segment.value)).toEqual([10, 0])
    expect(stacked.buckets[1]?.segments.map(segment => segment.value)).toEqual([0, 4])
  })

  it('rolls leftover series into Other after the top six', () => {
    const events = Array.from({ length: 8 }, (_, index) => event({
      provider: `p${index}`,
      uncachedInputTokens: 8 - index,
      outputTokens: 0,
      cacheReadTokens: 0,
    }))
    const stacked = buildStackedSeries(
      events,
      { start: new Date('2026-08-16T00:00:00'), end: new Date('2026-08-16T00:00:00') },
      'day',
      'token',
      'provider',
      'en-US',
      'Other',
    )
    expect(stacked.series).toHaveLength(7)
    expect(stacked.series.at(-1)?.key).toBe(OTHER_SERIES_KEY)
    expect(stacked.series.at(-1)?.total).toBe(1 + 2)
  })
})

describe('niceMax', () => {
  it('rounds up to 1, 2, or 5 times a power of ten', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(3)).toBe(5)
    expect(niceMax(12)).toBe(20)
    expect(niceMax(80)).toBe(100)
  })
})

describe('axisTickIndices', () => {
  it('keeps every bucket when they already fit', () => {
    expect(axisTickIndices(7, 8)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('keeps first and last while thinning a month of days', () => {
    expect(axisTickIndices(30, 6)).toEqual([0, 6, 12, 17, 23, 29])
  })
})

describe('placeChartTooltip', () => {
  const box = { width: 250, height: 86, hostWidth: 400, hostHeight: 400 }

  it('sits to the right and above the cursor when there is room', () => {
    expect(placeChartTooltip({ ...box, cursorX: 100, cursorY: 200 })).toEqual({ left: 116, top: 98 })
  })

  it('flips to the left near the right edge', () => {
    expect(placeChartTooltip({ ...box, cursorX: 380, cursorY: 200 }).left).toBe(114)
  })

  it('flips below when the cursor is near the top', () => {
    expect(placeChartTooltip({ ...box, cursorX: 100, cursorY: 40 }).top).toBe(56)
  })

  it('stays above the cursor when the host is too short to flip', () => {
    expect(placeChartTooltip({
      ...box,
      cursorX: 100,
      cursorY: 80,
      hostHeight: 140,
    }).top).toBe(-22)
  })
})

describe('breakdownRows', () => {
  it('follows By grouping and keeps the four tile numbers', () => {
    const rows = breakdownRows(
      [
        event({ provider: 'kimi-coding', model: 'k3', uncachedInputTokens: 2, cacheReadTokens: 8, outputTokens: 1, requests: 1 }),
        event({ provider: 'kimi-coding', model: 'k3', uncachedInputTokens: 1, cacheReadTokens: 3, outputTokens: 2, requests: 1 }),
        event({ provider: 'ollama', model: 'glm-5.2', uncachedInputTokens: 4, cacheReadTokens: 0, outputTokens: 3, requests: 2 }),
      ],
      'provider',
      new Set(),
      new Set(['provider:kimi-coding', 'provider:ollama']),
      false,
    )
    expect(rows.map(row => row.key)).toEqual(['provider:kimi-coding', 'provider:ollama'])
    expect(rows[0]).toMatchObject({ tokens: 17, requests: 2, outputTokens: 3 })
    expect(rows[0]?.cachedInputRate).toBeCloseTo(11 / 14, 8)
    expect(rows[1]?.cachedInputRate).toBeNull()
  })

  it('omits a hidden series and lists each model on its own row', () => {
    const rows = breakdownRows(
      [
        event({ provider: 'kimi-coding', model: 'k3', uncachedInputTokens: 8, cacheReadTokens: 0, outputTokens: 1 }),
        event({ provider: 'openai-codex', model: 'gpt-5.6-sol', uncachedInputTokens: 2, cacheReadTokens: 0, outputTokens: 1 }),
      ],
      'model',
      new Set(['model:openai-codex:gpt-5.6-sol']),
      new Set(['model:kimi-coding:k3', 'model:openai-codex:gpt-5.6-sol']),
      false,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.label).toBe('kimi-coding / k3')
  })
})

describe('visibleSummary', () => {
  it('drops hidden series from the four tile numbers', () => {
    const events = [
      event({ provider: 'kimi-coding', uncachedInputTokens: 8, cacheReadTokens: 0, outputTokens: 1, requests: 1 }),
      event({ provider: 'openai-codex', uncachedInputTokens: 2, cacheReadTokens: 0, outputTokens: 1, requests: 1 }),
    ]
    const summary = {
      tokens: 12,
      requests: 2,
      outputTokens: 2,
      estimatedCostUsd: null,
      cachedInputRate: null,
      pricedRequests: 0,
      unpricedRequests: 2,
    }
    const visible = visibleSummary(
      events,
      summary,
      'provider',
      new Set(['provider:openai-codex']),
      new Set(['provider:kimi-coding', 'provider:openai-codex']),
      false,
    )
    expect(visible).toMatchObject({ tokens: 9, requests: 1, outputTokens: 1 })
  })
})
