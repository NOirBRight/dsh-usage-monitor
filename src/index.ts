/**
 * Host face: fold session logs and serve a loopback usage snapshot RPC.
 * @module dsh-usage-monitor
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import {
  USAGE_QUERY_ENDPOINT,
  USAGE_RPC_CHANNEL,
  decodeUsageQueryRequest,
} from './client-contract.ts'
import { stat } from 'node:fs/promises'
import type { UsageQueryRequest, UsageSnapshot } from './client-contract.ts'
import type { SessionCorpus, WorkspaceIndex } from './collect.ts'
import {
  DEFAULT_PROJECTION_READ_CONCURRENCY,
  DEFAULT_PROJECTION_TRANSACTION_BATCH_SIZE,
  UsageProjection,
  defaultUsageProjectionPath,
} from './projection.ts'
import {
  foldRawSessionUsage,
  foldSessionUsage,
  parseRawFoldableEvent,
  type FoldableEvent,
  type FoldSessionStamp,
  type StepUsage,
} from './fold.ts'

export {
  USAGE_RPC_CHANNEL,
  USAGE_QUERY_ENDPOINT,
  decodeUsageQueryRequest,
  decodeUsageSnapshot,
} from './client-contract.ts'
export type { UsageEvent, UsageQueryRequest, UsageSnapshot, UsageSummary } from './client-contract.ts'
export { foldRawSessionUsage, foldSessionUsage } from './fold.ts'
export { FoldCache, collectUsage, resolveWorkspace } from './collect.ts'
export { UsageProjection, defaultUsageProjectionPath } from './projection.ts'
export type { UsageProjectionInput, UsageProjectionReconcileInput } from './projection.ts'
export { queryUsage } from './query.ts'
export { estimateCost, lookupPricing, BUILTIN_PRICING } from './pricing.ts'
export { buildStackedSeries, breakdownOf, breakdownRows, niceMax } from './chart.ts'

export const name = 'dsh-usage-monitor'
export const inject = ['sessionQuery', 'workspaceRegistry', 'sessionPersistence']

export const READ_BUDGET_MS = 20_000

/** Usage projection plugin configuration. */
export interface Config {
  /** Projection work begins only when an RPC needs an exact range. */
  projectionWarmup: 'on-demand'
  /** Maximum session logs read concurrently. */
  projectionReadConcurrency: number
  /** Maximum sessions replaced by one SQLite transaction. */
  projectionTransactionBatchSize: number
}

const DEFAULT_CONFIG: Config = {
  projectionWarmup: 'on-demand',
  projectionReadConcurrency: DEFAULT_PROJECTION_READ_CONCURRENCY,
  projectionTransactionBatchSize: DEFAULT_PROJECTION_TRANSACTION_BATCH_SIZE,
}

const configIssue = (message: string, key?: keyof Config) => ({
  message,
  ...(key === undefined ? {} : { path: [key] }),
})

/** Standard Schema validator that accepts an omitted plugin config and applies bounded on-demand defaults. */
export const Config = {
  '~standard': {
    version: 1 as const,
    vendor: 'dsh-usage-monitor',
    validate(value: unknown) {
      if (value === undefined) value = {}
      if (!isRecord(value)) return { issues: [configIssue('expected an object')] }
      const projectionWarmup = value.projectionWarmup ?? DEFAULT_CONFIG.projectionWarmup
      const projectionReadConcurrency = value.projectionReadConcurrency ?? DEFAULT_CONFIG.projectionReadConcurrency
      const projectionTransactionBatchSize = value.projectionTransactionBatchSize
        ?? DEFAULT_CONFIG.projectionTransactionBatchSize
      const issues = []
      if (projectionWarmup !== 'on-demand') {
        issues.push(configIssue("must be 'on-demand'", 'projectionWarmup'))
      }
      if (!Number.isSafeInteger(projectionReadConcurrency) || Number(projectionReadConcurrency) < 1) {
        issues.push(configIssue('must be a positive safe integer', 'projectionReadConcurrency'))
      }
      if (!Number.isSafeInteger(projectionTransactionBatchSize) || Number(projectionTransactionBatchSize) < 1) {
        issues.push(configIssue('must be a positive safe integer', 'projectionTransactionBatchSize'))
      }
      if (issues.length > 0) return { issues }
      return {
        value: {
          projectionWarmup: 'on-demand',
          projectionReadConcurrency: Number(projectionReadConcurrency),
          projectionTransactionBatchSize: Number(projectionTransactionBatchSize),
        } satisfies Config,
      }
    },
  },
}

function internalError(message: string) {
  return {
    ok: false as const,
    error: {
      code: 'internal' as const,
      message,
      details: {},
    },
  }
}

const abortAsError = (signal: AbortSignal): Promise<never> => new Promise((_, reject) => {
  if (signal.aborted) {
    reject(new Error('aborted'))
    return
  }
  signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
})

async function withBudget<T>(
  budgetMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  timedOut: string,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(timedOut))
    }, budgetMs)
  })
  const work = run(controller.signal)
  void work.catch(() => undefined)
  void timeout.catch(() => undefined)
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export interface UsageRpcDeps {
  collect: (query: UsageQueryRequest) => Promise<UsageSnapshot>
}

/** Dispatch the usage-monitor RPC. */
export function createUsageRpcHandler(deps: UsageRpcDeps): ConnectionRpcHandler {
  return async (endpoint, payload, signal) => {
    if (endpoint !== USAGE_QUERY_ENDPOINT) return internalError(`unknown usage endpoint: ${endpoint}`)
    const query = decodeUsageQueryRequest(payload)
    if (query === undefined) return internalError('invalid usage query')
    try {
      const work = deps.collect(query)
      void work.catch(() => undefined)
      const cancelled = abortAsError(signal)
      void cancelled.catch(() => undefined)
      const value = await Promise.race([work, cancelled])
      return { ok: true as const, value }
    } catch {
      return internalError(signal.aborted ? 'usage query cancelled' : 'usage query failed')
    }
  }
}

interface SessionHeaderLike {
  id: unknown
  cwd?: string
  createdAt?: number
}

interface SessionQueryLike {
  listSessions(signal?: AbortSignal): Promise<Array<{
    header: SessionHeaderLike
    live?: boolean
  }>>
}

interface PersistenceLike {
  listSnapshots?(signal?: AbortSignal): Promise<Array<{
    header: SessionHeaderLike
    revision: unknown
  }>>
  locate?(meta: SessionHeaderLike): { path: string } | undefined
  readFrom?(id: ReturnType<typeof SessionId>, fromSeq: ReturnType<typeof SessionLogOffset>, signal?: AbortSignal): Promise<{ events: readonly FoldableEvent[] }>
  inspect?(id: ReturnType<typeof SessionId>, signal?: AbortSignal): Promise<{ events: readonly FoldableEvent[] }>
  readRaw?(id: ReturnType<typeof SessionId>, signal?: AbortSignal): Promise<{ content: string } | undefined>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Parse one raw artifact's text into foldable events. The backend hands back
 * the stored bytes verbatim — including the header line and event types this
 * host does not validate — so every line must fend for itself: unparseable
 * lines and records without a string `type` plus finite numeric `time` are
 * skipped rather than rejected.
 */
export function parseRawEvents(content: string): readonly FoldableEvent[] {
  const events: FoldableEvent[] = []
  let start = 0
  while (start <= content.length) {
    const newline = content.indexOf('\n', start)
    const end = newline === -1 ? content.length : newline
    if (end > start) {
      const event = parseRawFoldableEvent(content.slice(start, end))
      if (event !== undefined) events.push(event)
    }
    if (newline === -1) break
    start = newline + 1
  }
  return events
}

interface LiveSessionLike {
  id: unknown
  seq: number
  snapshotEvents(): readonly FoldableEvent[]
  header: SessionHeaderLike
}

interface SessionStoreLike {
  get(id: unknown): LiveSessionLike | undefined
  list(): readonly LiveSessionLike[]
}

interface WorkspaceLike {
  id: unknown
  title: string
  path: string
  sessionIds: readonly unknown[]
}

interface WorkspaceRegistryLike {
  list(): readonly WorkspaceLike[]
}

const findLive = (
  sessions: SessionStoreLike | undefined,
  sessionId: string,
): LiveSessionLike | undefined =>
  sessions?.list()?.find(session => String(session.id) === sessionId)
  ?? sessions?.get(sessionId)

/**
 * Read one persisted session's events. The raw-artifact path comes first: it
 * skips the host's strict event validation, so sessions carrying event types
 * unknown to this build still fold instead of failing their read outright —
 * a failed read is never cached and would be retried on every single query.
 */
async function readPersistedEvents(
  persistence: PersistenceLike,
  sessionId: string,
): Promise<readonly FoldableEvent[]> {
  return withBudget(READ_BUDGET_MS, async (signal) => {
    const id = SessionId(sessionId)
    if (persistence.readRaw !== undefined) {
      const raw = await persistence.readRaw(id, signal)
      if (raw !== undefined) return parseRawEvents(raw.content)
    }
    if (persistence.readFrom !== undefined) {
      return (await persistence.readFrom(id, SessionLogOffset(0), signal)).events
    }
    if (persistence.inspect !== undefined) {
      return (await persistence.inspect(id, signal)).events
    }
    return []
  }, 'session read timed out')
}

async function foldPersistedSession(
  persistence: PersistenceLike,
  stamp: FoldSessionStamp,
): Promise<readonly StepUsage[]> {
  return withBudget(READ_BUDGET_MS, async (signal) => {
    const id = SessionId(stamp.sessionId)
    if (persistence.readRaw !== undefined) {
      const raw = await persistence.readRaw(id, signal)
      if (raw !== undefined) return foldRawSessionUsage({ ...stamp, content: raw.content })
    }
    if (persistence.readFrom !== undefined) {
      const events = (await persistence.readFrom(id, SessionLogOffset(0), signal)).events
      return foldSessionUsage({ ...stamp, events })
    }
    if (persistence.inspect !== undefined) {
      const events = (await persistence.inspect(id, signal)).events
      return foldSessionUsage({ ...stamp, events })
    }
    return []
  }, 'session read timed out')
}

/**
 * Build the session-id → cache-revision index. The backend's own snapshot
 * listing wins; when that rejects — one malformed artifact poisons the whole
 * listing — fall back to stat-ing each located artifact so unchanged sessions
 * keep hitting the fold cache.
 */
async function resolveRevisionIndex(
  persistence: PersistenceLike,
  records: readonly { header: SessionHeaderLike }[],
  signal: AbortSignal,
): Promise<Map<string, string>> {
  if (persistence.listSnapshots !== undefined) {
    const snapshots = await persistence.listSnapshots(signal).catch(() => undefined)
    if (snapshots !== undefined) {
      return new Map(snapshots.map(snapshot => [String(snapshot.header.id), String(snapshot.revision)]))
    }
  }
  const revisions = new Map<string, string>()
  if (persistence.locate === undefined) return revisions
  for (const record of records) {
    signal.throwIfAborted()
    try {
      const location = persistence.locate(record.header)
      if (location === undefined) continue
      const info = await stat(location.path, { bigint: true })
      revisions.set(String(record.header.id), `${info.size}:${info.mtimeNs}`)
    } catch {
      // Absent artifact or unusable location: leave the session revision-less.
    }
  }
  return revisions
}

export function corpusFrom(
  sessionQuery: SessionQueryLike,
  persistence: PersistenceLike,
  sessions: (() => SessionStoreLike | undefined) | SessionStoreLike | undefined,
): SessionCorpus {
  const getSessions = typeof sessions === 'function' ? sessions : () => sessions
  return {
    async listSessions() {
      const store = getSessions()
      return withBudget(READ_BUDGET_MS, async (signal) => {
        const records = await sessionQuery.listSessions(signal)
        const revisionById = await resolveRevisionIndex(persistence, records, signal)
        return records.map(record => {
          const id = String(record.header.id)
          const live = record.live === true ? findLive(store, id) : undefined
          const revision = live !== undefined
            ? `live:${live.seq}`
            : revisionById.get(id)
          return {
            id,
            ...record.header.cwd === undefined ? {} : { cwd: record.header.cwd },
            ...record.header.createdAt === undefined ? {} : { createdAt: record.header.createdAt },
            ...revision === undefined ? {} : { revision },
          }
        })
      }, 'session list timed out')
    },
    async readEvents(sessionId) {
      const live = findLive(getSessions(), sessionId)
      if (live !== undefined) return live.snapshotEvents()
      return readPersistedEvents(persistence, sessionId)
    },
    async foldSession(stamp) {
      const live = findLive(getSessions(), stamp.sessionId)
      if (live !== undefined) return foldSessionUsage({ ...stamp, events: live.snapshotEvents() })
      return foldPersistedSession(persistence, stamp)
    },
  }
}

export function workspacesFrom(registry: WorkspaceRegistryLike): WorkspaceIndex {
  return {
    list: () => registry.list().map(workspace => ({
      id: String(workspace.id),
      title: workspace.title,
      path: workspace.path,
      sessionIds: workspace.sessionIds.map(id => String(id)),
    })),
  }
}

/** Register the loopback `/usage-monitor` channel. */

/** Register the loopback `/usage-monitor` channel without reading history. */
export function apply(ctx: Context, config: Config = DEFAULT_CONFIG): void {
  const sessionQuery = ctx.get('sessionQuery') as SessionQueryLike
  const workspaceRegistry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike
  const persistence = ctx.get('sessionPersistence') as PersistenceLike
  const corpus = corpusFrom(
    sessionQuery,
    persistence,
    () => ctx.get('sessions') as SessionStoreLike | undefined,
  )
  const workspaces = workspacesFrom(workspaceRegistry)
  const projection = new UsageProjection(defaultUsageProjectionPath())
  ctx.effect(() => async () => projection.close(), 'dsh-usage-monitor: close usage projection')
  const inflight = new Map<string, Promise<UsageSnapshot>>()
  const collect = (query: UsageQueryRequest) => {
    const key = `${query.start}:${query.end}`
    const pending = inflight.get(key)
    if (pending !== undefined) return pending
    const next = projection.query({
      corpus,
      workspaces,
      query,
      readConcurrency: config.projectionReadConcurrency,
      transactionBatchSize: config.projectionTransactionBatchSize,
    }).finally(() => {
      inflight.delete(key)
    })
    inflight.set(key, next)
    return next
  }

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      USAGE_RPC_CHANNEL,
      createUsageRpcHandler({ collect }),
    )
  })
}
