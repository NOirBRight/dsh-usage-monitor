import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

describe('usage client injection', () => {
  it('passes the application locale to the dashboard instead of the browser locale', () => {
    let section: { inject: () => Record<string, unknown> } | undefined
    const ctx = {
      effect: vi.fn((install: () => unknown) => {
        if (install.name !== 'installUsageNavIcon') install()
      }),
      get: vi.fn(() => ({ rpc: { call: vi.fn() } })),
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

    expect(section?.inject()).toMatchObject({ locale: 'en' })
  })
})
