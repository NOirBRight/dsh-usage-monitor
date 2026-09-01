/** Responsive By-group cards: same four numbers as the summary tiles. */

import type { BreakdownRow } from '../chart.ts'

export interface UsageTableProps {
  rows: readonly BreakdownRow[]
  nameLabel: string
  tokensLabel: string
  requestsLabel: string
  outputLabel: string
  cachedLabel: string
  shareLabel: string
  pending: string
  unknown: string
  locale: string
  colors: ReadonlyMap<string, string>
}

const formatCompactNumber = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    notation: 'compact',
  }).format(value)

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
  shareLabel,
  pending,
  unknown,
  locale,
  colors,
}: UsageTableProps) {
  const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0)

  return (
    <div className="dsh-um-breakdown-cards">
      <div className="dsh-um-breakdown-head">
        <strong>{nameLabel}</strong>
        <span>{shareLabel}</span>
      </div>
        {rows.length === 0 ? (
          <div className="dsh-um-breakdown-empty">{pending}</div>
        ) : rows.map(row => {
          const share = totalTokens <= 0 ? 0 : Math.min(100, (row.tokens / totalTokens) * 100)
          return (
            <article key={row.key} className="dsh-um-breakdown-card">
              <div className="dsh-um-breakdown-card-head">
                <span className="dsh-um-breakdown-card-name">
                  <i style={{ background: colors.get(row.key) ?? 'var(--dsw-alias-label-tertiary)' }} />
                  <strong>{row.label}</strong>
                </span>
                <strong className="dsh-um-breakdown-card-value">
                  {formatCompactNumber(row.tokens, locale)}
                </strong>
              </div>
              <div className="dsh-um-breakdown-card-meta">
                <span>{formatCompactNumber(row.requests, locale)} {requestsLabel}</span>
                <span>{formatCompactNumber(row.outputTokens, locale)} {outputLabel}</span>
                <span>{formatRate(row.cachedInputRate, unknown)} {cachedLabel}</span>
              </div>
              <div className="dsh-um-breakdown-card-progress" aria-label={`${tokensLabel}: ${share.toFixed(1)}%`}>
                <i style={{
                  width: `${share}%`,
                  background: colors.get(row.key) ?? 'var(--dsw-alias-label-tertiary)',
                }} />
              </div>
            </article>
          )
        })}
    </div>
  )
}
