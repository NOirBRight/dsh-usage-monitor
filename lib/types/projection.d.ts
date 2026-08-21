/**
 * Durable final-usage projection for range queries.
 *
 * The source log remains authoritative. This SQLite sidecar only stores the
 * final usage samples produced by foldSessionUsage for one source revision;
 * it is disposable derived data and is rebuilt per changed session.
 */
import type { UsageQueryRequest, UsageSnapshot } from './client-contract.ts';
import { type SessionCorpus, type WorkspaceIndex } from './collect.ts';
import { type PricingTable } from './pricing.ts';
export interface UsageProjectionInput {
    corpus: SessionCorpus;
    workspaces: WorkspaceIndex;
    query: UsageQueryRequest;
    pricing?: PricingTable;
    concurrency?: number;
}
/** Default plugin-owned sidecar path for the active DSH home. */
export declare function defaultUsageProjectionPath(): string;
/**
 * Reconcile source revisions into a durable final-sample index, then answer a
 * time window from indexed rows. The source adapter stays behind SessionCorpus;
 * callers only provide a corpus, workspace view, and range.
 */
export declare class UsageProjection {
    private readonly db;
    private refreshPromise;
    /** Number of reconciliation requests observed by callers. */
    private refreshRequested;
    /** Number of requests covered by completed passes. */
    private refreshCompleted;
    private sessions;
    private volatile;
    private closed;
    constructor(path: string);
    query(input: UsageProjectionInput): Promise<UsageSnapshot>;
    /**
     * Rebuild only missing/changed source revisions. Concurrent callers share
     * work, but every caller arriving during a pass also forces one follow-up
     * listing so a live revision that advanced during the read is not hidden by
     * the earlier pass.
     */
    reconcile(corpus: SessionCorpus, workspaces: WorkspaceIndex, concurrency: number): Promise<void>;
    close(): void;
    private reconcileNow;
    private readIndexedSteps;
    private sessionCanContribute;
    private restoreStep;
}
//# sourceMappingURL=projection.d.ts.map