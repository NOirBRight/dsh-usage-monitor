import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageProjection } from '../src/projection.ts'

const header = (provider: string, model: string) => ({
  type: 'request/header',
  time: 0,
  data: { header: { config: { provider, model } } },
})

const message = (time: number, inputTokens: number) => ({
  type: 'assistant/message',
  time,
  data: { turn: 1, step: 1, usage: { inputTokens, outputTokens: 1 } },
})

const workspaces = (title = 'Repo') => ({
  list: () => [{ id: 'w1', title, path: '/repo', sessionIds: ['s1', 's2'] }],
})

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('UsageProjection', () => {
  it('indexes once, answers ranges from rows, and rebuilds only changed sessions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-'))
    tempDirs.push(dir)
    let sessions = [
      { id: 's1', cwd: '/repo', revision: 'r1' },
      { id: 's2', cwd: '/repo', revision: 'r1' },
    ]
    const reads: string[] = []
    const corpus = {
      listSessions: async () => sessions,
      readEvents: async (id: string) => {
        reads.push(id)
        if (id === 's1') return [header('kimi-coding', 'k3'), message(2, 2)]
        return [header('grok', 'grok-4'), message(8, 4)]
      },
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const first = await projection.query({ corpus, workspaces: workspaces(), query: { start: 0, end: 10 } })
    expect(first.summary.requests).toBe(2)
    expect(reads.sort()).toEqual(['s1', 's2'])

    reads.length = 0
    const narrow = await projection.query({ corpus, workspaces: workspaces(), query: { start: 5, end: 10 } })
    expect(narrow.summary.requests).toBe(1)
    expect(reads).toEqual([])

    sessions = [
      { id: 's1', cwd: '/repo', revision: 'r1' },
      { id: 's2', cwd: '/repo', revision: 'r2' },
    ]
    const changed = await projection.query({ corpus, workspaces: workspaces(), query: { start: 0, end: 10 } })
    expect(changed.summary.requests).toBe(2)
    expect(reads).toEqual(['s2'])

    reads.length = 0
    const renamed = await projection.query({ corpus, workspaces: workspaces('Renamed'), query: { start: 0, end: 10 } })
    expect(renamed.events.every(event => event.workspaceTitle === 'Renamed')).toBe(true)
    expect(reads).toEqual([])
    projection.close()

    const restarted = new UsageProjection(join(dir, 'index.sqlite'))
    reads.length = 0
    const afterRestart = await restarted.query({ corpus, workspaces: workspaces(), query: { start: 0, end: 10 } })
    expect(afterRestart.summary.requests).toBe(2)
    expect(reads).toEqual([])
    restarted.close()
  })

  it('removes stale rows when a changed source cannot be rebuilt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-failure-'))
    tempDirs.push(dir)
    let revision = 'r1'
    let fail = false
    let reads = 0
    const corpus = {
      listSessions: async () => [{ id: 's1', cwd: '/repo', revision }],
      readEvents: async () => {
        reads += 1
        if (fail) throw new Error('broken source')
        return [header('kimi-coding', 'k3'), message(2, 2)]
      },
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const first = await projection.query({ corpus, workspaces: workspaces(), query: { start: 0, end: 10 } })
    expect(first.summary.requests).toBe(1)
    expect(reads).toBe(1)

    revision = 'r2'
    fail = true
    const missing = await projection.query({ corpus, workspaces: workspaces(), query: { start: 0, end: 10 } })
    expect(missing.summary.requests).toBe(0)
    expect(reads).toBe(2)
    projection.close()
  })

  it('keeps final same-step replacement semantics before range filtering', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-replacement-'))
    tempDirs.push(dir)
    const corpus = {
      listSessions: async () => [{ id: 's1', cwd: '/repo', revision: 'r1' }],
      readEvents: async () => [header('kimi-coding', 'k3'), message(4, 2), message(20, 8)],
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const before = await projection.query({ corpus, workspaces: workspaces(), query: { start: 0, end: 10 } })
    expect(before.summary.requests).toBe(0)
    const after = await projection.query({ corpus, workspaces: workspaces(), query: { start: 10, end: 30 } })
    expect(after.summary.requests).toBe(1)
    expect(after.summary.tokens).toBe(9)
    projection.close()
  })

  it('keeps a corpus above the old 4096-entry cache limit warm', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-scale-'))
    tempDirs.push(dir)
    const sessions = Array.from({ length: 4200 }, (_, index) => ({
      id: `s${index}`,
      revision: 'r1',
    }))
    let reads = 0
    const corpus = {
      listSessions: async () => sessions,
      readEvents: async () => {
        reads += 1
        return [header('provider', 'model'), message(5, 1)]
      },
    }
    const emptyWorkspaces = { list: () => [] }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const first = await projection.query({ corpus, workspaces: emptyWorkspaces, query: { start: 5, end: 6 }, concurrency: 32 })
    expect(first.summary.requests).toBe(4200)
    expect(reads).toBe(4200)
    reads = 0
    const second = await projection.query({ corpus, workspaces: emptyWorkspaces, query: { start: 5, end: 6 }, concurrency: 32 })
    expect(second.summary.requests).toBe(4200)
    expect(reads).toBe(0)
    projection.close()
  })
})
