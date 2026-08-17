/**
 * Window a folded corpus into daily rollups plus summary tiles.
 */
import type { UsageSnapshot } from './client-contract.ts';
import type { StepUsage } from './fold.ts';
import { type PricingTable } from './pricing.ts';
export interface UsageQueryInput {
    steps: readonly StepUsage[];
    start: number;
    end: number;
    pricing: PricingTable;
}
/** Filter steps to `[start, end)`, roll up by local day, and compute tiles. */
export declare function queryUsage(input: UsageQueryInput): UsageSnapshot;
//# sourceMappingURL=query.d.ts.map