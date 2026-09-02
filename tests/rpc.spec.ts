import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, resolveConfig } from '@deepseek-ai/cordis'
import { USAGE_QUERY_ENDPOINT, USAGE_RPC_CHANNEL } from '../src/client-contract.ts'
import { Config, apply, createUsageRpcHandler, inject } from '../src/index.ts'

type Handler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<{ ok: boolean, value?: unknown, error?: { message: string } }>

const tempDirs: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function useTempDshHome(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'usage-rpc-'))
  tempDirs.push(dir)
  vi.stubEnv('DSH_HOME', dir)
}

describe('usage-monitor RPC', () => {
  it('registers /usage-monitor as a loopback channel', async () => {
    await useTempDshHome()
    const ctx = new Context()
    const handle = vi.fn((_channel: string, _handler: Handler) =>
      () => Promise.resolve())
    ctx.provide('sessionQuery', {
      listSessions: async () => [],
    } as never)
    ctx.provide('sessionPersistence', {
      listSnapshots: async () => [],
      readFrom: async () => ({ events: [] }),
      inspect: async () => ({ events: [] }),
    } as never)
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    ctx.provide('connection', { rpc: { handle } } as never)
    const fiber = ctx.plugin({ inject: [...inject], Config, apply }, {})
    await fiber.await()
    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle.mock.calls[0]?.[0]).toBe(USAGE_RPC_CHANNEL)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('defaults projection work to on-demand, one reader, and eight sessions per transaction', () => {
    expect(resolveConfig({ Config, apply } as never, {})).toEqual({
      projectionWarmup: 'on-demand',
      projectionReadConcurrency: 1,
      projectionTransactionBatchSize: 8,
    })
  })

  it('does no history listing or reading at startup and starts projection work on the first RPC', async () => {
    await useTempDshHome()
    const ctx = new Context()
    let handler: Handler | undefined
    const listSessions = vi.fn(async () => [{ header: { id: 's1', createdAt: 1 } }])
    const listSnapshots = vi.fn(async () => [{ header: { id: 's1' }, revision: 'r1' }])
    const readFrom = vi.fn(async () => ({
      events: [
        { type: 'request/header', time: 1, data: { header: { config: { provider: 'provider', model: 'model' } } } },
        { type: 'assistant/message', time: 2, data: { turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 1 } } },
      ],
    }))
    ctx.provide('sessionQuery', { listSessions } as never)
    ctx.provide('sessionPersistence', { listSnapshots, readFrom } as never)
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    ctx.provide('connection', {
      rpc: {
        handle: (_channel: string, next: Handler) => {
          handler = next
          return () => Promise.resolve()
        },
      },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], Config, apply }, {})
    await fiber.await()
    expect(listSessions).not.toHaveBeenCalled()
    expect(listSnapshots).not.toHaveBeenCalled()
    expect(readFrom).not.toHaveBeenCalled()

    const result = await handler?.(USAGE_QUERY_ENDPOINT, { start: 0, end: 10 }, new AbortController().signal)
    expect(result?.ok).toBe(true)
    expect(listSessions).toHaveBeenCalled()
    expect(readFrom).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('fails an exact RPC after a projection database error without a full-corpus fallback', async () => {
    await useTempDshHome()
    const ctx = new Context()
    let handler: Handler | undefined
    const readFrom = vi.fn(async () => ({
      events: [
        { type: 'request/header', time: 1, data: { header: { config: { provider: 'provider', model: 'model' } } } },
        { type: 'assistant/message', time: Number.POSITIVE_INFINITY, data: { turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 1 } } },
      ],
    }))
    ctx.provide('sessionQuery', {
      listSessions: async () => [{ header: { id: 's1', createdAt: 1 } }],
    } as never)
    ctx.provide('sessionPersistence', {
      listSnapshots: async () => [{ header: { id: 's1' }, revision: 'r1' }],
      readFrom,
    } as never)
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    ctx.provide('connection', {
      rpc: {
        handle: (_channel: string, next: Handler) => {
          handler = next
          return () => Promise.resolve()
        },
      },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], Config, apply }, {})
    await fiber.await()

    const result = await handler?.(USAGE_QUERY_ENDPOINT, { start: 0, end: 10 }, new AbortController().signal)
    expect(result?.ok).toBe(false)
    expect(readFrom).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects unknown endpoints and inverted windows', async () => {
    const handler = createUsageRpcHandler({
      collect: async () => ({
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
      }),
    })
    const unknown = await handler('nope', { start: 1, end: 2 }, new AbortController().signal)
    expect(unknown.ok).toBe(false)
    const inverted = await handler(USAGE_QUERY_ENDPOINT, { start: 2, end: 1 }, new AbortController().signal)
    expect(inverted.ok).toBe(false)
  })
})
