/**
 * Local USD estimates. Missing rates stay unknown — never invent a number.
 */
import type { TokenBuckets } from './client-contract.ts';
/** Per-million-token USD rates for one model. */
export interface ModelPricing {
    inputPerMillion: number;
    outputPerMillion: number;
    cachedInputPerMillion?: number;
    cacheWritePerMillion?: number;
}
export type PricingTable = Readonly<Record<string, ModelPricing>>;
/**
 * Published API rates we can stand behind. Subscription / local routes stay
 * off this table so the UI can say Unknown instead of guessing.
 */
export declare const BUILTIN_PRICING: PricingTable;
/** Look up rates for a provider/model pair. */
export declare function lookupPricing(table: PricingTable, provider: string, model: string): ModelPricing | undefined;
/** USD cost for one sample, or null when the model has no rates. */
export declare function estimateCost(buckets: TokenBuckets, pricing: ModelPricing | undefined): number | null;
/** Providers known to report cache-read tokens when a cache hit occurs. */
export declare const CACHE_CAPABLE_PROVIDERS: Set<string>;
export declare function reportsCache(provider: string, cacheReadTokens: number): boolean;
//# sourceMappingURL=pricing.d.ts.map