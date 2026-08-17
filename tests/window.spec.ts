import { describe, expect, it } from 'vitest'
import { rangeToSpan, spanToQuery, toDateInput } from '../src/client/window.ts'

describe('rangeToSpan', () => {
  it('maps 7d to today and the six days before', () => {
    const now = new Date(2026, 7, 17, 15, 30)
    const span = rangeToSpan('7d', { start: now, end: now }, now)
    expect(toDateInput(span.start)).toBe('2026-08-11')
    expect(toDateInput(span.end)).toBe('2026-08-17')
    const query = spanToQuery(span)
    expect(query.end).toBe(new Date(2026, 7, 18).getTime())
  })
})
