import { formatDayShort } from '@/lib/format'
import type { AnalyticsPoint } from '../types/seller'

/**
 * Trend chart, hand-rolled in SVG.
 *
 * One chart style, one visual language, and about two kilobytes instead of a charting library —
 * see design.md D13. The chart is decorative: the exact numbers live in the stat tiles and the
 * per-product breakdown, so this is exposed to assistive tech as a single labelled image rather
 * than as dozens of data points to tab through.
 */

export interface AnalyticsChartProps {
  series: AnalyticsPoint[]
  /** Which measure to plot. */
  metric: keyof Omit<AnalyticsPoint, 'date'>
  label: string
  /** Formats a value for the axis and the summary. */
  formatValue: (value: number) => string
  total: number
}

const VIEW_W = 720
const VIEW_H = 220
const PAD = { top: 14, right: 12, bottom: 26, left: 46 }

export function AnalyticsChart({
  series,
  metric,
  label,
  formatValue,
  total,
}: AnalyticsChartProps) {
  if (series.length === 0) {
    return <p className="text-muted text-sm">No data for this period.</p>
  }

  const values = series.map((point) => point[metric])
  const rawMax = Math.max(...values, 1)
  // Round the axis top up so the gridline label is a readable number, not the exact peak.
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)))
  const max = Math.ceil(rawMax / (magnitude / 2)) * (magnitude / 2)

  const plotW = VIEW_W - PAD.left - PAD.right
  const plotH = VIEW_H - PAD.top - PAD.bottom

  function x(index: number): number {
    if (series.length === 1) return PAD.left + plotW / 2
    return PAD.left + (index / (series.length - 1)) * plotW
  }

  function y(value: number): number {
    return PAD.top + plotH - (value / max) * plotH
  }

  const linePath = series
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point[metric]).toFixed(2)}`)
    .join(' ')

  const areaPath = `${linePath} L${x(series.length - 1).toFixed(2)},${(PAD.top + plotH).toFixed(2)} L${x(0).toFixed(2)},${(PAD.top + plotH).toFixed(2)} Z`

  const gridValues = [0, max / 2, max]
  const first = series[0]
  const middle = series[Math.floor(series.length / 2)]
  const last = series[series.length - 1]

  // Only the last point gets a marker: it is the one a seller reads as "now".
  const lastIndex = series.length - 1
  const lastPoint = series[lastIndex]

  return (
    <div className="chart">
      <div
        className="chart__plot"
        role="img"
        aria-label={`${label} over the last ${series.length} days. Total ${formatValue(total)}, ending at ${formatValue(lastPoint?.[metric] ?? 0)}.`}
      >
        <svg className="chart__svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-hidden="true">
          {gridValues.map((value) => (
            <g key={value}>
              <line
                className="chart__grid"
                x1={PAD.left}
                x2={VIEW_W - PAD.right}
                y1={y(value)}
                y2={y(value)}
              />
              <text className="chart__axis" x={PAD.left - 8} y={y(value) + 3.5} textAnchor="end">
                {formatValue(Math.round(value))}
              </text>
            </g>
          ))}

          <path className="chart__area" d={areaPath} />
          <path className="chart__line" d={linePath} />

          {lastPoint ? (
            <circle className="chart__dot" cx={x(lastIndex)} cy={y(lastPoint[metric])} r={4} />
          ) : null}

          {[first, middle, last].map((point, index) =>
            point ? (
              <text
                className="chart__axis"
                key={point.date}
                x={x(index === 0 ? 0 : index === 1 ? Math.floor(series.length / 2) : lastIndex)}
                y={VIEW_H - 8}
                textAnchor={index === 0 ? 'start' : index === 1 ? 'middle' : 'end'}
              >
                {formatDayShort(point.date)}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      <div className="chart__legend">
        <span className="chart__legend-item">
          <span className="chart__swatch" aria-hidden="true" />
          {label}
        </span>
        <span className="chart__legend-item">
          Total for period: <strong className="tabular">{formatValue(total)}</strong>
        </span>
      </div>
    </div>
  )
}
