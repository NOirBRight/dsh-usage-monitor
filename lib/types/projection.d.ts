/**
 * Durable, revision-aware final-usage projection for exact range queries.
 *
 * Source logs remain authoritative. The SQLite sidecar stores only complete
 * folds for the current projection version; changed sessions are replaced in
 * bounded transactions and failed replacements are made visibly incomplete.
 */
import type { UsageQueryRequest, UsageSnapshot } from './client-contract.ts';
import { type SessionCorpus, type WorkspaceIndex } from './collect.ts';
import { type PricingTable } from './pricing.ts';
/** Default number of session logs read concurrently. */
export declare const DEFAULT_PROJECTION_READ_CONCURRENCY = 1;
/** Default number of sessions committed by one SQLite transaction. */
export declare const DEFAULT_PROJECTION_TRANSACTION_BATCH_SIZE = 8;
interface ReconcileRequest {
    corpus: SessionCorpus;
    workspaces: WorkspaceIndex;
    end: number;
    readConcurrency: number;
    transactionBatchSize: number;
}
export interface UsageProjectionInput {
    corpus: SessionCorpus;
    workspaces: WorkspaceIndex;
    query: UsageQueryRequest;
    pricing?: PricingTable;
    readConcurrency?: number;
    transactionBatchSize?: number;
}
/** Default plugin-owned sidecar path for the active DSH home. */
export declare function defaultUsageProjectionPath(): string;
/**
 * Reconcile source revisions through one shared worker, then answer windows
 * only from complete rows. Disposal rejects new work and waits for active
 * queries before closing SQLite.
 */
export declare class UsageProjection {
    private readonly db;
    private workerPromise;
    private refreshRequested;
    private refreshCompleted;
    private pendingEnd;
    private latestRequest;
    private sessions;
    private volatile;
    private accepting;
    private activeQueries;
    private idleWaiters;
    private closePromise;
    private checkpointNeeded;
    constructor(path: string);
    /** Reconcile every potentially relevant session before returning the range. */
    query(input: UsageProjectionInput): Promise<UsageSnapshot>;
    /**
     * Join the shared reconciliation worker. A request arriving during a pass is
     * assigned a later ticket, which forces a follow-up source listing.
     */
    reconcile(request: ReconcileRequest): Promise<void>;
    /** Stop accepting queries and close SQLite after every active query settles. */
    close(): Promise<void>;
    private runWorker;
    private reconcileUntilStable;
    private sessionSignature;
    private reconcileListing;
    private removeDeletedSessions;
    private commitBatch;
    private markBatchStale;
    private readIndexedSteps;
    private sessionCanContribute;
    private restoreStep;
}
export {};
//# sourceMappingURL=projection.d.ts.map