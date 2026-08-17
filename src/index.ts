/**
 * Host face: fold session logs and serve a loopback usage snapshot RPC.
 * @module dsh-usage-monitor
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import {
  USAGE_QUERY_ENDPOINT,
  USAGE_RPC_CHANNEL,
  decodeUsageQueryRequest,
} from './client-contract.ts'
import type { UsageQueryRequest, UsageSnapshot } from './client-contract.ts'
import { FoldCache, collectUsage, type SessionCorpus, type WorkspaceIndex } from './collect.ts'
import type { FoldableEvent } from './fold.ts'

export {
  USAGE_RPC_CHANNEL,
  USAGE_QUERY_ENDPOINT,
  decodeUsageQueryRequest,
  decodeUsageSnapshot,
} from './client-contract.ts'
export type { UsageEvent, UsageQueryRequest, UsageSnapshot, UsageSummary } from './client-contract.ts'
export { foldSessionUsage } from './fold.ts'
export { FoldCache, collectUsage, resolveWorkspace } from './collect.ts'
export { queryUsage } from './query.ts'
export { estimateCost, lookupPricing, BUILTIN_PRICING } from './pricing.ts'
export { buildStackedSeries, breakdownOf, breakdownRows, niceMax } from './chart.ts'

export const name = 'dsh-usage-monitor'
export const inject = ['sessionQuery', 'workspaceRegistry', 'sessionPersistence']

const READ_CONCURRENCY = 8
export const READ_BUDGET_MS = 20_000
const WARM_LOOKBACK_MS = 32 * 24 * 60 * 60 * 1000

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
  listSnapshots(signal?: AbortSignal): Promise<Array<{
    header: SessionHeaderLike
    revision: unknown
  }>>
  readFrom?(id: unknown, fromSeq: number, signal?: AbortSignal): Promise<{ events: readonly FoldableEvent[] }>
  inspect?(id: unknown, signal?: AbortSignal): Promise<{ events: readonly FoldableEvent[] }>
}

interface LiveSessionLike {
  id: unknown
  seq: number
  events: readonly FoldableEvent[]
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

async function readPersistedEvents(
  persistence: PersistenceLike,
  sessionId: string,
): Promise<readonly FoldableEvent[]> {
  return withBudget(READ_BUDGET_MS, async (signal) => {
    if (persistence.readFrom !== undefined) {
      return (await persistence.readFrom(sessionId, 0, signal)).events
    }
    if (persistence.inspect !== undefined) {
      return (await persistence.inspect(sessionId, signal)).events
    }
    return []
  }, 'session read timed out')
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
        const [records, snapshots] = await Promise.all([
          sessionQuery.listSessions(signal),
          persistence.listSnapshots(signal).catch(() => []),
        ])
        const revisionById = new Map(
          snapshots.map(snapshot => [String(snapshot.header.id), String(snapshot.revision)]),
        )
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
      if (live !== undefined) return live.events
      return readPersistedEvents(persistence, sessionId)
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
export function apply(ctx: Context): void {
  const sessionQuery = ctx.get('sessionQuery') as SessionQueryLike
  const workspaceRegistry = ctx.get('workspaceRegistry') as WorkspaceRegistryLike
  const persistence = ctx.get('sessionPersistence') as PersistenceLike
  const cache = new FoldCache()
  const inflight = new Map<string, Promise<UsageSnapshot>>()
  const collect = (query: UsageQueryRequest) => {
    const key = `${query.start}:${query.end}`
    const pending = inflight.get(key)
    if (pending !== undefined) return pending
    const next = collectUsage({
      corpus: corpusFrom(
        sessionQuery,
        persistence,
        () => ctx.get('sessions') as SessionStoreLike | undefined,
      ),
      workspaces: workspacesFrom(workspaceRegistry),
      query,
      cache,
      concurrency: READ_CONCURRENCY,
    }).finally(() => {
      inflight.delete(key)
    })
    inflight.set(key, next)
    return next
  }

  void collect({
    start: Date.now() - WARM_LOOKBACK_MS,
    end: Date.now() + 24 * 60 * 60 * 1000,
  }).catch(() => undefined)

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.rpc.handle(
      USAGE_RPC_CHANNEL,
      createUsageRpcHandler({ collect }),
      { authority: 'loopback' },
    )
  })
}
