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
/** Direct projection reconciliation request. */
export interface UsageProjectionReconcileInput {
    /** Authoritative session source. */
    corpus: SessionCorpus;
    /** Workspace view used while folding new rows. */
    workspaces: WorkspaceIndex;
    /** Exclusive end used to skip sessions known to start later. */
    end: number;
    /** Maximum concurrent source reads. */
    readConcurrency: number;
    /** Maximum sessions committed in one transaction. */
    transactionBatchSize: number;
}
/** One exact range query against the projection. */
export interface UsageProjectionInput {
    /** Authoritative session source. */
    corpus: SessionCorpus;
    /** Current workspace view. */
    workspaces: WorkspaceIndex;
    /** Requested half-open time window. */
    query: UsageQueryRequest;
    /** Pricing table; built-in rates are used when omitted. */
    pricing?: PricingTable;
    /** Maximum concurrent source reads. */
    readConcurrency?: number;
    /** Maximum sessions committed in one transaction. */
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
    private nextTicket;
    private readonly pendingTickets;
    private accepting;
    private activeWork;
    private idleWaiters;
    private closePromise;
    private checkpointNeeded;
    constructor(path: string);
    /**
     * Reconcile every potentially relevant session before returning the range.
     * @param input - Source, workspace view, requested range, and optional bounds.
     * @returns The exact usage snapshot for `input.query`.
     */
    query(input: UsageProjectionInput): Promise<UsageSnapshot>;
    /**
     * Join the shared reconciliation worker. A request arriving during a pass is
     * assigned a later ticket, which forces a follow-up source listing.
     * @param request - Source and bounded reconciliation settings.
     * @returns Nothing after the request's stable epoch completes.
     */
    reconcile(request: UsageProjectionReconcileInput): Promise<void>;
    private enqueueReconcile;
    private ensureWorker;
    /**
     * Stop accepting work and close SQLite after every active operation settles.
     * @returns A promise that resolves after the database closes.
     */
    close(): Promise<void>;
    private runWorker;
    private reconcileUntilStable;
    private beginWork;
    private finishWork;
    private sessionSignature;
    private reconcileListing;
    private removeDeletedSessions;
    private commitBatch;
    private markBatchStale;
    private readIndexedSteps;
    private sessionCanContribute;
    private restoreStep;
}
//# sourceMappingURL=projection.d.ts.map