import { describe, expect, it, vi } from 'vitest'
import { FOLD_CACHE_LIMIT, FoldCache, collectUsage, resolveWorkspace, UNKNOWN_WORKSPACE_ID } from '../src/collect.ts'

describe('resolveWorkspace', () => {
  const workspaces = [
    { id: 'w1', title: 'Repo', path: '/home/me/repo', sessionIds: ['s1'] },
    { id: 'w2', title: 'Other', path: '/home/me/other', sessionIds: [] },
  ]

  it('prefers session membership over cwd', () => {
    expect(resolveWorkspace(workspaces, 's1', '/home/me/other')).toEqual({ id: 'w1', title: 'Repo' })
  })

  it('falls back to cwd, then unknown', () => {
    expect(resolveWorkspace(workspaces, 's9', '/home/me/other')).toEqual({ id: 'w2', title: 'Other' })
    expect(resolveWorkspace(workspaces, 's9', '/home/me/other/')).toEqual({ id: 'w2', title: 'Other' })
    expect(resolveWorkspace(workspaces, 's9', '/home/me/other/src')).toEqual({ id: 'w2', title: 'Other' })
    expect(resolveWorkspace(workspaces, 's9', '/tmp')).toEqual({
      id: UNKNOWN_WORKSPACE_ID,
      title: 'Unknown',
    })
  })

  it('prefers the longest matching workspace path', () => {
    const nested = [
      { id: 'root', title: 'Root', path: '/home/me', sessionIds: [] },
      { id: 'repo', title: 'Repo', path: '/home/me/repo/', sessionIds: [] },
    ]
    expect(resolveWorkspace(nested, 's9', '/home/me/repo/src')).toEqual({ id: 'repo', title: 'Repo' })
  })
})

describe('collectUsage', () => {
  it('folds every session and answers the requested window', async () => {
    const snapshot = await collectUsage({
      query: { start: 0, end: 10 },
      pricing: {},
      workspaces: {
        list: () => [{ id: 'w1', title: 'Repo', path: '/repo', sessionIds: ['s1'] }],
      },
      corpus: {
        listSessions: async () => [{ id: 's1', cwd: '/repo' }, { id: 's2' }],
        readEvents: async (id) => {
          if (id === 's1') {
            return [
              { type: 'request/header', time: 1, data: { header: { config: { provider: 'kimi-coding', model: 'k3' } } } },
              {
                type: 'assistant/message',
                time: 2,
                data: { turn: 1, step: 1, usage: { inputTokens: 3, outputTokens: 1 } },
              },
            ]
          }
          return []
        },
      },
    })
    expect(snapshot.summary.requests).toBe(1)
    expect(snapshot.events[0]).toMatchObject({
      provider: 'kimi-coding',
      model: 'k3',
      workspaceTitle: 'Repo',
      requests: 1,
    })
  })

  it('skips sessions created after the window and reuses a matching cache', async () => {
    const readEvents = vi.fn(async () => [] as const)
    const cache = new FoldCache()
    cache.set('s-old', 'rev-1', [{
      time: 5,
      sessionId: 's-old',
      workspaceId: 'w1',
      workspaceTitle: 'Repo',
      provider: 'kimi-coding',
      model: 'k3',
      uncachedInputTokens: 4,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }])
    const snapshot = await collectUsage({
      query: { start: 0, end: 10 },
      pricing: {},
      cache,
      workspaces: { list: () => [] },
      corpus: {
        listSessions: async () => [
          { id: 's-old', revision: 'rev-1', createdAt: 1 },
          { id: 's-future', revision: 'rev-2', createdAt: 20 },
        ],
        readEvents,
      },
    })
    expect(readEvents).not.toHaveBeenCalled()
    expect(snapshot.summary.requests).toBe(1)
    expect(snapshot.summary.tokens).toBe(5)
  })

  it('keeps going when one session log throws', async () => {
    const snapshot = await collectUsage({
      query: { start: 0, end: 10 },
      pricing: {},
      workspaces: { list: () => [] },
      corpus: {
        listSessions: async () => [{ id: 'bad' }, { id: 'ok' }],
        readEvents: async (id) => {
          if (id === 'bad') throw new Error('torn log')
          return [
            { type: 'request/header', time: 1, data: { header: { config: { provider: 'kimi-coding', model: 'k3' } } } },
            {
              type: 'assistant/message',
              time: 2,
              data: { turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 1 } },
            },
          ]
        },
      },
    })
    expect(snapshot.summary.requests).toBe(1)
    expect(snapshot.summary.tokens).toBe(3)
  })

  it('coalesces concurrent folds of the same revision', async () => {
    let reads = 0
    const cache = new FoldCache()
    const corpus = {
      listSessions: async () => [{ id: 's1', revision: 'r1' }],
      readEvents: async () => {
        reads += 1
        await Promise.resolve()
        return [
          { type: 'request/header', time: 1, data: { header: { config: { provider: 'kimi-coding', model: 'k3' } } } },
          {
            type: 'assistant/message',
            time: 2,
            data: { turn: 1, step: 1, usage: { inputTokens: 1, outputTokens: 1 } },
          },
        ]
      },
    }
    const workspaces = { list: () => [] as const }
    const query = { start: 0, end: 10 }
    const [left, right] = await Promise.all([
      collectUsage({ query, pricing: {}, cache, workspaces, corpus }),
      collectUsage({ query, pricing: {}, cache, workspaces, corpus }),
    ])
    expect(reads).toBe(1)
    expect(left.summary.requests).toBe(1)
    expect(right.summary.requests).toBe(1)
  })

  it('does not cache a failed session so a later pass can recover', async () => {
    let reads = 0
    const cache = new FoldCache()
    const corpus = {
      listSessions: async () => [{ id: 's1', revision: 'r1' }],
      readEvents: async () => {
        reads += 1
        if (reads === 1) throw new Error('timed out')
        return [
          { type: 'request/header', time: 1, data: { header: { config: { provider: 'kimi-coding', model: 'k3' } } } },
          {
            type: 'assistant/message',
            time: 2,
            data: { turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 1 } },
          },
        ]
      },
    }
    const input = { query: { start: 0, end: 10 }, pricing: {}, cache, workspaces: { list: () => [] }, corpus }
    const first = await collectUsage(input)
    const second = await collectUsage(input)
    expect(first.summary.requests).toBe(0)
    expect(reads).toBe(2)
    expect(second.summary.requests).toBe(1)
    expect(second.summary.tokens).toBe(3)
  })

  it('evicts the oldest fold when the cache is full', () => {
    const cache = new FoldCache(2)
    cache.set('a', '1', [])
    cache.set('b', '1', [])
    cache.set('c', '1', [])
    expect(cache.get('a', '1')).toBeUndefined()
    expect(cache.get('b', '1')).toEqual([])
    expect(cache.get('c', '1')).toEqual([])
  })

  it('serves a stale fold while a newer revision loads', async () => {
    const cache = new FoldCache()
    cache.set('s1', 'old', [{
      time: 5,
      sessionId: 's1',
      workspaceId: 'unknown',
      workspaceTitle: 'Unknown',
      provider: 'kimi-coding',
      model: 'k3',
      uncachedInputTokens: 4,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }])
    let finish: ((events: readonly object[]) => void) | undefined
    const corpus = {
      listSessions: async () => [{ id: 's1', revision: 'new', createdAt: 1 }],
      readEvents: async () => new Promise<readonly object[]>(resolve => {
        finish = resolve
      }),
    }
    const input = {
      query: { start: 0, end: 10 },
      pricing: {},
      cache,
      workspaces: { list: () => [] },
      corpus,
    }
    const first = await collectUsage(input as never)
    expect(first.summary.tokens).toBe(5)
    expect(finish).toBeDefined()
    finish?.([
      { type: 'request/header', time: 1, data: { header: { config: { provider: 'kimi-coding', model: 'k3' } } } },
      {
        type: 'assistant/message',
        time: 2,
        data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 1 } },
      },
    ])
    await vi.waitFor(() => {
      expect(cache.get('s1', 'new')).toBeDefined()
    })
    const second = await collectUsage(input as never)
    expect(second.summary.tokens).toBe(11)
  })

  it('keeps every fold cached for a realistic corpus across passes', async () => {
    // 600 sessions exceeds the previously shipped 512-entry cache: the LRU
    // cascaded (each miss evicted the next session in line) and every query
    // re-read the whole corpus from disk.
    const sessionCount = 600
    expect(sessionCount).toBeGreaterThan(512)
    expect(sessionCount).toBeLessThanOrEqual(FOLD_CACHE_LIMIT)
    let reads = 0
    const cache = new FoldCache()
    const corpus = {
      listSessions: async () => Array.from({ length: sessionCount }, (_, index) => ({ id: `s${index}`, revision: `r${index}` })),
      readEvents: async () => {
        reads += 1
        return [
          { type: 'request/header', time: 1, data: { header: { config: { provider: 'kimi-coding', model: 'k3' } } } },
          {
            type: 'assistant/message',
            time: 2,
            data: { turn: 1, step: 1, usage: { inputTokens: 1, outputTokens: 1 } },
          },
        ]
      },
    }
    const input = { query: { start: 0, end: 10 }, pricing: {}, cache, workspaces: { list: () => [] }, corpus }
    const first = await collectUsage(input)
    expect(first.summary.requests).toBe(sessionCount)
    expect(reads).toBe(sessionCount)
    const second = await collectUsage(input)
    expect(second.summary.requests).toBe(sessionCount)
    expect(reads).toBe(sessionCount)
  })
})
