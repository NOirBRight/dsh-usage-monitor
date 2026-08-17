/** Local calendar windows for the usage chart. */
export type UsageRange = '7d' | '1m' | 'custom';
export interface DateSpan {
    start: Date;
    end: Date;
}
export declare function rangeToSpan(range: UsageRange, custom: DateSpan, now?: Date): DateSpan;
/** Inclusive local-day span → half-open query window. */
export declare function spanToQuery(span: DateSpan): {
    start: number;
    end: number;
};
export declare function toDateInput(date: Date): string;
export declare function fromDateInput(value: string, fallback: Date): Date;
//# sourceMappingURL=window.d.ts.map