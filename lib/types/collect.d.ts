/**
 * Walk a session corpus, fold each log, and answer a usage window.
 */
import type { UsageQueryRequest, UsageSnapshot } from './client-contract.ts';
import { type FoldableEvent, type FoldSessionStamp, type StepUsage } from './fold.ts';
import { type PricingTable } from './pricing.ts';
export interface CorpusSession {
    id: string;
    cwd?: string;
    createdAt?: number;
    revision?: string;
}
export interface CorpusWorkspace {
    id: string;
    title: string;
    path: string;
    sessionIds: readonly string[];
}
export interface SessionCorpus {
    listSessions(): Promise<readonly CorpusSession[]>;
    readEvents(sessionId: string): Promise<readonly FoldableEvent[]>;
    foldSession?(stamp: FoldSessionStamp): Promise<readonly StepUsage[]>;
}
export interface WorkspaceIndex {
    list(): readonly CorpusWorkspace[];
}
export declare const UNKNOWN_WORKSPACE_ID = "unknown";
export declare const UNKNOWN_WORKSPACE_TITLE = "Unknown";
/**
 * Cache capacity must cover the whole session working set. A corpus larger
 * than the limit evicts entries mid-pass, so every query re-reads and re-folds
 * the same tail of full session logs from disk (seconds to minutes on real
 * homes). Fold rows are small step aggregates, so sizing for thousands of
 * sessions costs little memory.
 */
export declare const FOLD_CACHE_LIMIT = 4096;
/** In-memory fold cache keyed by session id + persistence revision. */
export declare class FoldCache {
    private readonly limit;
    private readonly rows;
    private readonly pending;
    constructor(limit?: number);
    get(id: string, revision: string | undefined): readonly StepUsage[] | undefined;
    set(id: string, revision: string, steps: readonly StepUsage[]): void;
    /**
     * Exact revision hit, else stale-while-revalidate, else load.
     * Failed loads are not stored.
     */
    getOrLoad(id: string, revision: string | undefined, load: () => Promise<readonly StepUsage[]>): Promise<readonly StepUsage[]>;
}
/** Resolve a session to a workspace by membership, then by cwd path / prefix. */
export declare function resolveWorkspace(workspaces: readonly CorpusWorkspace[], sessionId: string, cwd: string | undefined): {
    id: string;
    title: string;
};
export interface CollectUsageInput {
    corpus: SessionCorpus;
    workspaces: WorkspaceIndex;
    query: UsageQueryRequest;
    pricing?: PricingTable;
    cache?: FoldCache;
    concurrency?: number;
}
/** Fold one corpus session through its raw-aware adapter when available. */
export declare function foldCorpusSession(corpus: SessionCorpus, stamp: FoldSessionStamp): Promise<readonly StepUsage[]>;
export declare function mapPool<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]>;
/** Fold every session and return the windowed snapshot. */
export declare function collectUsage(input: CollectUsageInput): Promise<UsageSnapshot>;
//# sourceMappingURL=collect.d.ts.map