/**
 * Host face: fold session logs and serve a loopback usage snapshot RPC.
 * @module dsh-usage-monitor
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection';
import type { UsageQueryRequest, UsageSnapshot } from './client-contract.ts';
import { type SessionCorpus, type WorkspaceIndex } from './collect.ts';
import type { FoldableEvent } from './fold.ts';
export { USAGE_RPC_CHANNEL, USAGE_QUERY_ENDPOINT, decodeUsageQueryRequest, decodeUsageSnapshot, } from './client-contract.ts';
export type { UsageEvent, UsageQueryRequest, UsageSnapshot, UsageSummary } from './client-contract.ts';
export { foldSessionUsage } from './fold.ts';
export { FoldCache, collectUsage, resolveWorkspace } from './collect.ts';
export { queryUsage } from './query.ts';
export { estimateCost, lookupPricing, BUILTIN_PRICING } from './pricing.ts';
export { buildStackedSeries, breakdownOf, breakdownRows, niceMax } from './chart.ts';
export declare const name = "dsh-usage-monitor";
export declare const inject: string[];
export declare const READ_BUDGET_MS = 20000;
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
    listSnapshots(signal?: AbortSignal): Promise<Array<{
        header: SessionHeaderLike;
        revision: unknown;
    }>>;
    readFrom?(id: unknown, fromSeq: number, signal?: AbortSignal): Promise<{
        events: readonly FoldableEvent[];
    }>;
    inspect?(id: unknown, signal?: AbortSignal): Promise<{
        events: readonly FoldableEvent[];
    }>;
}
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
/** Register the loopback `/usage-monitor` channel. */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map