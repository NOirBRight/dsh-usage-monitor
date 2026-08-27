import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
    await projection.close()

    const restarted = new UsageProjection(join(dir, 'index.sqlite'))
    reads.length = 0
    const afterRestart = await restarted.query({ corpus, workspaces: workspaces(), query: { start: 0, end: 10 } })
    expect(afterRestart.summary.requests).toBe(2)
    expect(reads).toEqual([])
    await restarted.close()
  })

  it('marks stale rows and fails an exact query when a changed source cannot be rebuilt', async () => {
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
    await expect(projection.query({ corpus, workspaces: workspaces(), query: { start: 0, end: 10 } }))
      .rejects.toThrow('broken source')
    expect(reads).toBe(2)
    const db = new DatabaseSync(join(dir, 'index.sqlite'))
    expect(db.prepare('SELECT complete FROM usage_projection_sessions WHERE id = ?').get('s1'))
      .toEqual({ complete: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM usage_projection_steps WHERE session_id = ?').get('s1'))
      .toEqual({ count: 0 })
    db.close()

    fail = false
    const recovered = await projection.query({ corpus, workspaces: workspaces(), query: { start: 0, end: 10 } })
    expect(recovered.summary.requests).toBe(1)
    expect(reads).toBe(3)
    await projection.close()
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
    await projection.close()
  })

  it('preserves createdAt eligibility for historical windows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-created-at-'))
    tempDirs.push(dir)
    const sessions = [{ id: 'future', cwd: '/repo', createdAt: 20, revision: 'r1' }]
    let reads = 0
    const corpus = {
      listSessions: async () => sessions,
      readEvents: async () => {
        reads += 1
        return [header('kimi-coding', 'k3'), message(2, 2)]
      },
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const historical = await projection.query({ corpus, workspaces: workspaces(), query: { start: 0, end: 10 } })
    expect(historical.summary.requests).toBe(0)
    const current = await projection.query({ corpus, workspaces: workspaces(), query: { start: 0, end: 30 } })
    expect(current.summary.requests).toBe(1)
    expect(reads).toBe(1)
    await projection.close()
  })

  it('rechecks revisions when a concurrent query joins a refresh', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-concurrent-'))
    tempDirs.push(dir)
    let sessions = [{ id: 's1', revision: 'r1' }]
    let reads = 0
    let releaseFirst: (() => void) | undefined
    let signalFirstRead: (() => void) | undefined
    const firstReadStarted = new Promise<void>(resolve => { signalFirstRead = resolve })
    const corpus = {
      listSessions: async () => sessions,
      readEvents: async () => {
        reads += 1
        if (reads === 1) {
          signalFirstRead?.()
          await new Promise<void>(resolve => { releaseFirst = resolve })
          return [header('kimi-coding', 'k3'), message(2, 2)]
        }
        return [header('kimi-coding', 'k3'), message(8, 8)]
      },
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const first = projection.query({ corpus, workspaces: workspaces(), query: { start: 0, end: 10 } })
    await firstReadStarted
    sessions = [{ id: 's1', revision: 'r2' }]
    const second = projection.query({ corpus, workspaces: workspaces(), query: { start: 0, end: 10 } })
    releaseFirst?.()
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.summary.tokens).toBe(9)
    expect(secondResult.summary.tokens).toBe(9)
    expect(reads).toBe(2)
    await projection.close()
  })

  it('keeps a wide revision-less snapshot exact when a narrow query joins its read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-wide-narrow-'))
    tempDirs.push(dir)
    let reads = 0
    let listings = 0
    let releaseRead: (() => void) | undefined
    let signalRead: (() => void) | undefined
    const readStarted = new Promise<void>(resolve => { signalRead = resolve })
    const corpus = {
      listSessions: async () => {
        listings += 1
        return [{ id: 'live', createdAt: 10 }]
      },
      readEvents: async () => {
        reads += 1
        if (reads === 1) {
          signalRead?.()
          await new Promise<void>(resolve => { releaseRead = resolve })
        }
        return [header('provider', 'model'), message(12, 1)]
      },
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const workspaceIndex = { list: () => [] as const }
    const wide = projection.query({ corpus, workspaces: workspaceIndex, query: { start: 0, end: 20 } })
    await readStarted
    const narrow = projection.query({ corpus, workspaces: workspaceIndex, query: { start: 0, end: 5 } })
    releaseRead?.()
    const [wideResult, narrowResult] = await Promise.all([wide, narrow])
    expect(wideResult.summary.requests).toBe(1)
    expect(narrowResult.summary.requests).toBe(0)
    expect(reads).toBe(2)
    expect(listings).toBeGreaterThanOrEqual(4)
    await projection.close()
  })

  it('widens a narrow pass when a wider query joins before the first listing returns', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-narrow-wide-'))
    tempDirs.push(dir)
    let reads = 0
    let listings = 0
    let releaseList: (() => void) | undefined
    let signalList: (() => void) | undefined
    const listStarted = new Promise<void>(resolve => { signalList = resolve })
    const corpus = {
      listSessions: async () => {
        listings += 1
        if (listings === 1) {
          signalList?.()
          await new Promise<void>(resolve => { releaseList = resolve })
        }
        return [{ id: 'live', createdAt: 10 }]
      },
      readEvents: async () => {
        reads += 1
        return [header('provider', 'model'), message(12, 1)]
      },
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const workspaceIndex = { list: () => [] as const }
    const narrow = projection.query({ corpus, workspaces: workspaceIndex, query: { start: 0, end: 5 } })
    await listStarted
    const wide = projection.query({ corpus, workspaces: workspaceIndex, query: { start: 0, end: 20 } })
    releaseList?.()
    const [narrowResult, wideResult] = await Promise.all([narrow, wide])
    expect(narrowResult.summary.requests).toBe(0)
    expect(wideResult.summary.requests).toBe(1)
    expect(reads).toBe(1)
    expect(listings).toBeGreaterThanOrEqual(4)
    await projection.close()
  })

  it('retains the widest active end across three joined windows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-three-windows-'))
    tempDirs.push(dir)
    let reads = 0
    let releaseRead: (() => void) | undefined
    let signalRead: (() => void) | undefined
    const readStarted = new Promise<void>(resolve => { signalRead = resolve })
    const corpus = {
      listSessions: async () => [{ id: 'live', createdAt: 20 }],
      readEvents: async () => {
        reads += 1
        if (reads === 1) {
          signalRead?.()
          await new Promise<void>(resolve => { releaseRead = resolve })
        }
        return [header('provider', 'model'), message(22, 1)]
      },
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const workspaceIndex = { list: () => [] as const }
    const wide = projection.query({ corpus, workspaces: workspaceIndex, query: { start: 0, end: 30 } })
    await readStarted
    const narrow = projection.query({ corpus, workspaces: workspaceIndex, query: { start: 0, end: 5 } })
    const medium = projection.query({ corpus, workspaces: workspaceIndex, query: { start: 0, end: 15 } })
    releaseRead?.()
    const [wideResult, narrowResult, mediumResult] = await Promise.all([wide, narrow, medium])
    expect(wideResult.summary.requests).toBe(1)
    expect(narrowResult.summary.requests).toBe(0)
    expect(mediumResult.summary.requests).toBe(0)
    expect(reads).toBe(2)
    await projection.close()
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
    const first = await projection.query({ corpus, workspaces: emptyWorkspaces, query: { start: 5, end: 6 }, readConcurrency: 32 })
    expect(first.summary.requests).toBe(4200)
    expect(reads).toBe(4200)
    reads = 0
    const second = await projection.query({ corpus, workspaces: emptyWorkspaces, query: { start: 5, end: 6 }, readConcurrency: 32 })
    expect(second.summary.requests).toBe(4200)
    expect(reads).toBe(0)
    await projection.close()
  })

  it('uses one source read at a time by default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-concurrency-'))
    tempDirs.push(dir)
    const sessions = Array.from({ length: 4 }, (_, index) => ({ id: `s${index}`, revision: 'r1' }))
    let active = 0
    let peak = 0
    const corpus = {
      listSessions: async () => sessions,
      readEvents: async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 2))
        active -= 1
        return [header('provider', 'model'), message(5, 1)]
      },
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const result = await projection.query({ corpus, workspaces: { list: () => [] }, query: { start: 0, end: 10 } })
    expect(result.summary.requests).toBe(4)
    expect(peak).toBe(1)
    await projection.close()
  })

  it('opens SQLite in WAL mode with bounded-wait durability pragmas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-pragmas-'))
    tempDirs.push(dir)
    const path = join(dir, 'index.sqlite')
    const projection = new UsageProjection(path)
    const db = (projection as unknown as { db: DatabaseSync }).db
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    expect(db.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 1 })
    expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 })
    await projection.close()
  })

  it('defers the one initial checkpoint until a query actually completes rebuild work', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-checkpoint-'))
    tempDirs.push(dir)
    const corpus = {
      listSessions: async () => [{ id: 'future', revision: 'r1', createdAt: 10 }],
      readEvents: async () => [header('provider', 'model'), message(12, 1)],
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const checkpointState = () => (projection as unknown as { checkpointNeeded: boolean }).checkpointNeeded
    await projection.query({ corpus, workspaces: { list: () => [] }, query: { start: 0, end: 10 } })
    expect(checkpointState()).toBe(true)
    await projection.query({ corpus, workspaces: { list: () => [] }, query: { start: 0, end: 20 } })
    expect(checkpointState()).toBe(false)
    await projection.close()
  })

  it('queries only rows still marked complete for the current projection version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-current-'))
    tempDirs.push(dir)
    const path = join(dir, 'index.sqlite')
    const projection = new UsageProjection(path)
    const db = new DatabaseSync(path)
    let listings = 0
    const sessions = [
      { id: 'incomplete', revision: 'r1' },
      { id: 'old-version', revision: 'r1' },
    ]
    const corpus = {
      listSessions: async () => {
        listings += 1
        if (listings === 2) {
          db.prepare('UPDATE usage_projection_sessions SET complete = 0 WHERE id = ?').run('incomplete')
          db.prepare('UPDATE usage_projection_sessions SET projection_version = 999 WHERE id = ?').run('old-version')
        }
        return sessions
      },
      readEvents: async () => [header('provider', 'model'), message(5, 1)],
    }
    const result = await projection.query({
      corpus,
      workspaces: { list: () => [] },
      query: { start: 0, end: 10 },
    })
    expect(result.summary.requests).toBe(0)
    db.close()
    await projection.close()
  })

  it('retries revision-less sessions on every query instead of treating volatile folds as current', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-volatile-'))
    tempDirs.push(dir)
    let reads = 0
    const corpus = {
      listSessions: async () => [{ id: 'live' }],
      readEvents: async () => {
        reads += 1
        return [header('provider', 'model'), message(5, reads)]
      },
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const input = { corpus, workspaces: { list: () => [] as const }, query: { start: 0, end: 10 } }
    expect((await projection.query(input)).summary.tokens).toBe(2)
    expect((await projection.query(input)).summary.tokens).toBe(3)
    expect(reads).toBe(2)
    await projection.close()
  })

  it('commits completed batches so a later source failure resumes without rereading them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-resume-'))
    tempDirs.push(dir)
    const sessions = ['s1', 's2', 's3'].map(id => ({ id, revision: 'r1' }))
    let fail = true
    const reads: string[] = []
    const corpus = {
      listSessions: async () => sessions,
      readEvents: async (id: string) => {
        reads.push(id)
        if (id === 's3' && fail) throw new Error('interrupted')
        return [header('provider', 'model'), message(5, 1)]
      },
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const input = {
      corpus,
      workspaces: { list: () => [] as const },
      query: { start: 0, end: 10 },
      transactionBatchSize: 2,
    }
    await expect(projection.query(input)).rejects.toThrow('interrupted')
    expect(reads).toEqual(['s1', 's2', 's3'])

    fail = false
    reads.length = 0
    const recovered = await projection.query(input)
    expect(recovered.summary.requests).toBe(3)
    expect(reads).toEqual(['s3'])
    await projection.close()
  })

  it('rolls back and marks a whole write batch stale when SQLite rejects one row', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-rollback-'))
    tempDirs.push(dir)
    const sessions = ['s1', 's2'].map(id => ({ id, revision: 'r1' }))
    let invalid = true
    const reads: string[] = []
    const corpus = {
      listSessions: async () => sessions,
      readEvents: async (id: string) => {
        reads.push(id)
        return [header('provider', 'model'), message(id === 's2' && invalid ? Number.POSITIVE_INFINITY : 5, 1)]
      },
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const input = {
      corpus,
      workspaces: { list: () => [] as const },
      query: { start: 0, end: 10 },
      transactionBatchSize: 2,
    }
    await expect(projection.query(input)).rejects.toThrow()
    const db = new DatabaseSync(join(dir, 'index.sqlite'))
    expect(db.prepare('SELECT COUNT(*) AS count FROM usage_projection_steps').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM usage_projection_sessions WHERE complete = 1').get())
      .toEqual({ count: 0 })
    db.close()

    invalid = false
    reads.length = 0
    const recovered = await projection.query(input)
    expect(recovered.summary.requests).toBe(2)
    expect(reads.sort()).toEqual(['s1', 's2'])
    await projection.close()
  })

  it('removes deleted sessions and never reads sessions created at or after the query end', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-deleted-'))
    tempDirs.push(dir)
    let sessions = [
      { id: 'old', revision: 'r1', createdAt: 1 },
      { id: 'future', revision: 'r1', createdAt: 10 },
    ]
    const reads: string[] = []
    const corpus = {
      listSessions: async () => sessions,
      readEvents: async (id: string) => {
        reads.push(id)
        return [header('provider', 'model'), message(5, 1)]
      },
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const first = await projection.query({ corpus, workspaces: { list: () => [] }, query: { start: 0, end: 10 } })
    expect(first.summary.requests).toBe(1)
    expect(reads).toEqual(['old'])

    sessions = [{ id: 'future', revision: 'r1', createdAt: 10 }]
    reads.length = 0
    const afterDelete = await projection.query({ corpus, workspaces: { list: () => [] }, query: { start: 0, end: 10 } })
    expect(afterDelete.summary.requests).toBe(0)
    expect(reads).toEqual([])
    const db = new DatabaseSync(join(dir, 'index.sqlite'))
    expect(db.prepare('SELECT COUNT(*) AS count FROM usage_projection_sessions WHERE id = ?').get('old'))
      .toEqual({ count: 0 })
    db.close()
    await projection.close()
  })

  it('waits for an active query before closing and rejects new work once disposal starts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-dispose-'))
    tempDirs.push(dir)
    let release: (() => void) | undefined
    let started: (() => void) | undefined
    const readStarted = new Promise<void>(resolve => { started = resolve })
    const corpus = {
      listSessions: async () => [{ id: 's1', revision: 'r1' }],
      readEvents: async () => {
        started?.()
        await new Promise<void>(resolve => { release = resolve })
        return [header('provider', 'model'), message(5, 1)]
      },
    }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const active = projection.query({ corpus, workspaces: { list: () => [] }, query: { start: 0, end: 10 } })
    await readStarted
    let closed = false
    const closing = projection.close().then(() => { closed = true })
    await expect(projection.query({ corpus, workspaces: { list: () => [] }, query: { start: 0, end: 10 } }))
      .rejects.toThrow('usage projection is closing')
    expect(closed).toBe(false)
    release?.()
    expect((await active).summary.requests).toBe(1)
    await closing
    expect(closed).toBe(true)
  })

  it('waits for a direct reconciliation before closing and rejects later direct work', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-projection-reconcile-dispose-'))
    tempDirs.push(dir)
    let release: (() => void) | undefined
    let started: (() => void) | undefined
    const readStarted = new Promise<void>(resolve => { started = resolve })
    const corpus = {
      listSessions: async () => [{ id: 's1', revision: 'r1' }],
      readEvents: async () => {
        started?.()
        await new Promise<void>(resolve => { release = resolve })
        return [header('provider', 'model'), message(5, 1)]
      },
    }
    const workspaces = { list: () => [] as const }
    const projection = new UsageProjection(join(dir, 'index.sqlite'))
    const request = {
      corpus,
      workspaces,
      end: 10,
      readConcurrency: 1,
      transactionBatchSize: 8,
    }
    const reconciling = projection.reconcile(request)
    await readStarted
    const closing = projection.close()
    expect(await Promise.race([closing.then(() => 'closed'), Promise.resolve('pending')])).toBe('pending')
    release?.()
    await expect(reconciling).resolves.toBeUndefined()
    await closing
    await expect(projection.query({ corpus, workspaces, query: { start: 0, end: 10 } }))
      .rejects.toThrow('usage projection is closing')
    await expect(projection.reconcile(request)).rejects.toThrow('usage projection is closing')
  })
})
