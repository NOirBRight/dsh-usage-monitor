/** Responsive By-group cards: same four numbers as the summary tiles. */
import type { BreakdownRow } from '../chart.ts';
export interface UsageTableProps {
    rows: readonly BreakdownRow[];
    nameLabel: string;
    tokensLabel: string;
    requestsLabel: string;
    outputLabel: string;
    cachedLabel: string;
    shareLabel: string;
    pending: string;
    unknown: string;
    locale: string;
    colors: ReadonlyMap<string, string>;
}
export declare function UsageTable({ rows, nameLabel, tokensLabel, requestsLabel, outputLabel, cachedLabel, shareLabel, pending, unknown, locale, colors, }: UsageTableProps): import("react").JSX.Element;
//# sourceMappingURL=UsageTable.d.ts.map