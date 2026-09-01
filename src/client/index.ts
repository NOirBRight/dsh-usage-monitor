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

export function apply(ctx: ClientContext): void {
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
    inject: (): UsageDashboardFace => ({
      t,
      locale: ctx.locale.getLocale().active,
      queryUsage,
    }),
  }, UsageDashboard))

  ctx.effect(installUsageNavIcon, 'dsh-usage-monitor: settings nav icon')
}
