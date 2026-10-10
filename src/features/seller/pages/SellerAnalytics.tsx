import { useState } from 'react'
import { Badge, DemoBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card'
import { Icon, type IconName } from '@/components/ui/Icon'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatSkeleton } from '@/components/ui/Skeleton'
import { formatCompact, formatDateTime, formatNumber } from '@/lib/format'
import { useSeller } from '../context/SellerContext'
import { useAnalytics } from '../hooks/useProducts'
import type { AnalyticsPoint, AnalyticsRange } from '../types/seller'
import { AnalyticsBreakdown } from '../components/AnalyticsBreakdown'
import { AnalyticsChart } from '../components/AnalyticsChart'
import { StatCard } from '../components/StatCard'

/**
 * Analytics.
 *
 * Five measures, one trend line and a per-product breakdown. Everything here is read-only, and the
 * page says plainly where the numbers come from: measured traffic when a backend is recording
 * events, generated sample data when it is not. A chart with no provenance is the easiest way to
 * show a seller something that is not true — see arch.md §5.
 */

type Metric = keyof Omit<AnalyticsPoint, 'date'>

interface MetricDefinition {
  label: string
  icon: IconName
  /** How the measure is described in the chart legend and breakdown caption. */
  noun: string
  description: string
  /** Whether the axis should use compact notation. */
  compact: boolean
}

/** Ordered for display, keyed for lookup — `Metric` is a closed union so neither can go missing. */
const METRIC_ORDER: Metric[] = [
  'storeVisits',
  'productViews',
  'tryOnStarts',
  'outboundClicks',
  'contactClicks',
]

const METRICS: Record<Metric, MetricDefinition> = {
  storeVisits: {
    label: 'Store visits',
    icon: 'store',
    noun: 'store visits',
    description: 'Sessions that opened your storefront.',
    compact: true,
  },
  productViews: {
    label: 'Product views',
    icon: 'eye',
    noun: 'product views',
    description: 'Product pages opened, including repeat views.',
    compact: true,
  },
  tryOnStarts: {
    label: 'Try-on starts',
    icon: 'sparkle',
    noun: 'try-on starts',
    description: 'Times a customer opened the try-on experience.',
    compact: true,
  },
  outboundClicks: {
    label: 'Outbound clicks',
    icon: 'external',
    noun: 'outbound clicks',
    description: 'Visits that left for your own website.',
    compact: true,
  },
  contactClicks: {
    label: 'Contact clicks',
    icon: 'whatsapp',
    noun: 'contact clicks',
    description: 'WhatsApp and phone taps from your storefront.',
    compact: true,
  },
}

const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
]

export function SellerAnalytics() {
  const { isDemo } = useSeller()

  const [range, setRange] = useState<AnalyticsRange>(30)
  const [metric, setMetric] = useState<Metric>('productViews')

  const analytics = useAnalytics(range)
  const summary = analytics.summary
  const definition = METRICS[metric]
  const formatValue = definition.compact ? formatCompact : formatNumber

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={
          summary
            ? `Traffic and engagement for the last ${range} days.`
            : 'Traffic and engagement across your storefront.'
        }
        actions={
          <div className="view-toggle" role="group" aria-label="Analytics period">
            {RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`view-toggle__btn ${
                  range === option.value ? 'view-toggle__btn--active' : ''
                }`}
                aria-pressed={range === option.value}
                onClick={() => setRange(option.value)}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        }
      />

      {isDemo ? (
        <div className="banner banner--demo" role="note" style={{ marginBottom: 'var(--sp-5)' }}>
          <span className="banner__icon">
            <Icon name="info" size={17} />
          </span>
          <div className="banner__body">
            <div className="banner__title">These figures are sample data</div>
            <p>
              No analytics events are being recorded, so every number on this page is generated for
              demonstration. They are patterned — weekly cycles and a slow upward trend — but they are
              not measurements of anything. Real figures appear once a connected backend records
              storefront events.
            </p>
          </div>
        </div>
      ) : null}

      {/* ── Measure tiles ────────────────────────────────────────────────── */}
      <section aria-labelledby="analytics-metrics">
        <h2 className="sr-only" id="analytics-metrics">
          Totals for the selected period
        </h2>

        {analytics.loading && !summary ? (
          <div className="stat-grid">
            {METRIC_ORDER.map((key) => (
              <StatSkeleton key={key} />
            ))}
          </div>
        ) : analytics.error ? (
          <Card>
            <CardBody>
              <div className="callout callout--warning" role="alert">
                <span className="callout__icon">
                  <Icon name="alert" size={15} />
                </span>
                <span>
                  {analytics.error}{' '}
                  <button type="button" className="btn btn--link btn--sm" onClick={analytics.reload}>
                    Try again
                  </button>
                </span>
              </div>
            </CardBody>
          </Card>
        ) : summary ? (
          <>
            <div className="stat-grid">
              {METRIC_ORDER.map((key) => {
                const item = METRICS[key]

                return (
                  <StatCard
                    key={key}
                    label={item.label}
                    value={formatCompact(summary.totals[key])}
                    icon={item.icon}
                    delta={percentDelta(summary.totals[key], summary.previousTotals[key])}
                    footnote={item.description}
                    isDemo={summary.dataSource === 'demo'}
                  />
                )
              })}
            </div>

            <p className="text-xs text-muted" style={{ marginTop: 'var(--sp-3)' }}>
              Deltas compare this period with the {range} days before it.{' '}
              {summary.dataSource === 'demo'
                ? 'Generated sample data.'
                : `Recorded measurements, last updated ${formatDateTime(summary.generatedAt)}.`}
            </p>
          </>
        ) : null}
      </section>

      {/* ── Trend ────────────────────────────────────────────────────────── */}
      <Card style={{ marginTop: 'var(--sp-6)' }}>
        <CardHeader
          title={`${definition.label} over time`}
          subtitle={definition.description}
          actions={
            <div className="view-toggle" role="group" aria-label="Choose a measure to plot">
              {METRIC_ORDER.map((key) => {
                const item = METRICS[key]

                return (
                  <button
                    key={key}
                    type="button"
                    className={`view-toggle__btn ${
                      metric === key ? 'view-toggle__btn--active' : ''
                    }`}
                    aria-pressed={metric === key}
                    title={item.label}
                    onClick={() => setMetric(key)}
                  >
                    <Icon name={item.icon} size={15} />
                    <span className="sr-only">{item.label}</span>
                  </button>
                )
              })}
            </div>
          }
        />

        <CardBody>
          {analytics.loading && !summary ? (
            <div className="skeleton" style={{ height: 220 }} />
          ) : summary ? (
            <AnalyticsChart
              series={summary.series}
              metric={metric}
              label={definition.label}
              formatValue={formatValue}
              total={summary.totals[metric]}
            />
          ) : (
            <p className="text-muted text-sm">No data for this period.</p>
          )}
        </CardBody>
      </Card>

      {/* ── Per-product breakdown ────────────────────────────────────────── */}
      <Card style={{ marginTop: 'var(--sp-5)' }}>
        <CardHeader
          title="Top products"
          subtitle="Which products are earning the attention."
          actions={summary?.dataSource === 'demo' ? <DemoBadge /> : null}
        />

        <CardBody flush>
          {analytics.loading && !summary ? (
            <div className="skeleton-stack" style={{ padding: 'var(--sp-5)' }}>
              {[0, 1, 2, 3].map((key) => (
                <div className="skeleton skeleton--text" key={key} />
              ))}
            </div>
          ) : summary && summary.topProducts.length > 0 ? (
            <AnalyticsBreakdown
              products={summary.topProducts}
              metric="views"
              metricLabel="Product views"
              renderValue={(product) => formatNumber(product.views)}
            />
          ) : (
            <div className="empty empty--compact">
              <span className="empty__icon">
                <Icon name="chart" size={22} />
              </span>
              <h3 className="empty__title">Nothing to rank yet</h3>
              <p className="empty__desc">
                Once customers start opening your product pages, the busiest ones appear here.
              </p>
            </div>
          )}
        </CardBody>

        {summary && summary.topProducts.length > 0 ? (
          <CardFooter>
            <span className="text-xs text-muted">
              Try-on starts and outbound clicks per product are recorded alongside views and will be
              broken out here once a backend is recording events.
            </span>
            <span className="spacer" />
            {analytics.loading ? (
              <Badge tone="neutral" icon="refresh">
                Refreshing…
              </Badge>
            ) : (
              <Button variant="ghost" size="sm" icon="refresh" onClick={analytics.reload}>
                Refresh
              </Button>
            )}
          </CardFooter>
        ) : null}
      </Card>
    </>
  )
}

function percentDelta(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}
