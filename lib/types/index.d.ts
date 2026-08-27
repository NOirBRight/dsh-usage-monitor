/**
 * Host face: fold session logs and serve a loopback usage snapshot RPC.
 * @module dsh-usage-monitor
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection';
import type { UsageQueryRequest, UsageSnapshot } from './client-contract.ts';
import type { SessionCorpus, WorkspaceIndex } from './collect.ts';
import { type FoldableEvent } from './fold.ts';
export { USAGE_RPC_CHANNEL, USAGE_QUERY_ENDPOINT, decodeUsageQueryRequest, decodeUsageSnapshot, } from './client-contract.ts';
export type { UsageEvent, UsageQueryRequest, UsageSnapshot, UsageSummary } from './client-contract.ts';
export { foldRawSessionUsage, foldSessionUsage } from './fold.ts';
export { FoldCache, collectUsage, resolveWorkspace } from './collect.ts';
export { UsageProjection, defaultUsageProjectionPath } from './projection.ts';
export { queryUsage } from './query.ts';
export { estimateCost, lookupPricing, BUILTIN_PRICING } from './pricing.ts';
export { buildStackedSeries, breakdownOf, breakdownRows, niceMax } from './chart.ts';
export declare const name = "dsh-usage-monitor";
export declare const inject: string[];
export declare const READ_BUDGET_MS = 20000;
/** Usage projection plugin configuration. */
export interface Config {
    /** Projection work begins only when an RPC needs an exact range. */
    projectionWarmup: 'on-demand';
    /** Maximum session logs read concurrently. */
    projectionReadConcurrency: number;
    /** Maximum sessions replaced by one SQLite transaction. */
    projectionTransactionBatchSize: number;
}
/** Standard Schema validator with bounded on-demand defaults. */
export declare const Config: {
    '~standard': {
        version: 1;
        vendor: string;
        validate(value: unknown): {
            issues: {
                path?: (keyof Config)[];
                message: string;
            }[];
            value?: never;
        } | {
            value: {
                projectionWarmup: "on-demand";
                projectionReadConcurrency: number;
                projectionTransactionBatchSize: number;
            };
            issues?: never;
        };
    };
};
export interface UsageRpcDeps {
    collect: (query: UsageQueryRequest) => Promise<UsageSnapshot>;
}
/** Dispatch the usage-monitor RPC. */
export declare function createUsageRpcHandler(deps: UsageRpcDeps): ConnectionRpcHandler;
interface SessionHeaderLike {
    id: unknown;
    cwd?: string;
    createdAt?: number;
}
interface SessionQueryLike {
    listSessions(signal?: AbortSignal): Promise<Array<{
        header: SessionHeaderLike;
        live?: boolean;
    }>>;
}
interface PersistenceLike {
    listSnapshots?(signal?: AbortSignal): Promise<Array<{
        header: SessionHeaderLike;
        revision: unknown;
    }>>;
    locate?(meta: SessionHeaderLike): {
        path: string;
    } | undefined;
    readFrom?(id: unknown, fromSeq: number, signal?: AbortSignal): Promise<{
        events: readonly FoldableEvent[];
    }>;
    inspect?(id: unknown, signal?: AbortSignal): Promise<{
        events: readonly FoldableEvent[];
    }>;
    readRaw?(id: unknown, signal?: AbortSignal): Promise<{
        content: string;
    } | undefined>;
}
/**
 * Parse one raw artifact's text into foldable events. The backend hands back
 * the stored bytes verbatim — including the header line and event types this
 * host does not validate — so every line must fend for itself: unparseable
 * lines and records without a string `type` plus finite numeric `time` are
 * skipped rather than rejected.
 */
export declare function parseRawEvents(content: string): readonly FoldableEvent[];
interface LiveSessionLike {
    id: unknown;
    seq: number;
    events: readonly FoldableEvent[];
    header: SessionHeaderLike;
}
interface SessionStoreLike {
    get(id: unknown): LiveSessionLike | undefined;
    list(): readonly LiveSessionLike[];
}
interface WorkspaceLike {
    id: unknown;
    title: string;
    path: string;
    sessionIds: readonly unknown[];
}
interface WorkspaceRegistryLike {
    list(): readonly WorkspaceLike[];
}
export declare function corpusFrom(sessionQuery: SessionQueryLike, persistence: PersistenceLike, sessions: (() => SessionStoreLike | undefined) | SessionStoreLike | undefined): SessionCorpus;
export declare function workspacesFrom(registry: WorkspaceRegistryLike): WorkspaceIndex;
/** Register the loopback `/usage-monitor` channel without reading history. */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map