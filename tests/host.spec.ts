import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import { USAGE_QUERY_ENDPOINT } from '../src/client-contract.ts'
import { corpusFrom, createUsageRpcHandler, parseRawEvents, READ_BUDGET_MS } from '../src/index.ts'
import type { FoldableEvent } from '../src/fold.ts'

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
  const storedEvents = [usageHeader, usageMessage] as unknown as SessionEvent[]

  function stubPersistence(events: readonly SessionEvent[], options?: {
    readonly openError?: unknown
    readonly readError?: unknown
    readonly revisions?: ReadonlyMap<string, string>
    readonly listError?: unknown
  }) {
    const opened: Array<{ id: string, access: string }> = []
    const closed: string[] = []
    return {
      opened,
      closed,
      persistence: {
        open: async (id: ReturnType<typeof SessionId>, access: 'read') => {
          opened.push({ id: String(id), access })
          if (options?.openError !== undefined) throw options.openError
          const handle = {
            read: async () => {
              if (options?.readError !== undefined) throw options.readError
              return { eventState: 'detached' as const, events }
            },
            close: async () => {
              closed.push(String(id))
            },
          }
          return handle as unknown as SessionHandle
        },
        stat: async () => undefined,
        list: async () => {
          if (options?.listError !== undefined) throw options.listError
          return [...(options?.revisions ?? new Map()).entries()].map(([id, revision]) => ({
            header: { id: SessionId(id), version: 3 as const, createdAt: 1, isSeeded: false as const },
            revision: SessionPersistenceRevision(revision),
          }))
        },
      },
    }
  }

  const sessions = { listSessions: async () => [{ header: { id: 's1' } }] }

  it('reads persisted events through a read handle and always closes it', async () => {
    const stub = stubPersistence(storedEvents)
    const corpus = corpusFrom(sessions, stub.persistence, undefined)
    expect(await corpus.readEvents('s1')).toHaveLength(2)
    expect(stub.opened).toEqual([{ id: 's1', access: 'read' }])
    expect(stub.closed).toEqual(['s1'])
  })

  it('prefers the live snapshot and never opens persistence for it', async () => {
    const live = { id: 's1', seq: 9, header: { id: 's1' }, snapshotEvents: () => [usageHeader] as readonly FoldableEvent[] }
    const stub = stubPersistence(storedEvents)
    const corpus = corpusFrom(sessions, stub.persistence, { get: (id: unknown) => String(id) === 's1' ? live : undefined, list: () => [live] })
    expect(await corpus.readEvents('s1')).toHaveLength(1)
    expect(stub.opened).toEqual([])
  })

  it('lets a missing session propagate instead of folding it as zero', async () => {
    const stub = stubPersistence(storedEvents, { openError: Object.assign(new Error('no such session'), { name: 'SessionPersistenceNotFoundError' }) })
    const corpus = corpusFrom(sessions, stub.persistence, undefined)
    await expect(corpus.readEvents('s1')).rejects.toThrow('no such session')
  })

  it('closes the handle when the read fails and never caches the failure as empty', async () => {
    const stub = stubPersistence(storedEvents, { readError: new Error('unknown event type') })
    const corpus = corpusFrom(sessions, stub.persistence, undefined)
    await expect(corpus.readEvents('s1')).rejects.toThrow('unknown event type')
    expect(stub.closed).toEqual(['s1'])
    await expect(corpus.foldSession?.({ sessionId: 's1', workspaceId: 'w1', workspaceTitle: 'Repo' })).rejects.toThrow('unknown event type')
    expect(stub.closed).toEqual(['s1', 's1'])
  })

  it('folds handle events without a raw-artifact path', async () => {
    const stub = stubPersistence(storedEvents)
    const corpus = corpusFrom(sessions, stub.persistence, undefined)
    const steps = await corpus.foldSession?.({ sessionId: 's1', workspaceId: 'w1', workspaceTitle: 'Repo' })
    expect(steps).toHaveLength(1)
    expect(steps?.[0]).toMatchObject({ provider: 'kimi-coding', model: 'k3', uncachedInputTokens: 2 })
    expect(stub.closed).toEqual(['s1'])
  })

  it('times out a hung persisted read', async () => {
    vi.useFakeTimers()
    const corpus = corpusFrom(
      sessions,
      {
        open: (_id, _access, options) => new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
        stat: async () => undefined,
        list: async () => [],
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
      stubPersistence(storedEvents).persistence,
      undefined,
    )
    const pending = expect(corpus.listSessions()).rejects.toThrow('session list timed out')
    await vi.advanceTimersByTimeAsync(READ_BUDGET_MS)
    await pending
  })

  it('maps listing revisions to the fold cache', async () => {
    const stub = stubPersistence(storedEvents, { revisions: new Map([['s1', 'rev-7']]) })
    const corpus = corpusFrom(sessions, stub.persistence, undefined)
    const [record] = await corpus.listSessions()
    expect(record?.revision).toBe('rev-7')
  })

  it('reads revision-less on listing failure instead of a stale revision', async () => {
    const stub = stubPersistence(storedEvents, { listError: new Error('encoding mismatch') })
    const corpus = corpusFrom(sessions, stub.persistence, undefined)
    const [record] = await corpus.listSessions()
    expect(record?.revision).toBeUndefined()
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
