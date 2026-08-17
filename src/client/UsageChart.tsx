/** CodexHub-style stacked area chart: Y-axis, hover tooltips, legend toggle. */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import {
  axisTickIndices,
  formatBucketTooltipDate,
  niceMax,
  placeChartTooltip,
  type StackBucket,
  type StackSeries,
  type UsageGroup,
} from '../chart.ts'

const STACK_AREA_OPACITY = 0.24
const STACK_SEPARATOR = 'rgba(255, 255, 255, 0.78)'
const TOOLTIP_WIDTH = 250
const DAY_TICK_MIN_PX = 44
const WEEK_TICK_MIN_PX = 76

interface ChartPoint {
  value: number
  x: number
  y: number
}

interface ChartHover {
  cursorX: number
  cursorY: number
  hostHeight: number
  hostWidth: number
  index: number
}

export interface UsageChartProps {
  buckets: readonly StackBucket[]
  series: readonly StackSeries[]
  hidden: ReadonlySet<string>
  locale: string
  empty: string
  loading?: string
  refreshing?: boolean
  group?: UsageGroup
  onToggleSeries: (key: string) => void
}

const shellStyle: CSSProperties = {
  display: 'grid',
  gridTemplateRows: 'minmax(0, 1fr) auto',
  minHeight: 0,
  height: '100%',
  minWidth: 0,
  overflow: 'visible',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 14,
  background: 'var(--dsw-alias-bg-module-platform)',
}

const stackAreaColor = (color: string): string => {
  const hex = /^#([0-9a-f]{6})$/iu.exec(color)?.[1]
  if (hex === undefined) return color
  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${STACK_AREA_OPACITY})`
}

const formatNumber = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)

const formatAxisNumber = (value: number, locale: string): string => {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${compact(value / 1_000_000)}M`
  if (abs >= 1_000) return `${compact(value / 1_000)}K`
  return formatNumber(value, locale)
}

const compact = (value: number): string => {
  if (Math.abs(value) >= 10 || Number.isInteger(value)) return value.toFixed(0)
  return value.toFixed(1).replace(/\.0$/u, '')
}

const bucketX = (index: number, count: number): number =>
  count <= 1 ? 50 : (index / (count - 1)) * 100

const valueToY = (value: number, maxTotal: number): number =>
  100 - (value / Math.max(1, maxTotal)) * 100

const nearestBucketIndex = (percent: number, count: number): number => {
  if (count <= 1) return 0
  return Math.min(count - 1, Math.max(0, Math.round(percent * (count - 1))))
}

const formatPoint = (point: Pick<ChartPoint, 'x' | 'y'>): string =>
  `${point.x.toFixed(3)} ${point.y.toFixed(3)}`

const clampPoint = (
  point: Pick<ChartPoint, 'x' | 'y'>,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): Pick<ChartPoint, 'x' | 'y'> => ({
  x: Math.min(maxX, Math.max(minX, point.x)),
  y: Math.min(maxY, Math.max(minY, point.y)),
})

const smoothPath = (points: readonly ChartPoint[], moveToFirst: boolean): string => {
  if (points.length === 0) return ''
  if (points.length === 1) return `${moveToFirst ? 'M' : 'L'} ${formatPoint(points[0]!)}`
  const commands = [`${moveToFirst ? 'M' : 'L'} ${formatPoint(points[0]!)}`]
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index]!
    const current = points[index]!
    const next = points[index + 1]!
    const afterNext = points[index + 2] ?? next
    const minX = Math.min(current.x, next.x)
    const maxX = Math.max(current.x, next.x)
    const minY = Math.min(current.y, next.y)
    const maxY = Math.max(current.y, next.y)
    const c1 = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    }
    const c2 = {
      x: next.x - (afterNext.x - current.x) / 6,
      y: next.y - (afterNext.y - current.y) / 6,
    }
    commands.push(
      `C ${formatPoint(clampPoint(c1, minX, maxX, minY, maxY))} ${formatPoint(clampPoint(c2, minX, maxX, minY, maxY))} ${formatPoint(next)}`,
    )
  }
  return commands.join(' ')
}

const areaPath = (topPoints: readonly ChartPoint[], basePoints: readonly ChartPoint[]): string => {
  if (topPoints.length === 0 || basePoints.length === 0) return ''
  return `${smoothPath(topPoints, true)} ${smoothPath([...basePoints].reverse(), false)} Z`
}

export function UsageChart({
  buckets,
  series,
  hidden,
  locale,
  empty,
  loading,
  refreshing = false,
  group = 'day',
  onToggleSeries,
}: UsageChartProps) {
  const [hover, setHover] = useState<ChartHover | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const axisRef = useRef<HTMLDivElement | null>(null)
  const [tooltipHeight, setTooltipHeight] = useState(0)
  const [axisWidth, setAxisWidth] = useState(0)

  const visibleSeries = series.filter(item => !hidden.has(item.key))
  const visibleBuckets = buckets.map(bucket => {
    const segments = bucket.segments.filter(segment => !hidden.has(segment.key))
    return {
      ...bucket,
      segments,
      total: segments.reduce((sum, segment) => sum + segment.value, 0),
    }
  })
  const maxTotal = niceMax(Math.max(1, ...visibleBuckets.map(bucket => bucket.total)))
  const hasData = visibleBuckets.some(bucket => bucket.total > 0)
  const layers = visibleSeries.map((item, seriesIndex) => {
    const basePoints: ChartPoint[] = []
    const topPoints: ChartPoint[] = []
    visibleBuckets.forEach((bucket, bucketIndex) => {
      const valueOf = (key: string): number =>
        bucket.segments.find(segment => segment.key === key)?.value ?? 0
      const base = visibleSeries
        .slice(0, seriesIndex)
        .reduce((sum, prior) => sum + valueOf(prior.key), 0)
      const top = base + valueOf(item.key)
      const x = bucketX(bucketIndex, visibleBuckets.length)
      basePoints.push({ value: base, x, y: valueToY(base, maxTotal) })
      topPoints.push({ value: top, x, y: valueToY(top, maxTotal) })
    })
    return { ...item, basePoints, topPoints, fill: stackAreaColor(item.color) }
  })

  const activeIndex = hover?.index
    ?? Math.max(0, visibleBuckets.findIndex(bucket => bucket.total > 0))
  const activeBucket = visibleBuckets[activeIndex]
  const activeSegments = (activeBucket?.segments ?? [])
    .filter(segment => segment.value > 0)
    .map(segment => ({
      ...segment,
      fillColor: visibleSeries.find(item => item.key === segment.key)?.color ?? segment.key,
    }))
    .sort((left, right) => right.value - left.value)

  const tooltipWidth = TOOLTIP_WIDTH
  const activeSegmentSignature = activeSegments
    .map(segment => `${segment.key}:${segment.value}`)
    .join('|')
  const tooltipPlace = hover === null
    ? { left: 0, top: 0 }
    : placeChartTooltip({
      cursorX: hover.cursorX,
      cursorY: hover.cursorY,
      height: tooltipHeight || 86,
      hostHeight: hover.hostHeight,
      hostWidth: hover.hostWidth,
      width: tooltipWidth,
    })

  useEffect(() => {
    setHover(null)
    setTooltipHeight(0)
  }, [buckets.length, buckets[0]?.start.getTime(), series.map(item => item.key).join('|')])

  useLayoutEffect(() => {
    if (hover === null || tooltipRef.current === null) return
    const nextHeight = tooltipRef.current.getBoundingClientRect().height
    setTooltipHeight(current => (Math.abs(current - nextHeight) > 0.5 ? nextHeight : current))
  }, [hover, activeBucket?.label, activeSegmentSignature])

  useLayoutEffect(() => {
    const node = axisRef.current
    if (node === null) return
    const sync = () => {
      const width = node.getBoundingClientRect().width
      setAxisWidth(current => (Math.abs(current - width) > 0.5 ? width : current))
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const handleHover = (event: MouseEvent<HTMLDivElement>) => {
    if (visibleBuckets.length === 0) return
    const hostRect = hostRef.current?.getBoundingClientRect()
    if (hostRect === undefined) return
    const plotRect = event.currentTarget.getBoundingClientRect()
    const percent = Math.min(1, Math.max(0, (event.clientX - plotRect.left) / plotRect.width))
    const index = nearestBucketIndex(percent, visibleBuckets.length)
    setHover({
      cursorX: event.clientX - hostRect.left,
      cursorY: event.clientY - hostRect.top,
      hostHeight: hostRect.height,
      hostWidth: hostRect.width,
      index,
    })
  }

  const overlay = !hasData
    ? (refreshing ? loading : empty)
    : undefined

  return (
    <div style={shellStyle}>
      <div
        ref={hostRef}
        style={{
          position: 'relative',
          display: 'grid',
          gridTemplateRows: 'minmax(0, 1fr)',
          minHeight: 0,
          minWidth: 0,
          overflow: 'visible',
        }}
      >
      <div style={{
        display: 'grid',
        gridTemplateColumns: '40px minmax(0, 1fr)',
        gridTemplateRows: 'minmax(0, 1fr) 24px',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        padding: '10px 10px 6px 6px',
      }}>
        <div
          style={{
            display: 'grid',
            gridTemplateRows: 'auto 1fr auto',
            minHeight: 0,
            padding: '0 4px 0 0',
            fontSize: 10,
            fontWeight: 650,
            color: 'var(--dsw-alias-label-tertiary)',
            fontVariantNumeric: 'tabular-nums',
            textAlign: 'right',
            overflow: 'hidden',
          }}
        >
          <span title={formatNumber(maxTotal, locale)}>{formatAxisNumber(maxTotal, locale)}</span>
          <span style={{ alignSelf: 'center' }} title={formatNumber(Math.round(maxTotal / 2), locale)}>
            {formatAxisNumber(Math.round(maxTotal / 2), locale)}
          </span>
          <span>0</span>
        </div>
        <div
          style={{ position: 'relative', minWidth: 0, minHeight: 0, overflow: 'hidden' }}
          onMouseMove={handleHover}
          onMouseLeave={() => setHover(null)}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', overflow: 'hidden' }}
          >
            {[0, 25, 50, 75, 100].map(y => (
              <line
                key={y}
                x1="0"
                x2="100"
                y1={y}
                y2={y}
                stroke="var(--dsw-alias-border-l2)"
                strokeWidth="0.45"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={y === 25 || y === 75 ? '3 3' : '0'}
              />
            ))}
            {hasData && layers.map(layer => (
              <path key={`${layer.key}:area`} d={areaPath(layer.topPoints, layer.basePoints)} fill={layer.fill} />
            ))}
            {hasData && layers.map(layer => (
              <path
                key={`${layer.key}:line`}
                d={smoothPath(layer.topPoints, true)}
                fill="none"
                stroke={STACK_SEPARATOR}
                strokeWidth="1.15"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {hasData && hover !== null && activeBucket !== undefined && (
              <line
                x1={bucketX(activeIndex, visibleBuckets.length)}
                x2={bucketX(activeIndex, visibleBuckets.length)}
                y1="0"
                y2="100"
                stroke="var(--dsw-alias-label-tertiary)"
                strokeWidth="1"
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {overlay !== undefined && overlay.length > 0 && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                pointerEvents: 'none',
                color: 'var(--dsw-alias-label-tertiary)',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {overlay}
            </div>
          )}
        </div>
        <div />
        <div
          ref={axisRef}
          style={{
            position: 'relative',
            minWidth: 0,
            height: 24,
            lineHeight: '16px',
            color: 'var(--dsw-alias-label-tertiary)',
            fontSize: 10,
            fontWeight: 650,
            overflow: 'hidden',
          }}
        >
          {axisTickIndices(
            visibleBuckets.length,
            axisWidth / (group === 'week' ? WEEK_TICK_MIN_PX : DAY_TICK_MIN_PX),
          ).map(index => {
            const bucket = visibleBuckets[index]
            if (bucket === undefined) return null
            const last = index === visibleBuckets.length - 1
            const first = index === 0
            return (
              <span
                key={`${bucket.start.getTime()}-${bucket.label}`}
                style={{
                  position: 'absolute',
                  top: 4,
                  left: `${bucketX(index, visibleBuckets.length)}%`,
                  transform: first ? 'none' : last ? 'translateX(-100%)' : 'translateX(-50%)',
                  maxWidth: 48,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {bucket.label}
              </span>
            )
          })}
        </div>
      </div>
        {hasData && hover !== null && activeBucket !== undefined && (
          <div
            ref={tooltipRef}
            style={{
              position: 'absolute',
              gridColumn: '1',
              gridRow: '1',
              left: tooltipPlace.left,
              top: tooltipPlace.top,
              width: tooltipWidth,
              zIndex: 20,
              pointerEvents: 'none',
              padding: 10,
              borderRadius: 12,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-bg-layer-1)',
              boxShadow: '0 12px 32px rgba(15, 23, 42, 0.16)',
              fontSize: 12,
            }}
          >
            <div style={{ marginBottom: 8, fontWeight: 700 }}>
              {formatBucketTooltipDate(activeBucket, locale)}
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {activeSegments.map(segment => (
                <div
                  key={segment.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                    alignItems: 'start',
                    gap: 8,
                  }}
                >
                  <i
                    style={{
                      width: 8,
                      height: 8,
                      marginTop: 4,
                      borderRadius: 99,
                      background: segment.fillColor,
                    }}
                  />
                  <span style={{ minWidth: 0, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.35 }}>
                    {segment.label}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                    {formatNumber(segment.value, locale)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {series.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'center',
            alignContent: 'center',
            gap: '0 8px',
            position: 'relative',
            zIndex: 1,
            overflow: 'hidden',
            padding: '8px 8px 8px',
            background: 'var(--dsw-alias-bg-module-platform)',
            borderTop: '1px solid var(--dsw-alias-border-l2)',
            borderBottomLeftRadius: 13,
            borderBottomRightRadius: 13,
          }}
        >
          {series.map(item => {
            const dimmed = hidden.has(item.key)
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={!dimmed}
                onClick={() => onToggleSeries(item.key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  minHeight: 20,
                  padding: '0 4px',
                  border: 'none',
                  borderRadius: 999,
                  background: 'transparent',
                  color: 'var(--dsw-alias-label-secondary)',
                  opacity: dimmed ? 0.42 : 1,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 650,
                  textDecoration: dimmed ? 'line-through' : 'none',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 99, background: item.color, flexShrink: 0 }} />
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
