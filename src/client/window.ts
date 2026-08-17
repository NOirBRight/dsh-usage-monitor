/** Local calendar windows for the usage chart. */

export type UsageRange = '7d' | '1m' | 'custom'

export interface DateSpan {
  start: Date
  end: Date
}

const startOfDay = (date: Date): Date => {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function rangeToSpan(range: UsageRange, custom: DateSpan, now = new Date()): DateSpan {
  const today = startOfDay(now)
  if (range === '7d') return { start: addDays(today, -6), end: today }
  if (range === '1m') return { start: addDays(today, -29), end: today }
  return { start: startOfDay(custom.start), end: startOfDay(custom.end) }
}

/** Inclusive local-day span → half-open query window. */
export function spanToQuery(span: DateSpan): { start: number, end: number } {
  const start = startOfDay(span.start)
  const end = addDays(startOfDay(span.end), 1)
  return { start: start.getTime(), end: end.getTime() }
}

export function toDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function fromDateInput(value: string, fallback: Date): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (match === null) return fallback
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? fallback : date
}
