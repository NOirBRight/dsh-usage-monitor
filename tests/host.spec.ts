import { afterEach, describe, expect, it, vi } from 'vitest'
import { USAGE_QUERY_ENDPOINT } from '../src/client-contract.ts'
import { corpusFrom, createUsageRpcHandler, READ_BUDGET_MS } from '../src/index.ts'

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
