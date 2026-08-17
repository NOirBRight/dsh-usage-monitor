/** Browser half: Usage page inside Settings. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { UsageLocaleKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'settings.usage-monitor': UsageLocaleKey;
    }
}
export declare const name = "dsh-usage-monitor-client";
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map