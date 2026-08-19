/** CodexHub-style stacked area chart: Y-axis, hover tooltips, legend toggle. */
import { type StackBucket, type StackSeries, type UsageGroup } from '../chart.ts';
export interface UsageChartProps {
    buckets: readonly StackBucket[];
    series: readonly StackSeries[];
    hidden: ReadonlySet<string>;
    locale: string;
    empty: string;
    loading?: string;
    refreshing?: boolean;
    group?: UsageGroup;
    breakdownLabel: string;
    totalLabel: string;
    cumulativeTotalLabel: string;
    onToggleSeries: (key: string) => void;
}
export declare function UsageChart({ buckets, series, hidden, locale, empty, loading, refreshing, group, breakdownLabel, totalLabel, cumulativeTotalLabel, onToggleSeries, }: UsageChartProps): import("react").JSX.Element;
//# sourceMappingURL=UsageChart.d.ts.map