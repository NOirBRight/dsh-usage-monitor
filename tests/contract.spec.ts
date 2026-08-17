import { describe, expect, it } from 'vitest'
import { decodeUsageQueryRequest, decodeUsageSnapshot } from '../src/client-contract.ts'

describe('decodeUsageQueryRequest', () => {
  it('accepts a finite window and rejects extras or inverted bounds', () => {
    expect(decodeUsageQueryRequest({ start: 1, end: 2 })).toEqual({ start: 1, end: 2 })
    expect(decodeUsageQueryRequest({ start: 2, end: 1 })).toBeUndefined()
    expect(decodeUsageQueryRequest({ start: 1, end: 2, extra: true })).toBeUndefined()
  })
})

describe('decodeUsageSnapshot', () => {
  it('round-trips a valid snapshot and rejects a broken event', () => {
    const snapshot = {
      summary: {
        tokens: 10,
        requests: 1,
        outputTokens: 1,
        estimatedCostUsd: null,
        cachedInputRate: 0.5,
        pricedRequests: 0,
        unpricedRequests: 1,
      },
      events: [{
        time: 1,
        day: '2026-08-16',
        provider: 'kimi-coding',
        model: 'k3',
        workspaceId: 'w1',
        workspaceTitle: 'Repo',
        requests: 1,
        uncachedInputTokens: 3,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }],
    }
    expect(decodeUsageSnapshot(snapshot)).toEqual(snapshot)
    expect(decodeUsageSnapshot({
      ...snapshot,
      events: [{ ...snapshot.events[0], requests: -1 }],
    })).toBeUndefined()
  })
})
