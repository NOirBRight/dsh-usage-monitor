import { describe, expect, it } from 'vitest'
import type { StepUsage } from '../src/fold.ts'
import { queryUsage } from '../src/query.ts'

const day = (iso: string): number => new Date(iso).getTime()

const step = (overrides: Partial<StepUsage> & Pick<StepUsage, 'time'>): StepUsage => ({
  sessionId: 's1',
  workspaceId: 'w1',
  workspaceTitle: 'Repo',
  provider: 'deepseek',
  model: 'deepseek-chat',
  uncachedInputTokens: 1_000_000,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...overrides,
})

const pricing = {
  'deepseek/deepseek-chat': {
    inputPerMillion: 1,
    outputPerMillion: 2,
    cachedInputPerMillion: 0.1,
  },
}

describe('queryUsage', () => {
  it('keeps steps inside [start, end) and rolls them up by local day', () => {
    const snapshot = queryUsage({
      start: day('2026-08-16T00:00:00'),
      end: day('2026-08-17T00:00:00'),
      pricing,
      steps: [
        step({ time: day('2026-08-15T23:00:00'), uncachedInputTokens: 9 }),
        step({ time: day('2026-08-16T10:00:00'), uncachedInputTokens: 1_000_000 }),
        step({ time: day('2026-08-16T18:00:00'), uncachedInputTokens: 1_000_000, outputTokens: 500_000 }),
        step({ time: day('2026-08-17T00:00:00'), uncachedInputTokens: 9 }),
      ],
    })
    expect(snapshot.events).toHaveLength(1)
    expect(snapshot.events[0]).toMatchObject({
      requests: 2,
      uncachedInputTokens: 2_000_000,
      outputTokens: 500_000,
    })
    expect(snapshot.summary.requests).toBe(2)
    expect(snapshot.summary.tokens).toBe(2_500_000)
    expect(snapshot.summary.outputTokens).toBe(500_000)
    expect(snapshot.summary.estimatedCostUsd).toBeCloseTo(3, 8)
  })

  it('leaves cost and cache rate unknown when nothing can be priced or cached', () => {
    const snapshot = queryUsage({
      start: 0,
      end: 10,
      pricing: {},
      steps: [
        step({
          time: 1,
          provider: 'ollama',
          model: 'glm-5.2',
          uncachedInputTokens: 10,
          outputTokens: 2,
        }),
      ],
    })
    expect(snapshot.summary.estimatedCostUsd).toBeNull()
    expect(snapshot.summary.cachedInputRate).toBeNull()
    expect(snapshot.summary.unpricedRequests).toBe(1)
  })

  it('reports cache hit rate only for cache-capable providers', () => {
    const snapshot = queryUsage({
      start: 0,
      end: 10,
      pricing: {},
      steps: [
        step({
          time: 1,
          provider: 'openai-codex',
          model: 'gpt-5.6-sol',
          uncachedInputTokens: 25,
          cacheReadTokens: 75,
        }),
        step({
          time: 2,
          provider: 'ollama-cloud',
          model: 'deepseek-v4-pro',
          uncachedInputTokens: 100,
          cacheReadTokens: 0,
        }),
      ],
    })
    expect(snapshot.summary.cachedInputRate).toBeCloseTo(0.75, 8)
  })
})
