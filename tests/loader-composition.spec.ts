import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as UsageMonitor from '../src/index.ts'

let context: Context | undefined
const tempDirs: string[] = []

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function createLoader() {
  const home = await mkdtemp(join(tmpdir(), 'usage-loader-'))
  tempDirs.push(home)
  vi.stubEnv('DSH_HOME', home)

  context = new Context()
  const listSessions = vi.fn(async () => [])
  const listSnapshots = vi.fn(async () => [])
  const readFrom = vi.fn(async () => ({ events: [] }))
  context.provide('sessionQuery', { listSessions } as never)
  context.provide('sessionPersistence', { listSnapshots, readFrom } as never)
  context.provide('workspaceRegistry', { list: () => [] } as never)
  context.provide('connection', {
    rpc: {
      handle: () => () => Promise.resolve(),
    },
  } as never)
  await context.plugin(Loader)
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier !== 'dsh-usage-monitor') throw new Error(`unexpected Loader import: ${specifier}`)
      return UsageMonitor
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  return { context, listSessions, listSnapshots, readFrom }
}

describe('usage-monitor Loader composition', () => {
  it('loads an entry without config using bounded on-demand defaults and no startup history reads', async () => {
    const loaded = await createLoader()
    const id = await loaded.context.loader.create({ name: 'dsh-usage-monitor' })
    await loaded.context.loader.await()

    expect(loaded.context.loader.resolve(id).fiber?.config).toEqual({
      projectionWarmup: 'on-demand',
      projectionReadConcurrency: 1,
      projectionTransactionBatchSize: 8,
    })
    expect(loaded.listSessions).not.toHaveBeenCalled()
    expect(loaded.listSnapshots).not.toHaveBeenCalled()
    expect(loaded.readFrom).not.toHaveBeenCalled()
  })

  it('fails loud when an entry supplies an invalid explicit config', async () => {
    const loaded = await createLoader()

    await expect(loaded.context.loader.create({
      name: 'dsh-usage-monitor',
      config: { projectionReadConcurrency: 0 },
    })).rejects.toThrow(/positive safe integer.*projectionReadConcurrency/)
  })
})
