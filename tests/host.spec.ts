import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { USAGE_QUERY_ENDPOINT } from '../src/client-contract.ts'
import { corpusFrom, createUsageRpcHandler, parseRawEvents, READ_BUDGET_MS } from '../src/index.ts'

const usageHeader = {
  type: 'request/header',
  time: 1,
  data: { header: { config: { provider: 'kimi-coding', model: 'k3' } } },
}
const usageMessage = {
  type: 'assistant/message',
  time: 2,
  data: { turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 1 } },
}

afterEach(() => {
  vi.useRealTimers()
})

describe('corpusFrom', () => {
  it('prefers readFrom over inspect', async () => {
    const inspect = vi.fn(async () => {
      throw new Error('should not inspect')
    })
    const corpus = corpusFrom(
      { listSessions: async () => [{ header: { id: 's1' } }] },
      {
        listSnapshots: async () => [],
        readFrom: async () => ({ events: [usageHeader, usageMessage] }),
        inspect,
      },
      undefined,
    )
    const events = await corpus.readEvents('s1')
    expect(events).toHaveLength(2)
    expect(inspect).not.toHaveBeenCalled()
  })

  it('falls back to inspect when readFrom is missing', async () => {
    const corpus = corpusFrom(
      { listSessions: async () => [{ header: { id: 's1' } }] },
      {
        listSnapshots: async () => [],
        inspect: async () => ({ events: [usageHeader, usageMessage] }),
      },
      undefined,
    )
    expect(await corpus.readEvents('s1')).toHaveLength(2)
  })

  it('times out a hung persisted read', async () => {
    vi.useFakeTimers()
    const corpus = corpusFrom(
      { listSessions: async () => [{ header: { id: 's1' } }] },
      {
        listSnapshots: async () => [],
        readFrom: (_id, _from, signal) => new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
      },
      undefined,
    )
    const pending = expect(corpus.readEvents('s1')).rejects.toThrow('session read timed out')
    await vi.advanceTimersByTimeAsync(READ_BUDGET_MS)
    await pending
  })

  it('times out a hung session list', async () => {
    vi.useFakeTimers()
    const corpus = corpusFrom(
      {
        listSessions: (_signal) => new Promise(() => undefined),
      },
      {
        listSnapshots: async () => [],
      },
      undefined,
    )
    const pending = expect(corpus.listSessions()).rejects.toThrow('session list timed out')
    await vi.advanceTimersByTimeAsync(READ_BUDGET_MS)
    await pending
  })

  it('folds sessions the validator refuses via the raw artifact path', async () => {
    const readFrom = vi.fn(async () => {
      throw new Error('unknown event type')
    })
    const raw = [
      JSON.stringify({ type: 'header', version: 7, id: 's1', createdAt: 1 }),
      'not json at all',
      JSON.stringify({ type: 'request/header', time: 1, data: { header: { config: { provider: 'kimi-coding', model: 'k3' } } } }),
      JSON.stringify({ type: 'assistant/message', time: 2, data: { turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 1 } } }),
    ].join('\n')
    const corpus = corpusFrom(
      { listSessions: async () => [{ header: { id: 's1' } }] },
      {
        listSnapshots: async () => [],
        readRaw: async () => ({ content: raw }),
        readFrom,
      },
      undefined,
    )
    const events = await corpus.readEvents('s1')
    expect(events).toHaveLength(2)
    expect(readFrom).not.toHaveBeenCalled()
  })

  it('feeds raw JSONL directly to the fold without materializing a full event array', async () => {
    const readFrom = vi.fn(async () => {
      throw new Error('should not validate or materialize raw events')
    })
    const content = [
      JSON.stringify({ type: 'header', version: 7, id: 's1', createdAt: 1 }),
      'invalid',
      JSON.stringify(usageHeader),
      JSON.stringify(usageMessage),
    ].join('\n')
    const corpus = corpusFrom(
      { listSessions: async () => [{ header: { id: 's1' } }] },
      { listSnapshots: async () => [], readRaw: async () => ({ content }), readFrom },
      undefined,
    )

    const steps = await corpus.foldSession?.({
      sessionId: 's1',
      workspaceId: 'w1',
      workspaceTitle: 'Repo',
    })
    expect(steps).toHaveLength(1)
    expect(steps?.[0]).toMatchObject({ provider: 'kimi-coding', model: 'k3', uncachedInputTokens: 2 })
    expect(readFrom).not.toHaveBeenCalled()
  })

  it('falls back to readFrom when no raw artifact exists', async () => {
    const corpus = corpusFrom(
      { listSessions: async () => [{ header: { id: 's1' } }] },
      {
        listSnapshots: async () => [],
        readRaw: async () => undefined,
        readFrom: async () => ({ events: [usageHeader, usageMessage] }),
      },
      undefined,
    )
    expect(await corpus.readEvents('s1')).toHaveLength(2)
  })

  it('recovers cache revisions by stat when snapshot listing fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'um-spec-'))
    try {
      const artifact = join(dir, 'session.jsonl.zstd')
      await writeFile(artifact, 'stub')
      const corpus = corpusFrom(
        { listSessions: async () => [{ header: { id: 's1', cwd: '/repo' } }] },
        {
          listSnapshots: async () => {
            throw new Error('encoding mismatch')
          },
          locate: meta => ({ path: join(dir, `session-${String(meta.id)}.jsonl.zstd`) }),
        },
        undefined,
      )
      await writeFile(join(dir, 'session-s1.jsonl.zstd'), 'stub')
      const [record] = await corpus.listSessions()
      expect(record.revision).toMatch(/^\d+:\d+$/u)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('parseRawEvents', () => {
  it('keeps typed timestamped records and skips everything else', () => {
    const events = parseRawEvents([
      JSON.stringify({ type: 'header', version: 7 }),
      '',
      'garbage',
      JSON.stringify({ type: 'assistant/chunk', time: 5, data: { chunk: { type: 'text' } } }),
      JSON.stringify({ type: 'step/start', time: 'not-a-number' }),
    ].join('\n'))
    expect(events).toEqual([
      { type: 'assistant/chunk', time: 5, data: { chunk: { type: 'text' } } },
    ])
  })
})

describe('createUsageRpcHandler', () => {
  const empty = {
    summary: {
      tokens: 0,
      requests: 0,
      outputTokens: 0,
      estimatedCostUsd: null,
      cachedInputRate: null,
      pricedRequests: 0,
      unpricedRequests: 0,
    },
    events: [],
  }

  it('cancels when the client aborts', async () => {
    const controller = new AbortController()
    let release: (() => void) | undefined
    const handler = createUsageRpcHandler({
      collect: () => new Promise(resolve => {
        release = () => resolve(empty)
      }),
    })
    const pending = handler(USAGE_QUERY_ENDPOINT, { start: 1, end: 2 }, controller.signal)
    controller.abort()
    const result = await pending
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toBe('usage query cancelled')
    release?.()
  })

  it('does not leak host error paths to the client', async () => {
    const handler = createUsageRpcHandler({
      collect: async () => {
        throw new Error('/home/secret/session.jsonl.zstd failed')
      },
    })
    const result = await handler(USAGE_QUERY_ENDPOINT, { start: 1, end: 2 }, new AbortController().signal)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toBe('usage query failed')
  })
})
