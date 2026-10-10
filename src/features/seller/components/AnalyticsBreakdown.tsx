import { formatNumber } from '@/lib/format'
import type { AnalyticsTopProduct } from '../types/seller'

/**
 * Per-product breakdown.
 *
 * Bars are scaled against the busiest product in the list, not against a fixed maximum, so the
 * comparison stays readable whether a store gets ten views a week or ten thousand. The number is
 * always printed next to the bar — the bar is a glance, the number is the fact.
 */

export interface AnalyticsBreakdownProps {
  products: AnalyticsTopProduct[]
  /** Which measure the bars represent. */
  metric: keyof Pick<AnalyticsTopProduct, 'views' | 'tryOnStarts' | 'outboundClicks'>
  metricLabel: string
  /** Renders the row's right-hand figure. Defaults to the raw metric. */
  renderValue?: (product: AnalyticsTopProduct) => string
}

export function AnalyticsBreakdown({
  products,
  metric,
  metricLabel,
  renderValue,
}: AnalyticsBreakdownProps) {
  if (products.length === 0) {
    return (
      <p className="text-muted text-sm" style={{ padding: 'var(--sp-5)' }}>
        No product activity in this period yet.
      </p>
    )
  }

  const max = Math.max(...products.map((product) => product[metric]), 1)

  return (
    <div className="bar-list">
      <p className="bar-list__caption">By {metricLabel.toLowerCase()}</p>

      {products.map((product) => {
        const value = product[metric]
        const percent = (value / max) * 100

        return (
          <div className="bar-row" key={product.productId}>
            <span className="bar-row__name truncate" title={product.name}>
              {product.name}
            </span>

            <span
              className="bar-row__track"
              role="img"
              aria-label={`${product.name}: ${formatNumber(value)} ${metricLabel.toLowerCase()}`}
            >
              <span className="bar-row__fill" style={{ width: `${percent}%` }} />
            </span>

            <span className="bar-row__value tabular">
              {renderValue ? renderValue(product) : formatNumber(value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
