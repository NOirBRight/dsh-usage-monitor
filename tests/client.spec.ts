import { describe, expect, it, vi } from 'vitest'
import { USAGE_QUERY_ENDPOINT, USAGE_RPC_METHOD } from '../src/client-contract.ts'
import { apply } from '../src/client/index.ts'

describe('usage client injection', () => {
  it('uses the application locale and sends usage RPC through its exact API method', async () => {
    let section: { inject: () => Record<string, unknown> } | undefined
    const call = vi.fn(async () => ({
      ok: true as const,
      value: {
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
      },
    }))
    const ctx = {
      effect: vi.fn((install: () => unknown) => {
        if (install.name !== 'installUsageNavIcon') install()
      }),
      get: vi.fn(() => ({ rpc: { call } })),
      locale: {
        bind: vi.fn(() => (key: string) => key),
        getLocale: vi.fn(() => ({ active: 'en' })),
        register: vi.fn(() => vi.fn()),
      },
      slots: {
        inject: vi.fn((_name: string, install: () => unknown) => install()),
        register: vi.fn((entry: typeof section) => {
          section = entry
          return vi.fn()
        }),
      },
    }

    apply(ctx as never)

    const injected = section?.inject()
    expect(injected).toMatchObject({ locale: 'en' })
    await (injected?.queryUsage as (start: number, end: number) => Promise<unknown>)(1, 2)
    expect(call).toHaveBeenCalledWith(
      '/api',
      USAGE_RPC_METHOD,
      { endpoint: USAGE_QUERY_ENDPOINT, payload: { start: 1, end: 2 } },
      expect.any(AbortSignal),
    )
  })
})
