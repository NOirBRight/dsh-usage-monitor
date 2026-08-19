/** Settings-page usage dashboard: tiles, filters, and a stacked area chart. */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  OTHER_SERIES_KEY,
  SERIES_COLORS,
  OTHER_SERIES_COLOR,
  breakdownRows,
  buildStackedSeries,
  visibleSummary,
  type UsageBreakdown,
  type UsageGroup,
  type UsageMetric,
} from '../chart.ts'
import type { UsageSnapshot } from '../client-contract.ts'
import { UsageChart } from './UsageChart.tsx'
import { UsageTable } from './UsageTable.tsx'
import type { UsageLocaleKey } from './locales.ts'
import {
  fromDateInput,
  rangeToSpan,
  spanToQuery,
  toDateInput,
  type UsageRange,
} from './window.ts'

export interface UsageDashboardFace {
  t: (key: UsageLocaleKey) => string
  queryUsage: (start: number, end: number) => Promise<UsageSnapshot>
}

export type UsageDashboardProps =
  PropsRuntime<'settings.section'>
  & InjectFace<UsageDashboardFace>

type LoadState =
  | { status: 'loading' }
  | { status: 'ready', snapshot: UsageSnapshot, refreshing: boolean }
  | { status: 'error', message?: string }

const snapshotMemo = new Map<string, UsageSnapshot>()

const pageStyle: CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  color: 'var(--dsw-alias-label-primary)',
}

const toolbarStyle: CSSProperties = {
  minWidth: 0,
  width: '100%',
}

const segmentStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  height: 32,
  width: 'max-content',
  boxSizing: 'border-box',
  padding: 3,
  borderRadius: 999,
  background: 'var(--dsw-alias-bg-layer-1)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}

const pillStyle = (active: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  margin: 0,
  border: 'none',
  borderRadius: 999,
  padding: '0 8px',
  background: active ? 'var(--dsw-alias-bg-module-platform)' : 'transparent',
  color: active
    ? 'var(--dsw-alias-label-primary)'
    : 'var(--dsw-alias-label-secondary)',
  boxShadow: active ? '0 1px 2px rgba(15, 23, 42, 0.08)' : 'none',
  fontSize: 11,
  fontWeight: 650,
  lineHeight: 1,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
})

const dateStyle: CSSProperties = {
  height: 32,
  padding: '0 10px',
  border: 'none',
  borderRadius: 999,
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
  fontSize: 11,
  fontWeight: 650,
}

const tileStyle: CSSProperties = {
  minWidth: 0,
  padding: '10px 12px',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-1)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}

const tileLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 650,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--dsw-alias-label-tertiary)',
}

const tileValueStyle: CSSProperties = {
  marginTop: 4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  fontSize: 18,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '-0.03em',
  whiteSpace: 'nowrap',
}

const USAGE_CSS = `
.dsh-um,
.dsh-um * {
  box-sizing: border-box;
}
.dsh-um {
  container-type: inline-size;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.dsh-um-tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.dsh-um-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.dsh-um-toolbar-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.dsh-um-menu {
  position: relative;
  flex: 0 0 auto;
}
.dsh-um-range {
  flex: 0 0 auto;
  width: max-content;
  height: 32px;
  margin-left: auto;
}
@container (min-width: 560px) {
  .dsh-um-tiles {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.dsh-um-chart,
.dsh-um-table {
  min-height: 0;
  min-width: 0;
  height: 100%;
}
.dsh-um-chart {
  position: relative;
  z-index: 2;
  overflow: visible;
}
`

const formatNumber = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)

const formatRate = (value: number | null, unknown: string): string => {
  if (value === null) return unknown
  return `${(value * 100).toFixed(1)}%`
}

const windowKey = (start: number, end: number): string => `${start}:${end}`

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 6.2 5 8.7 9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function UsageDropdown<T extends string>({
  label,
  value,
  valueLabel,
  options,
  open,
  onToggle,
  onSelect,
}: {
  label: string
  value: T
  valueLabel: string
  options: Array<{ value: T, label: string }>
  open: boolean
  onToggle: () => void
  onSelect: (value: T) => void
}) {
  const menuId = `dsh-um-${label.replace(/\s+/gu, '-').toLowerCase()}`
  return (
    <div className="dsh-um-menu">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? menuId : undefined}
        aria-label={`${label} ${valueLabel}`}
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: 'max-content',
          height: 32,
          padding: '0 8px 0 10px',
          border: 'none',
          borderRadius: 999,
          background: 'var(--dsw-alias-bg-layer-1)',
          color: 'var(--dsw-alias-label-secondary)',
          boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
          fontSize: 11,
          fontWeight: 650,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <span>{label}</span>
        <span style={{ color: 'var(--dsw-alias-label-primary)' }}>{valueLabel}</span>
        <Chevron />
      </button>
      {open && (
        <div
          id={menuId}
          role="listbox"
          style={{
            position: 'absolute',
            left: 0,
            top: 'calc(100% + 6px)',
            zIndex: 8,
            minWidth: '100%',
            width: 'max-content',
            padding: 4,
            borderRadius: 12,
            background: 'var(--dsw-alias-bg-layer-1)',
            boxShadow: '0 10px 28px rgba(15, 23, 42, 0.16), inset 0 0 0 1px var(--dsw-alias-border-l2)',
          }}
        >
          {options.map(option => {
            const selected = value === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(option.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  height: 28,
                  padding: '0 10px',
                  border: 'none',
                  borderRadius: 8,
                  background: selected ? 'var(--dsw-alias-bg-module-platform)' : 'transparent',
                  color: 'var(--dsw-alias-label-primary)',
                  fontSize: 11,
                  fontWeight: 650,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {option.label}
                {selected && <Check />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function UsageDashboard(props: UsageDashboardProps) {
  const t = props.t
  const queryUsage = props.queryUsage
  const locale = typeof navigator === 'undefined' ? 'en' : navigator.language
  const pending = t?.('pending') ?? '—'
  const unknown = t?.('unknown') ?? 'Unknown'
  const [metric, setMetric] = useState<UsageMetric>('token')
  const [breakdown, setBreakdown] = useState<UsageBreakdown>('provider')
  const [group, setGroup] = useState<UsageGroup>('day')
  const [range, setRange] = useState<UsageRange>('7d')
  const [openMenu, setOpenMenu] = useState<'metric' | 'by' | 'group' | null>(null)
  const [custom, setCustom] = useState(() => {
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - 6)
    return { start, end }
  })
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const queryRef = useRef(queryUsage)
  queryRef.current = queryUsage

  const span = useMemo(() => rangeToSpan(range, custom), [range, custom])
  const query = useMemo(() => spanToQuery(span), [span])

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-dsh-um-menu]')) return
      setOpenMenu(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    const fetchUsage = queryRef.current
    if (fetchUsage === undefined) {
      setLoad({ status: 'error' })
      return
    }
    const key = windowKey(query.start, query.end)
    const cached = snapshotMemo.get(key)
    setLoad(current => {
      if (cached !== undefined) return { status: 'ready', snapshot: cached, refreshing: true }
      if (current.status === 'ready') return { ...current, refreshing: true }
      return { status: 'loading' }
    })
    let cancelled = false
    void fetchUsage(query.start, query.end).then(
      snapshot => {
        snapshotMemo.set(key, snapshot)
        if (!cancelled) setLoad({ status: 'ready', snapshot, refreshing: false })
      },
      (error: unknown) => {
        if (cancelled) return
        setLoad(current => {
          if (current.status === 'ready') return { ...current, refreshing: false }
          const message = error instanceof Error && error.message.length > 0 ? error.message : undefined
          return { status: 'error', ...message === undefined ? {} : { message } }
        })
      },
    )
    return () => { cancelled = true }
  }, [query.start, query.end])

  const snapshot = load.status === 'ready' ? load.snapshot : undefined
  const stacked = useMemo(() => buildStackedSeries(
    snapshot?.events ?? [],
    span,
    group,
    metric,
    breakdown,
    locale,
    t?.('other') ?? 'Other',
  ), [snapshot, span, group, metric, breakdown, locale, t])

  const topKeys = useMemo(
    () => new Set(stacked.series.filter(item => item.key !== OTHER_SERIES_KEY).map(item => item.key)),
    [stacked.series],
  )
  const summary = snapshot === undefined
    ? undefined
    : visibleSummary(snapshot.events, snapshot.summary, breakdown, hidden, topKeys, hidden.has(OTHER_SERIES_KEY))
  const rows = useMemo(
    () => breakdownRows(
      snapshot?.events ?? [],
      breakdown,
      hidden,
      topKeys,
      hidden.has(OTHER_SERIES_KEY),
    ),
    [snapshot, breakdown, hidden, topKeys],
  )
  const rowColors = useMemo(() => {
    const fromSeries = new Map(stacked.series.map(item => [item.key, item.color]))
    return new Map(rows.map((row, index) => [
      row.key,
      fromSeries.get(row.key) ?? SERIES_COLORS[index] ?? OTHER_SERIES_COLOR,
    ]))
  }, [rows, stacked.series])

  const toggleSeries = (key: string) => {
    setHidden(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const chartEmpty = load.status === 'error'
    ? (load.message ?? t?.('failed') ?? '')
    : load.status === 'loading'
      ? (t?.('loading') ?? '')
      : (t?.('empty') ?? '')

  return (
    <section className="dsh-um" style={pageStyle}>
      <style>{USAGE_CSS}</style>
      <div className="dsh-um-toolbar" style={toolbarStyle} data-dsh-um-menu>
        <div className="dsh-um-toolbar-row">
        <UsageDropdown
          label={t?.('metric') ?? 'Metric'}
          value={metric}
          valueLabel={metric === 'token' ? (t?.('token') ?? 'Token') : (t?.('request') ?? 'Request')}
          open={openMenu === 'metric'}
          options={[
            { value: 'token', label: t?.('token') ?? 'Token' },
            { value: 'request', label: t?.('request') ?? 'Request' },
          ]}
          onToggle={() => setOpenMenu(current => current === 'metric' ? null : 'metric')}
          onSelect={value => {
            setMetric(value)
            setOpenMenu(null)
          }}
        />
        <UsageDropdown
          label={t?.('by') ?? 'By'}
          value={breakdown}
          valueLabel={t?.(breakdown) ?? breakdown}
          open={openMenu === 'by'}
          options={[
            { value: 'provider', label: t?.('provider') ?? 'Provider' },
            { value: 'model', label: t?.('model') ?? 'Model' },
            { value: 'workspace', label: t?.('workspace') ?? 'Workspace' },
          ]}
          onToggle={() => setOpenMenu(current => current === 'by' ? null : 'by')}
          onSelect={value => {
            setBreakdown(value)
            setOpenMenu(null)
          }}
        />
        <UsageDropdown
          label={t?.('group') ?? 'Group'}
          value={group}
          valueLabel={group === 'week' ? (t?.('week') ?? 'Week') : (t?.('day') ?? 'Day')}
          open={openMenu === 'group'}
          options={[
            { value: 'day', label: t?.('day') ?? 'Day' },
            { value: 'week', label: t?.('week') ?? 'Week' },
          ]}
          onToggle={() => setOpenMenu(current => current === 'group' ? null : 'group')}
          onSelect={value => {
            setGroup(value)
            setOpenMenu(null)
          }}
        />
        <div className="dsh-um-range" style={segmentStyle}>
          {([
            { value: '7d' as const, label: t?.('rangeWeek') ?? 'Week' },
            { value: '1m' as const, label: t?.('rangeMonth') ?? 'Month' },
            { value: 'custom' as const, label: t?.('custom') ?? 'Custom' },
          ]).map(option => (
            <button
              key={option.value}
              type="button"
              aria-pressed={range === option.value}
              style={pillStyle(range === option.value)}
              onClick={() => setRange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        </div>
        {range === 'custom' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, minWidth: 0 }}>
            <input
              type="date"
              aria-label={t?.('customStart') ?? 'Start date'}
              value={toDateInput(custom.start)}
              onChange={event => setCustom(current => ({ ...current, start: fromDateInput(event.target.value, current.start) }))}
              style={{ ...dateStyle, width: '100%', minWidth: 0 }}
            />
            <input
              type="date"
              aria-label={t?.('customEnd') ?? 'End date'}
              value={toDateInput(custom.end)}
              onChange={event => setCustom(current => ({ ...current, end: fromDateInput(event.target.value, current.end) }))}
              style={{ ...dateStyle, width: '100%', minWidth: 0 }}
            />
          </div>
        )}
      </div>

      <div className="dsh-um-tiles">
        <div style={tileStyle}>
          <div style={tileLabelStyle}>{t?.('tokens')}</div>
          <div style={tileValueStyle}>{summary ? formatNumber(summary.tokens, locale) : pending}</div>
        </div>
        <div style={tileStyle}>
          <div style={tileLabelStyle}>{t?.('requests')}</div>
          <div style={tileValueStyle}>{summary ? formatNumber(summary.requests, locale) : pending}</div>
        </div>
        <div style={tileStyle} title={t?.('outputHint')}>
          <div style={tileLabelStyle}>{t?.('output')}</div>
          <div style={tileValueStyle}>{summary ? formatNumber(summary.outputTokens, locale) : pending}</div>
        </div>
        <div style={tileStyle}>
          <div style={tileLabelStyle}>{t?.('cachedInput')}</div>
          <div style={tileValueStyle}>{summary ? formatRate(summary.cachedInputRate, unknown) : pending}</div>
        </div>
      </div>

      <div className="dsh-um-chart">
        <UsageChart
          buckets={stacked.buckets}
          series={stacked.series}
          hidden={hidden}
          locale={locale}
          empty={chartEmpty}
          loading={t?.('loading')}
          refreshing={load.status === 'loading' || (load.status === 'ready' && load.refreshing)}
          group={group}
          breakdownLabel={group === 'week' ? (t?.('weeklyBreakdown') ?? 'Weekly breakdown') : (t?.('dailyBreakdown') ?? 'Daily breakdown')}
          totalLabel={group === 'week' ? (t?.('weeklyTotal') ?? 'Weekly total') : (t?.('dailyTotal') ?? 'Daily total')}
          cumulativeTotalLabel={t?.('cumulativeTotal') ?? 'Cumulative total'}
          onToggleSeries={toggleSeries}
        />
      </div>
      <div className="dsh-um-table">
        <UsageTable
          rows={rows}
          nameLabel={t?.(breakdown) ?? breakdown}
          tokensLabel={t?.('tokens') ?? 'Tokens'}
          requestsLabel={t?.('requests') ?? 'Requests'}
          outputLabel={t?.('output') ?? 'Output'}
          cachedLabel={t?.('cachedInput') ?? 'Cached input'}
          pending={load.status === 'ready' ? (t?.('empty') ?? '') : pending}
          unknown={unknown}
          locale={locale}
          colors={rowColors}
        />
      </div>
    </section>
  )
}
