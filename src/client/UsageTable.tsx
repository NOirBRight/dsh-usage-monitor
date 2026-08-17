/** Scrollable By-group table: same four numbers as the summary tiles. */

import type { CSSProperties } from 'react'
import type { BreakdownRow } from '../chart.ts'

export interface UsageTableProps {
  rows: readonly BreakdownRow[]
  nameLabel: string
  tokensLabel: string
  requestsLabel: string
  outputLabel: string
  cachedLabel: string
  pending: string
  unknown: string
  locale: string
  colors: ReadonlyMap<string, string>
}

const shellStyle: CSSProperties = {
  display: 'grid',
  gridTemplateRows: 'auto minmax(0, 1fr)',
  minHeight: 0,
  height: '100%',
  overflow: 'hidden',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 14,
  background: 'var(--dsw-alias-bg-module-platform)',
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.5fr) repeat(4, minmax(64px, 0.7fr))',
  gap: 8,
  alignItems: 'center',
  padding: '0 12px',
}

const headStyle: CSSProperties = {
  ...gridStyle,
  height: 32,
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
  fontSize: 10,
  fontWeight: 650,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--dsw-alias-label-tertiary)',
}

const bodyStyle: CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
}

const rowStyle: CSSProperties = {
  ...gridStyle,
  height: 34,
  fontSize: 12,
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}

const numStyle: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 650,
  textAlign: 'right',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const formatNumber = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)

const formatRate = (value: number | null, unknown: string): string => {
  if (value === null) return unknown
  return `${(value * 100).toFixed(1)}%`
}

export function UsageTable({
  rows,
  nameLabel,
  tokensLabel,
  requestsLabel,
  outputLabel,
  cachedLabel,
  pending,
  unknown,
  locale,
  colors,
}: UsageTableProps) {
  return (
    <div style={shellStyle}>
      <div style={headStyle}>
        <span>{nameLabel}</span>
        <span style={{ textAlign: 'right' }}>{tokensLabel}</span>
        <span style={{ textAlign: 'right' }}>{requestsLabel}</span>
        <span style={{ textAlign: 'right' }}>{outputLabel}</span>
        <span style={{ textAlign: 'right' }}>{cachedLabel}</span>
      </div>
      <div style={bodyStyle}>
        {rows.length === 0 ? (
          <div style={{ height: 34, display: 'grid', placeItems: 'center', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>
            {pending}
          </div>
        ) : rows.map(row => (
          <div key={row.key} style={rowStyle}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <i style={{
                width: 8,
                height: 8,
                borderRadius: 99,
                flexShrink: 0,
                background: colors.get(row.key) ?? 'var(--dsw-alias-label-tertiary)',
              }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
            </span>
            <span style={numStyle}>{formatNumber(row.tokens, locale)}</span>
            <span style={numStyle}>{formatNumber(row.requests, locale)}</span>
            <span style={numStyle}>{formatNumber(row.outputTokens, locale)}</span>
            <span style={numStyle}>{formatRate(row.cachedInputRate, unknown)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
