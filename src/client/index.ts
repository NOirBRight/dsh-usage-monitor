/** Browser half: Usage page inside Settings. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import {
  USAGE_QUERY_ENDPOINT,
  USAGE_RPC_CHANNEL,
  decodeUsageSnapshot,
} from '../client-contract.ts'
import { UsageDashboard } from './UsageDashboard.tsx'
import type { UsageDashboardFace } from './UsageDashboard.tsx'
import { en, zh } from './locales.ts'
import type { UsageLocaleKey } from './locales.ts'
import { installUsageNavIcon } from './nav-icon.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.usage-monitor': UsageLocaleKey
  }
}

export const name = 'dsh-usage-monitor-client'
export const inject = ['slots', 'locale', 'connection']


function assertMinVersion(ctx: ClientContext): void {
  // GitHub installs use a single ref, not a semver range. This hard check
  // prevents a new tag built for 0.1.2-alpha.1 from silently running on rc.2.
  // rc.2 users should stay on github:NOirBRight/dsh-usage-monitor#v0.2.2.
  const boot = (globalThis as unknown as { __DSH_BOOT__?: { graph?: Record<string, unknown> } }).__DSH_BOOT__;
  if (boot?.graph && '@deepseek-ai/dsh-client-runtime' in boot.graph) {
    throw new Error('dsh-usage-monitor >=0.2.4 requires DSH >=0.1.2-alpha.1; on DSH 0.1.1-rc.2 use github:NOirBRight/dsh-usage-monitor#v0.2.2');
  }
  // Also detect via Host service that only exists on old DSH
  try {
    const maybe = (ctx as unknown as { get?: (id: string) => unknown }).get?.('dsh-client-runtime' as never);
    if (maybe !== undefined) {
      throw new Error('dsh-usage-monitor >=0.2.4 requires DSH >=0.1.2-alpha.1; on DSH 0.1.1-rc.2 use github:NOirBRight/dsh-usage-monitor#v0.2.2');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('requires DSH')) throw e;
  }
}
export function apply(ctx: ClientContext): void {
  assertMinVersion(ctx);
  const localeNamespace = 'settings.usage-monitor'
  ctx.effect(
    () => ctx.locale.register(localeNamespace, { zh, en }),
    'dsh-usage-monitor: Settings page copy',
  )
  const t = ctx.locale.bind(localeNamespace) as UsageDashboardFace['t']
  const { rpc } = ctx.get('connection') as unknown as ConnectionHandle

  const queryUsage: UsageDashboardFace['queryUsage'] = async (start, end) => {
    const controller = new AbortController()
    const timer = globalThis.setTimeout(() => controller.abort(), 90_000)
    try {
      const result = await rpc.call(USAGE_RPC_CHANNEL, USAGE_QUERY_ENDPOINT, { start, end }, controller.signal)
      if (!result.ok) throw new Error(result.error.message)
      const decoded = decodeUsageSnapshot(result.value)
      if (decoded === undefined) throw new Error(t('failed'))
      return decoded
    } finally {
      globalThis.clearTimeout(timer)
    }
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage-monitor',
    order: 15,
    label: () => t('nav'),
    inject: (): UsageDashboardFace => ({ t, queryUsage }),
  }, UsageDashboard))

  ctx.effect(installUsageNavIcon, 'dsh-usage-monitor: settings nav icon')
}
