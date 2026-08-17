/**
 * Walk a session corpus, fold each log, and answer a usage window.
 */
import type { UsageQueryRequest, UsageSnapshot } from './client-contract.ts';
import { type FoldableEvent, type StepUsage } from './fold.ts';
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
}
export interface WorkspaceIndex {
    list(): readonly CorpusWorkspace[];
}
export declare const UNKNOWN_WORKSPACE_ID = "unknown";
export declare const UNKNOWN_WORKSPACE_TITLE = "Unknown";
export declare const FOLD_CACHE_LIMIT = 512;
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
export declare function mapPool<T, R>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]>;
/** Fold every session and return the windowed snapshot. */
export declare function collectUsage(input: CollectUsageInput): Promise<UsageSnapshot>;
//# sourceMappingURL=collect.d.ts.map