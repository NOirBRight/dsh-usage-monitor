/**
 * Durable, revision-aware final-usage projection for exact range queries.
 *
 * Source logs remain authoritative. The SQLite sidecar stores only complete
 * folds for the current projection version; changed sessions are replaced in
 * bounded transactions and failed replacements are made visibly incomplete.
 */

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { UsageQueryRequest, UsageSnapshot } from './client-contract.ts'
import {
  foldCorpusSession,
  mapPool,
  resolveWorkspace,
  type CorpusSession,
  type SessionCorpus,
  type WorkspaceIndex,
} from './collect.ts'
import type { StepUsage } from './fold.ts'
import { BUILTIN_PRICING, type PricingTable } from './pricing.ts'
import { queryUsage } from './query.ts'

const PROJECTION_VERSION = 1
const BUSY_TIMEOUT_MS = 5_000

/** Default number of session logs read concurrently. */
export const DEFAULT_PROJECTION_READ_CONCURRENCY = 1
/** Default number of sessions committed by one SQLite transaction. */
export const DEFAULT_PROJECTION_TRANSACTION_BATCH_SIZE = 8

interface RebuildResult {
  session: CorpusSession
  steps?: readonly StepUsage[] | undefined
  error?: unknown
}

interface ReconcileRequest {
  corpus: SessionCorpus
  workspaces: WorkspaceIndex
  end: number
  readConcurrency: number
  transactionBatchSize: number
}

interface ReconcileOutcome {
  volatile: Map<string, readonly StepUsage[]>
  rebuilt: boolean
}

export interface UsageProjectionInput {
  corpus: SessionCorpus
  workspaces: WorkspaceIndex
  query: UsageQueryRequest
  pricing?: PricingTable
  readConcurrency?: number
  transactionBatchSize?: number
}

/** Default plugin-owned sidecar path for the active DSH home. */
export function defaultUsageProjectionPath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-usage-monitor.sqlite')
}

/**
 * Reconcile source revisions through one shared worker, then answer windows
 * only from complete rows. Disposal rejects new work and waits for active
 * queries before closing SQLite.
 */
export class UsageProjection {
  private readonly db: DatabaseSync
  private workerPromise: Promise<void> | undefined
  private refreshRequested = 0
  private refreshCompleted = 0
  private pendingEnd = Number.NEGATIVE_INFINITY
  private latestRequest: ReconcileRequest | undefined
  private sessions = new Map<string, CorpusSession>()
  private volatile = new Map<string, readonly StepUsage[]>()
  private accepting = true
  private activeQueries = 0
  private idleWaiters: Array<() => void> = []
  private closePromise: Promise<void> | undefined
  private checkpointNeeded: boolean

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec([
      'PRAGMA journal_mode = WAL',
      'PRAGMA synchronous = NORMAL',
      `PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`,
      'CREATE TABLE IF NOT EXISTS usage_projection_sessions (id TEXT PRIMARY KEY, revision TEXT NOT NULL, projection_version INTEGER NOT NULL, complete INTEGER NOT NULL CHECK (complete IN (0, 1))) STRICT',
      'CREATE TABLE IF NOT EXISTS usage_projection_steps (session_id TEXT NOT NULL, ordinal INTEGER NOT NULL, time INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, workspace_id TEXT NOT NULL, workspace_title TEXT NOT NULL, uncached_input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL, PRIMARY KEY (session_id, ordinal)) STRICT',
      'CREATE INDEX IF NOT EXISTS usage_projection_steps_time ON usage_projection_steps (time)',
    ].join(';'))
    const row = this.db.prepare(
      'SELECT COUNT(*) AS count FROM usage_projection_sessions WHERE projection_version = ? AND complete = 1',
    ).get(PROJECTION_VERSION) as { count: number }
    this.checkpointNeeded = row.count === 0
  }

  /** Reconcile every potentially relevant session before returning the range. */
  async query(input: UsageProjectionInput): Promise<UsageSnapshot> {
    if (!this.accepting) throw new Error('usage projection is closing')
    this.activeQueries += 1
    try {
      await this.reconcile({
        corpus: input.corpus,
        workspaces: input.workspaces,
        end: input.query.end,
        readConcurrency: input.readConcurrency ?? DEFAULT_PROJECTION_READ_CONCURRENCY,
        transactionBatchSize: input.transactionBatchSize ?? DEFAULT_PROJECTION_TRANSACTION_BATCH_SIZE,
      })
      const steps = this.readIndexedSteps(input.query, input.workspaces.list())
      return queryUsage({
        steps,
        start: input.query.start,
        end: input.query.end,
        pricing: input.pricing ?? BUILTIN_PRICING,
      })
    } finally {
      this.activeQueries -= 1
      if (this.activeQueries === 0) {
        const waiters = this.idleWaiters
        this.idleWaiters = []
        for (const resolve of waiters) resolve()
      }
    }
  }

  /**
   * Join the shared reconciliation worker. A request arriving during a pass is
   * assigned a later ticket, which forces a follow-up source listing.
   */
  async reconcile(request: ReconcileRequest): Promise<void> {
    if (!this.accepting) throw new Error('usage projection is closing')
    const ticket = ++this.refreshRequested
    this.pendingEnd = Math.max(this.pendingEnd, request.end)
    this.latestRequest = request
    if (this.workerPromise === undefined) {
      const worker = this.runWorker()
      this.workerPromise = worker
      void worker.finally(() => {
        if (this.workerPromise === worker) this.workerPromise = undefined
      }).catch(() => undefined)
    }
    while (this.refreshCompleted < ticket) {
      const worker = this.workerPromise
      if (worker === undefined) continue
      await worker
    }
  }

  /** Stop accepting queries and close SQLite after every active query settles. */
  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    this.accepting = false
    this.closePromise = (async () => {
      if (this.activeQueries > 0) {
        await new Promise<void>(resolve => this.idleWaiters.push(resolve))
      }
      this.db.close()
    })()
    return this.closePromise
  }

  private async runWorker(): Promise<void> {
    while (this.refreshCompleted < this.refreshRequested) {
      const target = this.refreshRequested
      const request = this.latestRequest
      if (request === undefined) throw new Error('usage projection worker has no request')
      const end = this.pendingEnd
      this.pendingEnd = Number.NEGATIVE_INFINITY
      await this.reconcileUntilStable({ ...request, end })
      this.refreshCompleted = target
    }
  }

  private async reconcileUntilStable(request: ReconcileRequest): Promise<void> {
    let sessions = await request.corpus.listSessions()
    let signature = this.sessionSignature(sessions)
    let outcome = await this.reconcileListing(sessions, request)
    let rebuilt = outcome.rebuilt
    while (true) {
      const verified = await request.corpus.listSessions()
      const verifiedSignature = this.sessionSignature(verified)
      if (verifiedSignature === signature) {
        this.sessions = new Map(verified.map(session => [session.id, session]))
        this.volatile = outcome.volatile
        if (this.checkpointNeeded && rebuilt) {
          this.db.prepare('PRAGMA wal_checkpoint(PASSIVE)').all()
          this.checkpointNeeded = false
        }
        return
      }
      sessions = verified
      signature = verifiedSignature
      outcome = await this.reconcileListing(sessions, request)
      rebuilt ||= outcome.rebuilt
    }
  }

  private sessionSignature(sessions: readonly CorpusSession[]): string {
    return JSON.stringify([...sessions]
      .map(session => [session.id, session.revision ?? null, session.createdAt ?? null, session.cwd ?? null])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))))
  }

  private async reconcileListing(
    sessions: readonly CorpusSession[],
    request: ReconcileRequest,
  ): Promise<ReconcileOutcome> {
    const indexed = new Map<string, string>()
    for (const row of this.db.prepare(
      'SELECT id, revision FROM usage_projection_sessions WHERE projection_version = ? AND complete = 1',
    ).all(PROJECTION_VERSION) as Array<{ id: string, revision: string }>) {
      indexed.set(row.id, row.revision)
    }

    this.removeDeletedSessions(sessions)
    const rebuild = sessions.filter(session =>
      (session.createdAt === undefined || session.createdAt < request.end)
      && (session.revision === undefined || indexed.get(session.id) !== session.revision),
    )
    const volatile = new Map<string, readonly StepUsage[]>()
    const batchSize = Math.max(1, Math.floor(request.transactionBatchSize))
    for (let offset = 0; offset < rebuild.length; offset += batchSize) {
      const batch = rebuild.slice(offset, offset + batchSize)
      const results = await mapPool(
        batch,
        Math.max(1, Math.floor(request.readConcurrency)),
        async (session): Promise<RebuildResult> => {
          try {
            const workspace = resolveWorkspace(request.workspaces.list(), session.id, session.cwd)
            const steps = await foldCorpusSession(request.corpus, {
              sessionId: session.id,
              workspaceId: workspace.id,
              workspaceTitle: workspace.title,
            })
            return { session, steps }
          } catch (error) {
            return { session, error }
          }
        },
      )
      let firstError: unknown
      try {
        this.commitBatch(results)
      } catch (error) {
        firstError = error
        this.markBatchStale(results.map(result => result.session))
      }
      for (const result of results) {
        if (result.session.revision === undefined && result.steps !== undefined) {
          volatile.set(result.session.id, result.steps)
        }
        if (firstError === undefined && result.error !== undefined) firstError = result.error
        result.steps = undefined
        result.error = undefined
      }
      results.length = 0
      batch.length = 0
      if (firstError !== undefined) throw firstError
    }
    return { volatile, rebuilt: rebuild.length > 0 }
  }

  private removeDeletedSessions(sessions: readonly CorpusSession[]): void {
    const current = new Set(sessions.map(session => session.id))
    const existing = this.db.prepare('SELECT id FROM usage_projection_sessions').all() as Array<{ id: string }>
    const deleted = existing.filter(row => !current.has(row.id))
    if (deleted.length === 0) return
    const deleteSteps = this.db.prepare('DELETE FROM usage_projection_steps WHERE session_id = ?')
    const deleteSession = this.db.prepare('DELETE FROM usage_projection_sessions WHERE id = ?')
    this.db.exec('BEGIN')
    try {
      for (const row of deleted) {
        deleteSteps.run(row.id)
        deleteSession.run(row.id)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private commitBatch(results: readonly RebuildResult[]): void {
    const replace = this.db.prepare(
      'INSERT INTO usage_projection_sessions (id, revision, projection_version, complete) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, projection_version = excluded.projection_version, complete = 1',
    )
    const markStale = this.db.prepare(
      'INSERT INTO usage_projection_sessions (id, revision, projection_version, complete) VALUES (?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, projection_version = excluded.projection_version, complete = 0',
    )
    const deleteSteps = this.db.prepare('DELETE FROM usage_projection_steps WHERE session_id = ?')
    const deleteSession = this.db.prepare('DELETE FROM usage_projection_sessions WHERE id = ?')
    const insertStep = this.db.prepare(
      'INSERT INTO usage_projection_steps (session_id, ordinal, time, provider, model, workspace_id, workspace_title, uncached_input_tokens, output_tokens, cache_read_tokens, cache_write_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    this.db.exec('BEGIN')
    try {
      for (const result of results) {
        const { session, steps, error } = result
        if (session.revision === undefined) {
          deleteSteps.run(session.id)
          deleteSession.run(session.id)
          continue
        }
        deleteSteps.run(session.id)
        if (error !== undefined || steps === undefined) {
          markStale.run(session.id, session.revision, PROJECTION_VERSION)
          continue
        }
        replace.run(session.id, session.revision, PROJECTION_VERSION)
        for (let ordinal = 0; ordinal < steps.length; ordinal += 1) {
          const step = steps[ordinal]
          if (step === undefined) continue
          insertStep.run(
            session.id,
            ordinal,
            step.time,
            step.provider,
            step.model,
            step.workspaceId,
            step.workspaceTitle,
            step.uncachedInputTokens,
            step.outputTokens,
            step.cacheReadTokens,
            step.cacheWriteTokens,
          )
        }
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private markBatchStale(sessions: readonly CorpusSession[]): void {
    const markStale = this.db.prepare(
      'INSERT INTO usage_projection_sessions (id, revision, projection_version, complete) VALUES (?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, projection_version = excluded.projection_version, complete = 0',
    )
    const deleteSteps = this.db.prepare('DELETE FROM usage_projection_steps WHERE session_id = ?')
    const deleteSession = this.db.prepare('DELETE FROM usage_projection_sessions WHERE id = ?')
    this.db.exec('BEGIN')
    try {
      for (const session of sessions) {
        deleteSteps.run(session.id)
        if (session.revision === undefined) deleteSession.run(session.id)
        else markStale.run(session.id, session.revision, PROJECTION_VERSION)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private readIndexedSteps(
    query: UsageQueryRequest,
    workspaces: readonly ReturnType<WorkspaceIndex['list']>[number][],
  ): StepUsage[] {
    const rows = this.db.prepare([
      'SELECT p.session_id, p.time, p.provider, p.model, p.workspace_id, p.workspace_title,',
      'p.uncached_input_tokens, p.output_tokens, p.cache_read_tokens, p.cache_write_tokens',
      'FROM usage_projection_steps AS p',
      'JOIN usage_projection_sessions AS s ON s.id = p.session_id',
      'WHERE p.time >= ? AND p.time < ? AND s.projection_version = ? AND s.complete = 1',
      'ORDER BY p.time, p.session_id, p.ordinal',
    ].join(' ')).all(query.start, query.end, PROJECTION_VERSION) as Array<Record<string, string | number>>
    const steps: StepUsage[] = []
    for (const row of rows) {
      const session = this.sessions.get(String(row.session_id))
      if (!this.sessionCanContribute(session, query.end)) continue
      steps.push(this.restoreStep(row, workspaces))
    }
    for (const [sessionId, volatileSteps] of this.volatile) {
      const session = this.sessions.get(sessionId)
      if (!this.sessionCanContribute(session, query.end)) continue
      const workspace = resolveWorkspace(workspaces, session.id, session.cwd)
      for (const step of volatileSteps) {
        if (step.time < query.start || step.time >= query.end) continue
        steps.push({ ...step, workspaceId: workspace.id, workspaceTitle: workspace.title })
      }
    }
    return steps
  }

  private sessionCanContribute(session: CorpusSession | undefined, end: number): session is CorpusSession {
    return session !== undefined && (session.createdAt === undefined || session.createdAt < end)
  }

  private restoreStep(
    row: Record<string, string | number>,
    workspaces: readonly ReturnType<WorkspaceIndex['list']>[number][],
  ): StepUsage {
    const sessionId = String(row.session_id)
    const session = this.sessions.get(sessionId)
    const workspace = session === undefined
      ? { id: String(row.workspace_id), title: String(row.workspace_title) }
      : resolveWorkspace(workspaces, session.id, session.cwd)
    return {
      time: Number(row.time),
      sessionId,
      workspaceId: workspace.id,
      workspaceTitle: workspace.title,
      provider: String(row.provider),
      model: String(row.model),
      uncachedInputTokens: Number(row.uncached_input_tokens),
      outputTokens: Number(row.output_tokens),
      cacheReadTokens: Number(row.cache_read_tokens),
      cacheWriteTokens: Number(row.cache_write_tokens),
    }
  }
}
