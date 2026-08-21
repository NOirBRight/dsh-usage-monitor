/**
 * Durable final-usage projection for range queries.
 *
 * The source log remains authoritative. This SQLite sidecar only stores the
 * final usage samples produced by foldSessionUsage for one source revision;
 * it is disposable derived data and is rebuilt per changed session.
 */

import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { UsageQueryRequest, UsageSnapshot } from './client-contract.ts'
import { foldSessionUsage, type StepUsage } from './fold.ts'
import { mapPool, resolveWorkspace, type SessionCorpus, type CorpusSession, type WorkspaceIndex } from './collect.ts'
import { BUILTIN_PRICING, type PricingTable } from './pricing.ts'
import { queryUsage } from './query.ts'

const PROJECTION_VERSION = 1

interface RebuildResult {
  session: CorpusSession
  steps?: readonly StepUsage[]
}

export interface UsageProjectionInput {
  corpus: SessionCorpus
  workspaces: WorkspaceIndex
  query: UsageQueryRequest
  pricing?: PricingTable
  concurrency?: number
}

/** Default plugin-owned sidecar path for the active DSH home. */
export function defaultUsageProjectionPath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-usage-monitor.sqlite')
}

/**
 * Reconcile source revisions into a durable final-sample index, then answer a
 * time window from indexed rows. The source adapter stays behind SessionCorpus;
 * callers only provide a corpus, workspace view, and range.
 */
export class UsageProjection {
  private readonly db: DatabaseSync
  private refreshPromise: Promise<void> | undefined
  /** Number of reconciliation requests observed by callers. */
  private refreshRequested = 0
  /** Number of requests covered by completed passes. */
  private refreshCompleted = 0
  private sessions = new Map<string, CorpusSession>()
  private volatile = new Map<string, readonly StepUsage[]>()
  private closed = false

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec([
      'PRAGMA journal_mode = WAL',
      'CREATE TABLE IF NOT EXISTS usage_projection_sessions (id TEXT PRIMARY KEY, revision TEXT NOT NULL, projection_version INTEGER NOT NULL, complete INTEGER NOT NULL CHECK (complete IN (0, 1))) STRICT',
      'CREATE TABLE IF NOT EXISTS usage_projection_steps (session_id TEXT NOT NULL, ordinal INTEGER NOT NULL, time INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, workspace_id TEXT NOT NULL, workspace_title TEXT NOT NULL, uncached_input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL, PRIMARY KEY (session_id, ordinal)) STRICT',
      'CREATE INDEX IF NOT EXISTS usage_projection_steps_time ON usage_projection_steps (time)',
    ].join(';'))
  }

  async query(input: UsageProjectionInput): Promise<UsageSnapshot> {
    await this.reconcile(input.corpus, input.workspaces, input.concurrency ?? 8)
    const steps = this.readIndexedSteps(input.query, input.workspaces.list())
    return queryUsage({
      steps,
      start: input.query.start,
      end: input.query.end,
      pricing: input.pricing ?? BUILTIN_PRICING,
    })
  }

  /**
   * Rebuild only missing/changed source revisions. Concurrent callers share
   * work, but every caller arriving during a pass also forces one follow-up
   * listing so a live revision that advanced during the read is not hidden by
   * the earlier pass.
   */
  async reconcile(corpus: SessionCorpus, workspaces: WorkspaceIndex, concurrency: number): Promise<void> {
    if (this.closed) throw new Error('usage projection is closed')
    ++this.refreshRequested
    while (this.refreshCompleted < this.refreshRequested) {
      const pending = this.refreshPromise
      if (pending !== undefined) {
        await pending
        continue
      }
      const passTarget = this.refreshRequested
      const next = this.reconcileNow(corpus, workspaces, concurrency)
      this.refreshPromise = next
      try {
        await next
        this.refreshCompleted = Math.max(this.refreshCompleted, passTarget)
      } finally {
        if (this.refreshPromise === next) this.refreshPromise = undefined
      }
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  private async reconcileNow(corpus: SessionCorpus, workspaces: WorkspaceIndex, concurrency: number): Promise<void> {
    const sessions = await corpus.listSessions()
    const sessionMap = new Map(sessions.map(session => [session.id, session]))
    this.sessions = sessionMap
    const indexed = new Map<string, string>()
    for (const row of this.db.prepare(
      'SELECT id, revision FROM usage_projection_sessions WHERE projection_version = ? AND complete = 1',
    ).all(PROJECTION_VERSION) as Array<{ id: string, revision: string }>) {
      indexed.set(row.id, row.revision)
    }

    const rebuild = sessions.filter(session =>
      session.revision === undefined || indexed.get(session.id) !== session.revision,
    )
    const results = await mapPool(rebuild, Math.max(1, concurrency), async (session): Promise<RebuildResult> => {
      try {
        const workspace = resolveWorkspace(workspaces.list(), session.id, session.cwd)
        const events = await corpus.readEvents(session.id)
        return {
          session,
          steps: foldSessionUsage({
            sessionId: session.id,
            workspaceId: workspace.id,
            workspaceTitle: workspace.title,
            events,
          }),
        }
      } catch {
        // A failed or unsupported source is never represented by stale rows.
        return { session }
      }
    })

    const persistentIds = new Set(sessions
      .filter(session => session.revision !== undefined)
      .map(session => session.id))
    const existingIds = (this.db.prepare(
      'SELECT id FROM usage_projection_sessions',
    ).all() as Array<{ id: string }>).map(row => row.id)
    const replace = this.db.prepare(
      'INSERT INTO usage_projection_sessions (id, revision, projection_version, complete) VALUES (?, ?, ?, 1)',
    )
    const deleteSteps = this.db.prepare('DELETE FROM usage_projection_steps WHERE session_id = ?')
    const deleteSession = this.db.prepare('DELETE FROM usage_projection_sessions WHERE id = ?')
    const insertStep = this.db.prepare(
      'INSERT INTO usage_projection_steps (session_id, ordinal, time, provider, model, workspace_id, workspace_title, uncached_input_tokens, output_tokens, cache_read_tokens, cache_write_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )

    this.db.exec('BEGIN')
    try {
      for (const id of existingIds) {
        if (!persistentIds.has(id)) {
          deleteSteps.run(id)
          deleteSession.run(id)
        }
      }
      for (const result of results) {
        const { session, steps } = result
        if (session.revision === undefined) continue
        deleteSteps.run(session.id)
        deleteSession.run(session.id)
        if (steps === undefined) continue
        replace.run(session.id, session.revision, PROJECTION_VERSION)
        steps.forEach((step, ordinal) => {
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
        })
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    this.volatile = new Map(
      results
        .filter(result => result.session.revision === undefined && result.steps !== undefined)
        .map(result => [result.session.id, result.steps ?? []]),
    )
  }

  private readIndexedSteps(
    query: UsageQueryRequest,
    workspaces: readonly ReturnType<WorkspaceIndex['list']>[number][],
  ): StepUsage[] {
    const rows = this.db.prepare(
      'SELECT session_id, time, provider, model, workspace_id, workspace_title, uncached_input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM usage_projection_steps WHERE time >= ? AND time < ? ORDER BY time, session_id, ordinal',
    ).all(query.start, query.end) as Array<Record<string, string | number>>
    const steps: StepUsage[] = []
    for (const row of rows) {
      const session = this.sessions.get(String(row.session_id))
      if (!this.sessionCanContribute(session, query.end)) continue
      steps.push(this.restoreStep(row, workspaces))
    }
    for (const [sessionId, volatileSteps] of this.volatile) {
      const session = this.sessions.get(sessionId)
      if (!this.sessionCanContribute(session, query.end)) continue
      const workspace = session === undefined
        ? undefined
        : resolveWorkspace(workspaces, session.id, session.cwd)
      for (const step of volatileSteps) {
        if (step.time < query.start || step.time >= query.end) continue
        steps.push(workspace === undefined ? step : { ...step, workspaceId: workspace.id, workspaceTitle: workspace.title })
      }
    }
    return steps
  }

  private sessionCanContribute(session: CorpusSession | undefined, end: number): boolean {
    return session === undefined || session.createdAt === undefined || session.createdAt < end
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
