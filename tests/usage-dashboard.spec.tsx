import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UsageChart } from '../src/client/UsageChart.tsx'
import { UsageDashboard } from '../src/client/UsageDashboard.tsx'

describe('Usage dashboard responsive controls', () => {
  it('isolates each range label in an equal-size pill surface', () => {
    const markup = renderToStaticMarkup(
      <UsageDashboard
        t={key => key}
        locale="en"
        queryUsage={async () => { throw new Error('query is not called during server rendering') }}
      />,
    )

    expect(markup.match(/class="dsh-um-range-option"/g)).toHaveLength(3)
    expect(markup.match(/class="dsh-um-range-pill"/g)).toHaveLength(3)
  })

  it('uses K, M, B, and T-sized Y-axis labels instead of overflowing the plot', () => {
    const start = new Date('2026-09-01T00:00:00.000Z')
    const markup = renderToStaticMarkup(
      <UsageChart
        buckets={[{
          start,
          endExclusive: new Date('2026-09-02T00:00:00.000Z'),
          label: '9/1',
          segments: [{ key: 'codex', label: 'Codex', value: 10_000_000_000 }],
          total: 10_000_000_000,
        }]}
        series={[{ key: 'codex', label: 'Codex', total: 10_000_000_000, color: '#3941ff' }]}
        hidden={new Set()}
        locale="en"
        empty="No data"
        breakdownLabel="Daily breakdown"
        totalLabel="Daily total"
        cumulativeTotalLabel="Cumulative total"
        onToggleSeries={() => undefined}
      />,
    )

    expect(markup).toContain('dsh-um-chart-axis-y')
    expect(markup).toContain('>10B<')
    expect(markup).toContain('>5B<')
    expect(markup).not.toContain('10000M')
  })
})
