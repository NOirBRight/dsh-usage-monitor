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
import { artifactPathFromError, readSessionArtifact } from './artifact.ts'
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
export type { UsageProjectionHooks, UsageProjectionInput, UsageProjectionReconcileInput } from './projection.ts'
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
 * Persistence surface used for usage reads. Named `readRaw` then `inspect`
 * are the live and persisted log path. `open` / `list` / `stat` remain the
 * handle-based Target Release equivalents: a `read` handle never takes write
 * ownership and is always closed. Fold-cache revisions come from `list()`.
 *
 * When the JSONL backend exposes `resolveCurrentLog` (runtime method, not on
 * the SessionPersistence Service Definition), folds read that artifact as raw
 * JSONL so Host-unknown event types still contribute usage. Otherwise the
 * handle seam is used; a vocabulary refusal that carries a diagnostic path is
 * folded from that artifact. A host that exposes none of inspect, readRaw,
 * resolveCurrentLog, or open rejects instead of folding an empty session.
 * Missing sessions and other backend failures propagate and are never cached
 * as empty folds.
 */
export interface ColdReadPersistence {
  open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle>
  stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined>
  list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]>
  /**
   * JSONL backend current-generation artifact path, without validating event
   * vocabulary. Absent on backends that do not keep one file per session.
   */
  resolveCurrentLog?(id: SessionId, signal?: AbortSignal): Promise<string | undefined>
  /**
   * Logical event log for a live or persisted session, without taking write
   * ownership. Absent on hosts that only expose the handle seam.
   */
  inspect?(id: SessionId, signal?: AbortSignal): Promise<{ events: readonly FoldableEvent[] }>
  /**
   * Verbatim artifact text for a session. `undefined` means the artifact is
   * absent, not that the backend lacks the method.
   */
  readRaw?(id: SessionId, signal?: AbortSignal): Promise<{ content: string } | undefined>
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

type PersistedFoldSource =
  | { kind: 'raw', content: string }
  | { kind: 'events', events: readonly FoldableEvent[] }

async function resolveArtifactPath(
  persistence: ColdReadPersistence,
  sessionId: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (persistence.resolveCurrentLog === undefined) return undefined
  return persistence.resolveCurrentLog(SessionId(sessionId), signal)
}

async function withReadHandle<T>(
  persistence: ColdReadPersistence,
  sessionId: string,
  signal: AbortSignal,
  use: (handle: SessionHandle) => Promise<T>,
): Promise<T> {
  const handle = await persistence.open(SessionId(sessionId), 'read', { signal })
  try {
    return await use(handle)
  } finally {
    await handle.close()
  }
}

const PERSISTENCE_READ_REQUIRED = 'sessionPersistence.inspect, readRaw, resolveCurrentLog, or open is required'

/**
 * Prefer named `readRaw`, then `inspect`. A raw artifact is the full log, so
 * inspect is not also called when `readRaw` returns content. If the Host
 * has neither, read the JSONL current-log artifact or open a read handle. A
 * vocabulary refusal's `location.path` is a last-resort artifact path, not
 * a probe of extra APIs.
 */
async function loadPersistedFoldSource(
  persistence: ColdReadPersistence,
  sessionId: string,
): Promise<PersistedFoldSource> {
  return withBudget(READ_BUDGET_MS, async (signal) => {
    const id = SessionId(sessionId)
    const readRaw = persistence.readRaw
    const inspectSession = persistence.inspect
    if (readRaw !== undefined) {
      const raw = await readRaw(id, signal)
      if (raw !== undefined) return { kind: 'raw', content: raw.content }
    }
    if (inspectSession !== undefined) {
      try {
        return { kind: 'events' as const, events: (await inspectSession(id, signal)).events }
      } catch (error) {
        const fallback = artifactPathFromError(error)
        if (fallback !== undefined) return { kind: 'raw', content: await readSessionArtifact(fallback, signal) }
        throw error
      }
    }
    if (
      readRaw === undefined
      && inspectSession === undefined
      && persistence.resolveCurrentLog === undefined
      && typeof persistence.open !== 'function'
    ) {
      throw new Error(PERSISTENCE_READ_REQUIRED)
    }
    const path = await resolveArtifactPath(persistence, sessionId, signal)
    if (path !== undefined) return { kind: 'raw', content: await readSessionArtifact(path, signal) }
    try {
      return await withReadHandle(persistence, sessionId, signal, async (handle) => ({
        kind: 'events' as const,
        events: (await handle.read(0, undefined, { signal })).events,
      }))
    } catch (error) {
      const fallback = artifactPathFromError(error)
      if (fallback !== undefined) return { kind: 'raw', content: await readSessionArtifact(fallback, signal) }
      throw error
    }
  }, 'session read timed out')
}

async function readPersistedEvents(
  persistence: ColdReadPersistence,
  sessionId: string,
): Promise<readonly FoldableEvent[]> {
  const source = await loadPersistedFoldSource(persistence, sessionId)
  return source.kind === 'raw' ? parseRawEvents(source.content) : source.events
}

async function foldPersistedSession(
  persistence: ColdReadPersistence,
  stamp: FoldSessionStamp,
): Promise<readonly StepUsage[]> {
  const source = await loadPersistedFoldSource(persistence, stamp.sessionId)
  return source.kind === 'raw'
    ? foldRawSessionUsage({ ...stamp, content: source.content })
    : foldSessionUsage({ ...stamp, events: source.events })
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
      return readPersistedEvents(persistence, sessionId)
    },
    async foldSession(stamp) {
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
  const projection = new UsageProjection(defaultUsageProjectionPath(), {
    onSourceError: (sessionId, error) => {
      const detail = error instanceof Error ? error.message : 'unknown error'
      ctx.logger.warn(`dsh-usage-monitor: omitted session ${sessionId}: ${detail}`)
    },
  })
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
