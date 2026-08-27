/**
 * Walk a session corpus, fold each log, and answer a usage window.
 */

import type { UsageQueryRequest, UsageSnapshot } from './client-contract.ts'
import {
  foldSessionUsage,
  type FoldableEvent,
  type FoldSessionStamp,
  type StepUsage,
} from './fold.ts'
import { BUILTIN_PRICING, type PricingTable } from './pricing.ts'
import { queryUsage } from './query.ts'

export interface CorpusSession {
  id: string
  cwd?: string
  createdAt?: number
  revision?: string
}

export interface CorpusWorkspace {
  id: string
  title: string
  path: string
  sessionIds: readonly string[]
}

export interface SessionCorpus {
  listSessions(): Promise<readonly CorpusSession[]>
  readEvents(sessionId: string): Promise<readonly FoldableEvent[]>
  foldSession?(stamp: FoldSessionStamp): Promise<readonly StepUsage[]>
}

export interface WorkspaceIndex {
  list(): readonly CorpusWorkspace[]
}

export const UNKNOWN_WORKSPACE_ID = 'unknown'
export const UNKNOWN_WORKSPACE_TITLE = 'Unknown'

/**
 * Cache capacity must cover the whole session working set. A corpus larger
 * than the limit evicts entries mid-pass, so every query re-reads and re-folds
 * the same tail of full session logs from disk (seconds to minutes on real
 * homes). Fold rows are small step aggregates, so sizing for thousands of
 * sessions costs little memory.
 */
export const FOLD_CACHE_LIMIT = 4096

/** In-memory fold cache keyed by session id + persistence revision. */
export class FoldCache {
  private readonly rows = new Map<string, { revision: string, steps: readonly StepUsage[] }>()
  private readonly pending = new Map<string, Promise<readonly StepUsage[]>>()

  constructor(private readonly limit = FOLD_CACHE_LIMIT) {}

  get(id: string, revision: string | undefined): readonly StepUsage[] | undefined {
    if (revision === undefined) return undefined
    const row = this.rows.get(id)
    return row !== undefined && row.revision === revision ? row.steps : undefined
  }

  set(id: string, revision: string, steps: readonly StepUsage[]): void {
    this.rows.delete(id)
    this.rows.set(id, { revision, steps })
    while (this.rows.size > this.limit) {
      const oldest = this.rows.keys().next().value
      if (oldest === undefined) break
      this.rows.delete(oldest)
    }
  }

  /**
   * Exact revision hit, else stale-while-revalidate, else load.
   * Failed loads are not stored.
   */
  getOrLoad(
    id: string,
    revision: string | undefined,
    load: () => Promise<readonly StepUsage[]>,
  ): Promise<readonly StepUsage[]> {
    const cached = this.get(id, revision)
    if (cached !== undefined) return Promise.resolve(cached)
    const key = `${id}:${revision ?? '*'}`
    let pending = this.pending.get(key)
    if (pending === undefined) {
      pending = load()
        .then(steps => {
          if (revision !== undefined) this.set(id, revision, steps)
          return steps
        })
        .catch((): readonly StepUsage[] => this.rows.get(id)?.steps ?? [])
        .finally(() => {
          this.pending.delete(key)
        })
      this.pending.set(key, pending)
    }
    const stale = this.rows.get(id)?.steps
    if (stale !== undefined) return Promise.resolve(stale)
    return pending
  }
}

const trimSlash = (path: string): string => path.replace(/[/\\]+$/u, '')

/** Resolve a session to a workspace by membership, then by cwd path / prefix. */
export function resolveWorkspace(
  workspaces: readonly CorpusWorkspace[],
  sessionId: string,
  cwd: string | undefined,
): { id: string, title: string } {
  const byMembership = workspaces.find(workspace => workspace.sessionIds.includes(sessionId))
  if (byMembership !== undefined) return { id: byMembership.id, title: byMembership.title }
  if (cwd !== undefined && cwd.length > 0) {
    const needle = trimSlash(cwd)
    const byPath = workspaces
      .filter(workspace => {
        const root = trimSlash(workspace.path)
        return needle === root || needle.startsWith(`${root}/`) || needle.startsWith(`${root}\\`)
      })
      .sort((left, right) => trimSlash(right.path).length - trimSlash(left.path).length)[0]
    if (byPath !== undefined) return { id: byPath.id, title: byPath.title }
  }
  return { id: UNKNOWN_WORKSPACE_ID, title: UNKNOWN_WORKSPACE_TITLE }
}

export interface CollectUsageInput {
  corpus: SessionCorpus
  workspaces: WorkspaceIndex
  query: UsageQueryRequest
  pricing?: PricingTable
  cache?: FoldCache
  concurrency?: number
}

/** Fold one corpus session through its raw-aware adapter when available. */
export async function foldCorpusSession(
  corpus: SessionCorpus,
  stamp: FoldSessionStamp,
): Promise<readonly StepUsage[]> {
  if (corpus.foldSession !== undefined) return corpus.foldSession(stamp)
  const events = await corpus.readEvents(stamp.sessionId)
  return foldSessionUsage({ ...stamp, events })
}

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      if (item === undefined) continue
      results[index] = await fn(item)
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}

/** Fold every session and return the windowed snapshot. */
export async function collectUsage(input: CollectUsageInput): Promise<UsageSnapshot> {
  const sessions = await input.corpus.listSessions()
  const workspaces = input.workspaces.list()
  const inWindow = sessions.filter(session =>
    session.createdAt === undefined || session.createdAt < input.query.end)
  const foldOne = async (session: CorpusSession): Promise<readonly StepUsage[]> => {
    const workspace = resolveWorkspace(workspaces, session.id, session.cwd)
    return foldCorpusSession(input.corpus, {
      sessionId: session.id,
      workspaceId: workspace.id,
      workspaceTitle: workspace.title,
    })
  }
  const folded = await mapPool(inWindow, input.concurrency ?? 1, async (session) => {
    try {
      if (input.cache === undefined) return await foldOne(session)
      return await input.cache.getOrLoad(session.id, session.revision, () => foldOne(session))
    } catch {
      return []
    }
  })
  return queryUsage({
    steps: folded.flat(),
    start: input.query.start,
    end: input.query.end,
    pricing: input.pricing ?? BUILTIN_PRICING,
  })
}
