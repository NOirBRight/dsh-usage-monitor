import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UsageTable } from '../src/client/UsageTable.tsx'

describe('UsageTable', () => {
  it('renders a compact mobile provider summary without dropping secondary metrics', () => {
    const markup = renderToStaticMarkup(
      <UsageTable
        rows={[{
          key: 'provider:codex',
          label: 'Codex',
          tokens: 11_827_000_000,
          requests: 68_786,
          outputTokens: 29_523_000,
          cachedInputRate: 0.968,
        }]}
        nameLabel="Provider"
        tokensLabel="Tokens"
        requestsLabel="Requests"
        outputLabel="Output"
        cachedLabel="Cached input"
        shareLabel="Share of tokens"
        pending="—"
        unknown="Unknown"
        locale="en"
        colors={new Map([['provider:codex', '#3941ff']])}
      />,
    )

    expect(markup).toContain('dsh-um-mobile-rows')
    expect(markup).toContain('Share of tokens')
    expect(markup).toContain('11.8B')
    expect(markup).toContain('68.8K Requests')
    expect(markup).toContain('29.5M Output')
    expect(markup).toContain('96.8% Cached input')
  })
})
