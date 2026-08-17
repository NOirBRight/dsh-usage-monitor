/**
 * Client-side stacked aggregation: Metric × By × Group over daily rollups.
 */
import type { UsageEvent, UsageSummary } from './client-contract.ts';
export type UsageMetric = 'token' | 'request';
export type UsageBreakdown = 'provider' | 'model' | 'workspace';
export type UsageGroup = 'day' | 'week';
export interface DateSpan {
    start: Date;
    end: Date;
}
export interface StackSegment {
    key: string;
    label: string;
    value: number;
}
export interface StackBucket {
    start: Date;
    endExclusive: Date;
    label: string;
    segments: StackSegment[];
    total: number;
}
export interface StackSeries {
    key: string;
    label: string;
    total: number;
    color: string;
}
export declare const OTHER_SERIES_KEY = "other";
export declare const SERIES_COLORS: readonly ["#3941ff", "#00a8a8", "#7c3aed", "#0ea5e9", "#b1a7ff", "#10b981"];
export declare const OTHER_SERIES_COLOR = "#cbd5e1";
export declare function breakdownOf(event: UsageEvent, breakdown: UsageBreakdown): {
    key: string;
    label: string;
};
export declare function bucketSpecs(span: DateSpan, group: UsageGroup, locale: string): Array<{
    start: Date;
    endExclusive: Date;
    label: string;
}>;
export declare function formatBucketTooltipDate(bucket: Pick<StackBucket, 'start' | 'endExclusive'>, locale: string): string;
export declare function buildStackedSeries(events: readonly UsageEvent[], span: DateSpan, group: UsageGroup, metric: UsageMetric, breakdown: UsageBreakdown, locale: string, otherLabel: string): {
    buckets: StackBucket[];
    series: StackSeries[];
    hasData: boolean;
};
export declare function visibleSummary(events: readonly UsageEvent[], summary: UsageSummary, breakdown: UsageBreakdown, hidden: ReadonlySet<string>, topKeys: ReadonlySet<string>, hideOther: boolean): UsageSummary;
export interface BreakdownRow {
    key: string;
    label: string;
    tokens: number;
    requests: number;
    outputTokens: number;
    cachedInputRate: number | null;
}
/** One row per By-group, same four numbers as the summary tiles. */
export declare function breakdownRows(events: readonly UsageEvent[], breakdown: UsageBreakdown, hidden: ReadonlySet<string>, topKeys: ReadonlySet<string>, hideOther: boolean): BreakdownRow[];
/** Round a chart max up to 1 / 2 / 5 × 10^n so the Y-axis stays readable. */
export declare function niceMax(value: number): number;
/** Evenly spaced x-axis ticks, always including first and last. */
export declare function axisTickIndices(count: number, maxTicks: number): number[];
/** CodexHub stacked-chart tooltip: follow the cursor, prefer above, flip at edges. */
export declare const CHART_TOOLTIP_GAP = 16;
export declare const CHART_TOOLTIP_EDGE = 12;
export declare function placeChartTooltip(input: {
    cursorX: number;
    cursorY: number;
    height: number;
    hostHeight: number;
    hostWidth: number;
    width: number;
}): {
    left: number;
    top: number;
};
//# sourceMappingURL=chart.d.ts.map