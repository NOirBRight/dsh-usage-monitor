/**
 * Host face: fold session logs and serve a loopback usage snapshot RPC.
 * @module dsh-usage-monitor
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  SessionAccess,
  SessionHandle,
  SessionPersistenceListOptions,
  SessionPersistenceOpenOptions,
  SessionPersistenceSnapshot,
  SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'
import {
  USAGE_QUERY_ENDPOINT,
  USAGE_RPC_CHANNEL,
  decodeUsageQueryRequest,
} from './client-contract.ts'
import { allowDshRuntime } from './compatibility.ts'
import type { UsageQueryRequest, UsageSnapshot } from './client-contract.ts'
import type { SessionCorpus, WorkspaceIndex } from './collect.ts'
import {
  DEFAULT_PROJECTION_READ_CONCURRENCY,
  DEFAULT_PROJECTION_TRANSACTION_BATCH_SIZE,
  UsageProjection,
  defaultUsageProjectionPath,
} from './projection.ts'
import {
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

/**
 * Handle-based persistence surface used for cold reads. Mirrors the target
 * SessionPersistence public API (open/read/close plus list, and optional
 * stat): a `read` handle never takes write ownership, so cold reads work
 * while another handle or process holds the write lock, and every opened
 * handle is closed on a determined finally path. Production fold-cache
 * revisions come from `list()` only; `stat` remains on the Host seam for
 * callers that need a single-id probe but is not required for the cache
 * path. There is no probing fallback: a missing method is a backend
 * incompatibility, and a failed read propagates instead of folding as an
 * empty log (missing must not read as zero, partial must not read as
 * complete).
 */
export interface ColdReadPersistence {
  open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle>
  stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined>
  list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]>
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
 * Read one persisted session's validated events through a read handle. The
 * handle is always closed; backend failures (missing session, refused
 * vocabulary, torn reads) propagate to the caller and are never cached as
 * folds, so the next query retries them instead of trusting a fake empty log.
 */
async function readPersistedEvents(
  persistence: ColdReadPersistence,
  sessionId: string,
): Promise<readonly FoldableEvent[]> {
  return withBudget(READ_BUDGET_MS, async (signal) => {
    const handle = await persistence.open(SessionId(sessionId), 'read', { signal })
    try {
      return (await handle.read(0, undefined, { signal })).events
    } finally {
      await handle.close()
    }
  }, 'session read timed out')
}

async function foldPersistedSession(
  persistence: ColdReadPersistence,
  stamp: FoldSessionStamp,
): Promise<readonly StepUsage[]> {
  return withBudget(READ_BUDGET_MS, async (signal) => {
    const handle = await persistence.open(SessionId(stamp.sessionId), 'read', { signal })
    try {
      const events = (await handle.read(0, undefined, { signal })).events
      return foldSessionUsage({ ...stamp, events })
    } finally {
      await handle.close()
    }
  }, 'session read timed out')
}

/**
 * Build the session-id → cache-revision index from one target listing. When
 * the listing rejects, every session reads revision-less (a cache miss that
 * re-reads) rather than inheriting a stale or fabricated revision.
 */
async function resolveRevisionIndex(
  persistence: ColdReadPersistence,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const snapshots = await persistence.list({ signal }).catch(() => undefined)
  if (snapshots === undefined) return new Map()
  return new Map(snapshots.map(snapshot => [String(snapshot.header.id), String(snapshot.revision)]))
}

export function corpusFrom(
  sessionQuery: SessionQueryLike,
  persistence: ColdReadPersistence,
  sessions: (() => SessionStoreLike | undefined) | SessionStoreLike | undefined,
): SessionCorpus {
  const getSessions = typeof sessions === 'function' ? sessions : () => sessions
  return {
    async listSessions() {
      const store = getSessions()
      return withBudget(READ_BUDGET_MS, async (signal) => {
        const records = await sessionQuery.listSessions(signal)
        const revisionById = await resolveRevisionIndex(persistence, signal)
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
  if (!allowDshRuntime(ctx.logger, 'dsh-usage-monitor', ['@deepseek-ai/dsh-session'])) return

  const sessionQuery = ctx.get('sessionQuery') as SessionQueryLike
  const workspaceRegistry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike
  const persistence = ctx.get('sessionPersistence') as ColdReadPersistence
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
