import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, resolveConfig } from '@deepseek-ai/cordis'
import { USAGE_QUERY_ENDPOINT, USAGE_RPC_METHOD } from '../src/client-contract.ts'
import { Config, apply, createUsageRpcHandler, inject } from '../src/index.ts'

type UsageRoute = {
  path: string
  methods: readonly string[]
  requestBody: 'buffered'
  fetch(request: Request): Promise<Response>
}

function usageRequest(endpoint: string, payload: unknown): Request {
  return new Request('http://localhost/api/plugin-rpc/usage-monitor', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'rpc-1',
      method: USAGE_RPC_METHOD,
      payload: { endpoint, payload },
    }),
  })
}

const tempDirs: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

function stubPersistence(revisions: Array<{ id: string, revision: string }> = []) {
  const list = vi.fn(async () => revisions.map(entry => ({
    header: { id: entry.id },
    revision: entry.revision,
  })))
  return { list, persistence: { list } }
}

async function useTempDshHome(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'usage-rpc-'))
  tempDirs.push(dir)
  vi.stubEnv('DSH_HOME', dir)
}

describe('usage-monitor RPC', () => {
  it('registers an exact Fetch route and rejects invalid wire bodies', async () => {
    await useTempDshHome()
    const ctx = new Context()
    let route: UsageRoute | undefined
    const dispose = vi.fn(async () => {})
    const register = vi.fn((value: UsageRoute) => {
      route = value
      return dispose
    })
    ctx.provide('sessionQuery', {
      listSessions: async () => [],
      readSession: async () => ({ events: [] }),
    } as never)
    ctx.provide('sessionPersistence', stubPersistence().persistence as never)
    ctx.provide('workspaceRegistry', { list: () => [] } as never)
    ctx.provide('connection', { operator: {}, fetch: { register } } as never)
    const fiber = ctx.plugin({ inject: [...inject], Config, apply }, {})
    await fiber.await()
    expect(register).toHaveBeenCalledTimes(1)
    expect(route).toMatchObject({
      path: '/api/plugin-rpc/usage-monitor',
      methods: ['POST'],
      requestBody: 'buffered',
    })

    const unsupported = await route?.fetch(new Request('http://localhost/api/plugin-rpc/usage-monitor', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    }))
    expect(unsupported?.status).toBe(415)
    const malformed = await route?.fetch(new Request('http://localhost/api/plugin-rpc/usage-monitor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }))
    expect(malformed?.status).toBe(400)
    const omittedPayload = await route?.fetch(new Request('http://localhost/api/plugin-rpc/usage-monitor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'rpc-1',
        method: USAGE_RPC_METHOD,
        payload: { endpoint: USAGE_QUERY_ENDPOINT },
      }),
    }))
    expect(omittedPayload?.status).toBe(200)
    expect((await omittedPayload?.json() as { result: { ok: boolean } }).result.ok).toBe(false)
    await fiber.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('defaults projection work to on-demand, one reader, and eight sessions per transaction', () => {
    expect(resolveConfig({ Config, apply } as never, {})).toEqual({
      projectionWarmup: 'on-demand',
      projectionReadConcurrency: 1,
      projectionTransactionBatchSize: 8,
    })
  })

  it('keeps startup cold and returns live and persisted usage under workspace ownership', async () => {
    await useTempDshHome()
    const ctx = new Context()
    let route: UsageRoute | undefined
    const events = [
      { type: 'request/header', time: 1, data: { header: { config: { provider: 'provider', model: 'model' } } } },
      { type: 'assistant/message', time: 2, data: { turn: 1, step: 1, usage: { inputTokens: 2, outputTokens: 1 } } },
    ]
    const listSessions = vi.fn(async () => [
      { header: { id: 's-cold', cwd: '/repo', createdAt: 1 }, live: false },
      { header: { id: 's-live', cwd: '/repo', createdAt: 2 }, live: true },
    ])
    const readSession = vi.fn(async () => ({ events }))
    const stub = stubPersistence([{ id: 's-cold', revision: 'r1' }])
    const register = vi.fn((value: UsageRoute) => {
      route = value
      return async () => {}
    })
    ctx.provide('sessionQuery', { listSessions, readSession } as never)
    ctx.provide('sessionPersistence', stub.persistence as never)
    ctx.provide('workspaceRegistry', {
      list: () => [{ id: 'w1', title: 'Repo', path: '/repo', sessionIds: ['s-cold', 's-live'] }],
    } as never)
    ctx.provide('sessions', {
      get: (id: unknown) => String(id) === 's-live'
        ? { id: 's-live', seq: 9, header: { id: 's-live' } }
        : undefined,
      list: () => [{ id: 's-live', seq: 9, header: { id: 's-live' } }],
    } as never)
    ctx.provide('connection', { operator: {}, fetch: { register } } as never)
    const fiber = ctx.plugin({ inject: [...inject], Config, apply }, {})
    await fiber.await()
    expect(listSessions).not.toHaveBeenCalled()
    expect(stub.list).not.toHaveBeenCalled()
    expect(readSession).not.toHaveBeenCalled()

    const response = await route?.fetch(usageRequest(USAGE_QUERY_ENDPOINT, { start: 0, end: 10 }))
    const wire = await response?.json() as {
      type: string
      rpcId: string
      result: { ok: boolean, value?: { summary: { tokens: number }, events: Array<{ workspaceId: string }> } }
    }
    expect(response?.status).toBe(200)
    expect(wire).toMatchObject({
      type: 'server-response',
      rpcId: 'rpc-1',
      result: { ok: true, value: { summary: { tokens: 6 } } },
    })
    expect(wire.result.value?.events).toEqual([
      expect.objectContaining({
        workspaceId: 'w1',
        requests: 2,
        uncachedInputTokens: 4,
        outputTokens: 2,
      }),
    ])
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
    const unknown = await handler('nope', { start: 1, end: 2 }, new AbortController().signal, {} as never)
    expect(unknown.ok).toBe(false)
    const inverted = await handler(USAGE_QUERY_ENDPOINT, { start: 2, end: 1 }, new AbortController().signal, {} as never)
    expect(inverted.ok).toBe(false)
  })
})
