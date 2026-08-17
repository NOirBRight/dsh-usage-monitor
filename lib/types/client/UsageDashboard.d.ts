/** Settings-page usage dashboard: tiles, filters, and a stacked area chart. */
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { UsageSnapshot } from '../client-contract.ts';
import type { UsageLocaleKey } from './locales.ts';
export interface UsageDashboardFace {
    t: (key: UsageLocaleKey) => string;
    queryUsage: (start: number, end: number) => Promise<UsageSnapshot>;
}
export type UsageDashboardProps = PropsRuntime<'settings.section'> & InjectFace<UsageDashboardFace>;
export declare function UsageDashboard(props: UsageDashboardProps): import("react").JSX.Element;
//# sourceMappingURL=UsageDashboard.d.ts.map