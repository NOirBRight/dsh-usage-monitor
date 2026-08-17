import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { USAGE_QUERY_ENDPOINT, USAGE_RPC_CHANNEL } from '../src/client-contract.ts'
import { apply, createUsageRpcHandler, inject } from '../src/index.ts'

type Handler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<{ ok: boolean, value?: unknown, error?: { message: string } }>

describe('usage-monitor RPC', () => {
  it('registers /usage-monitor as a loopback channel', async () => {
    const ctx = new Context()
    const handle = vi.fn((_channel: string, _handler: Handler, _options: { authority: 'loopback' }) =>
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
    const fiber = ctx.plugin({ inject: [...inject], apply }, {})
    await fiber.await()
    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle.mock.calls[0]?.[0]).toBe(USAGE_RPC_CHANNEL)
    expect(handle.mock.calls[0]?.[2]).toEqual({ authority: 'loopback' })
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
