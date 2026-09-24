import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import { USAGE_QUERY_ENDPOINT } from '../src/client-contract.ts'
import { corpusFrom, createUsageRpcHandler, parseRawEvents, READ_BUDGET_MS } from '../src/index.ts'
import type { FoldableEvent } from '../src/fold.ts'

afterEach(() => vi.useRealTimers())

const storedEvents: readonly FoldableEvent[] = [
  {
    type: 'request/header',
    time: 1,
    data: { header: { config: { provider: 'kimi-coding', model: 'k3' } } },
  },
  {
    type: 'assistant/message',
    time: 2,
    data: { turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 1 } },
  },
]

function stubPersistence(options?: {
  readonly revisions?: ReadonlyMap<string, string>
  readonly listError?: unknown
}) {
  const list = vi.fn(async () => {
    if (options?.listError !== undefined) throw options.listError
    return [...(options?.revisions ?? new Map()).entries()].map(([id, revision]) => ({
      header: { id: SessionId(id), version: 4 as const, createdAt: 1, isSeeded: false as const },
      revision: SessionPersistenceRevision(revision),
    }))
  })
  return { list, persistence: { list } }
}

describe('corpusFrom', () => {
  it('reads live and cold logs through the public live-preferred session snapshot', async () => {
    const readSession = vi.fn(async (_id: SessionId) => ({ events: storedEvents }))
    const query = {
      listSessions: async () => [
        { header: { id: 's-live' }, live: true },
        { header: { id: 's-cold' }, live: false },
      ],
      readSession,
    }
    const live = { id: 's-live', seq: 9, header: { id: 's-live' } }
    const stub = stubPersistence()
    const corpus = corpusFrom(query, stub.persistence, {
      get: id => String(id) === 's-live' ? live : undefined,
      list: () => [live],
    })

    expect(await corpus.readEvents('s-live')).toHaveLength(2)
    const steps = await corpus.foldSession?.({
      sessionId: 's-cold',
      workspaceId: 'w1',
      workspaceTitle: 'Repo',
    })
    expect(steps).toHaveLength(1)
    expect(steps?.[0]).toMatchObject({
      provider: 'kimi-coding',
      model: 'k3',
      uncachedInputTokens: 2,
      workspaceId: 'w1',
    })
    expect(readSession.mock.calls.map(([id]) => String(id))).toEqual(['s-live', 's-cold'])
    expect(stub.list).not.toHaveBeenCalled()
  })

  it('keeps live.seq as the fold-cache revision', async () => {
    const live = { id: 's1', seq: 9, header: { id: 's1' } }
    const stub = stubPersistence({ revisions: new Map([['s1', 'persisted-r1']]) })
    const corpus = corpusFrom({
      listSessions: async () => [{ header: { id: 's1' }, live: true }],
      readSession: async () => ({ events: storedEvents }),
    }, stub.persistence, {
      get: (id: unknown) => String(id) === 's1' ? live : undefined,
      list: () => [live],
    })
    const [record] = await corpus.listSessions()
    expect(record?.revision).toBe('live:9')
  })

  it('propagates a missing session instead of folding it as zero', async () => {
    const corpus = corpusFrom({
      listSessions: async () => [{ header: { id: 's1' } }],
      readSession: async () => {
        throw new Error('no such session')
      },
    }, stubPersistence().persistence, undefined)
    await expect(corpus.readEvents('s1')).rejects.toThrow('no such session')
  })

  it('times out a hung public session read', async () => {
    vi.useFakeTimers()
    const corpus = corpusFrom({
      listSessions: async () => [{ header: { id: 's1' } }],
      readSession: async () => new Promise<{ events: readonly FoldableEvent[] }>(() => {}),
    }, stubPersistence().persistence, undefined)
    const pending = expect(corpus.readEvents('s1')).rejects.toThrow('session read timed out')
    await vi.advanceTimersByTimeAsync(READ_BUDGET_MS)
    await pending
  })

  it('times out a hung session list', async () => {
    vi.useFakeTimers()
    const corpus = corpusFrom({
      listSessions: () => new Promise<Array<{ header: { id: string } }>>(() => {}),
      readSession: async () => ({ events: storedEvents }),
    }, stubPersistence().persistence, undefined)
    const pending = expect(corpus.listSessions()).rejects.toThrow('session list timed out')
    await vi.advanceTimersByTimeAsync(READ_BUDGET_MS)
    await pending
  })

  it('maps persistence listing revisions to the fold cache', async () => {
    const stub = stubPersistence({ revisions: new Map([['s1', 'rev-7']]) })
    const corpus = corpusFrom({
      listSessions: async () => [{ header: { id: 's1' }, live: false }],
      readSession: async () => ({ events: storedEvents }),
    }, stub.persistence, undefined)
    const [record] = await corpus.listSessions()
    expect(record?.revision).toBe('rev-7')
  })

  it('reads revision-less after persistence listing failure', async () => {
    const stub = stubPersistence({ listError: new Error('encoding mismatch') })
    const corpus = corpusFrom({
      listSessions: async () => [{ header: { id: 's1' }, live: false }],
      readSession: async () => ({ events: storedEvents }),
    }, stub.persistence, undefined)
    const [record] = await corpus.listSessions()
    expect(record?.revision).toBeUndefined()
  })
})

describe('parseRawEvents', () => {
  it('keeps typed timestamped events and skips malformed records', () => {
    expect(parseRawEvents([
      JSON.stringify({ type: 'header', version: 7 }),
      '',
      'garbage',
      JSON.stringify({ type: 'assistant/chunk', time: 5, data: { chunk: { type: 'text' } } }),
      JSON.stringify({ type: 'step/start', time: 'invalid' }),
    ].join('\n'))).toEqual([
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
    const pending = handler(USAGE_QUERY_ENDPOINT, { start: 1, end: 2 }, controller.signal, {} as never)
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
    const result = await handler(USAGE_QUERY_ENDPOINT, { start: 1, end: 2 }, new AbortController().signal, {} as never)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toBe('usage query failed')
  })
})
