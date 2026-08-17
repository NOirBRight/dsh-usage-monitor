/** Browser-safe constants and JSON decoders shared by Host and Web faces. */
/** Private Connection RPC channel used by this package's Host and Web faces. */
export declare const USAGE_RPC_CHANNEL = "/usage-monitor";
/** Windowed usage snapshot. */
export declare const USAGE_QUERY_ENDPOINT = "usage/query";
/** Token buckets reported by one model step. */
export interface TokenBuckets {
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
/** One calendar-day rollup of steps that share provider, model, and workspace. */
export interface UsageEvent {
    time: number;
    day: string;
    provider: string;
    model: string;
    workspaceId: string;
    workspaceTitle: string;
    requests: number;
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
/** Window-scoped totals shown in the summary tiles. */
export interface UsageSummary {
    tokens: number;
    requests: number;
    outputTokens: number;
    estimatedCostUsd: number | null;
    cachedInputRate: number | null;
    pricedRequests: number;
    unpricedRequests: number;
}
/** Host reply for {@link USAGE_QUERY_ENDPOINT}. */
export interface UsageSnapshot {
    summary: UsageSummary;
    events: UsageEvent[];
}
/** Client request for {@link USAGE_QUERY_ENDPOINT}. */
export interface UsageQueryRequest {
    start: number;
    end: number;
}
/** Decode a client query payload. Extra fields are rejected. */
export declare function decodeUsageQueryRequest(value: unknown): UsageQueryRequest | undefined;
/** Decode a Host usage snapshot. */
export declare function decodeUsageSnapshot(value: unknown): UsageSnapshot | undefined;
//# sourceMappingURL=client-contract.d.ts.map