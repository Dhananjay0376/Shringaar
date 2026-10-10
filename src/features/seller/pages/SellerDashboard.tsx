import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button, btnClass } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { PageHeader } from '@/components/ui/PageHeader'
import { ProductCardSkeleton, StatSkeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { STATUS_LABELS, STATUS_TONES } from '@/lib/catalog'
import { copyText } from '@/lib/clipboard'
import { formatCompact, formatNumber, formatRelativeTime, pluralise } from '@/lib/format'
import { paths } from '@/routes/paths'
import { useSeller } from '../context/SellerContext'
import { useActivity, useAnalytics, useProducts } from '../hooks/useProducts'
import { productCategoryLabel, productUrl, priceLabel, sortByUpdatedDesc, storeUrl } from '../utils/product'
import { ActivityFeed } from '../components/ActivityFeed'
import { DemoModeBanner } from '../components/DemoModeBanner'
import { EmptyState } from '../components/EmptyState'
import { QrDialog } from '../components/QrDialog'
import { StatCard } from '../components/StatCard'

/**
 * Overview.
 *
 * Answers one question — "is anything happening with my shop?" — in the order a seller asks it:
 * the four headline numbers, then the products they just touched, then the log of what changed.
 *
 * The numbers come from `getAnalytics(30)`, which in demo mode is generated traffic. Every tile that
 * shows them carries a demo chip, and the page states it in words as well; see arch.md §5 for why
 * this is not optional.
 */

const RECENT_LIMIT = 5

export function SellerDashboard() {
  const { store, isDemo, demoBannerDismissed, dismissDemoBanner } = useSeller()
  const toast = useToast()

  const products = useProducts()
  const activity = useActivity(6)
  const analytics = useAnalytics(30)

  const [qrOpen, setQrOpen] = useState(false)

  const storeLink = store ? storeUrl(store) : ''

  const recentProducts = useMemo(
    () => sortByUpdatedDesc(products.data ?? []).slice(0, RECENT_LIMIT),
    [products.data],
  )

  const publishedCount = useMemo(
    () => (products.data ?? []).filter((product) => product.status === 'published').length,
    [products.data],
  )

  const totals = analytics.summary?.totals

  async function handleCopyStoreLink() {
    const copied = await copyText(storeLink)
    if (copied) {
      toast.success('Store link copied. Anyone with it can browse your storefront.')
    } else {
      toast.error('The browser blocked clipboard access. Open the QR dialog to copy the link manually.')
    }
  }

  return (
    <>
      <PageHeader
        banner={
          isDemo && !demoBannerDismissed ? <DemoModeBanner seeded onDismiss={dismissDemoBanner} /> : null
        }
        title="Overview"
        subtitle={
          store
            ? `How ${store.name} is doing over the last 30 days.`
            : 'How your store is doing over the last 30 days.'
        }
        actions={
          <>
            <Button icon="copy" onClick={handleCopyStoreLink} disabled={!store}>
              Copy store link
            </Button>
            <Button icon="qr" onClick={() => setQrOpen(true)} disabled={!store}>
              QR code
            </Button>
            <a
              className={btnClass({ variant: 'secondary', icon: 'external' })}
              href={storeLink}
              target="_blank"
              rel="noreferrer noopener"
            >
              View my store
            </a>
            <Link className={btnClass({ variant: 'primary', icon: 'plusCircle' })} to={paths.seller.addProduct}>
              Add product
            </Link>
          </>
        }
      />

      {/* ── Headline numbers ─────────────────────────────────────────────── */}
      <section aria-labelledby="overview-metrics">
        <h2 className="sr-only" id="overview-metrics">
          Store metrics for the last 30 days
        </h2>

        {analytics.loading ? (
          <div className="stat-grid">
            {[0, 1, 2, 3].map((key) => (
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
        ) : (
          <div className="stat-grid">
            <StatCard
              label="Total products"
              value={products.loading ? '—' : formatNumber(products.data?.length ?? 0)}
              icon="box"
              footnote={
                products.loading
                  ? 'Loading…'
                  : `${pluralise(publishedCount, 'published product')}`
              }
            />
            <StatCard
              label="Product views"
              value={formatCompact(totals?.productViews ?? 0)}
              icon="eye"
              delta={analytics.summary?.previousTotals.productViews ? percentDelta(totals?.productViews ?? 0, analytics.summary.previousTotals.productViews) : null}
              footnote="Last 30 days"
              isDemo={isDemo}
            />
            <StatCard
              label="Try-on sessions"
              value={formatCompact(totals?.tryOnStarts ?? 0)}
              icon="sparkle"
              delta={analytics.summary?.previousTotals.tryOnStarts ? percentDelta(totals?.tryOnStarts ?? 0, analytics.summary.previousTotals.tryOnStarts) : null}
              footnote="Last 30 days"
              isDemo={isDemo}
            />
            <StatCard
              label="Outbound clicks"
              value={formatCompact(totals?.outboundClicks ?? 0)}
              icon="external"
              delta={analytics.summary?.previousTotals.outboundClicks ? percentDelta(totals?.outboundClicks ?? 0, analytics.summary.previousTotals.outboundClicks) : null}
              footnote="Visits that left for your site or WhatsApp"
              isDemo={isDemo}
            />
          </div>
        )}
      </section>

      {/* ── Recent products + activity ───────────────────────────────────── */}
      <div className="grid-2" style={{ marginTop: 'var(--sp-6)' }}>
        <Card>
          <CardHeader
            title="Recent products"
            subtitle="The products you touched most recently."
            actions={
              <Link className="btn btn--ghost btn--sm" to={paths.seller.products}>
                All products
              </Link>
            }
          />

          {products.loading ? (
            <CardBody>
              <div className="product-grid">
                {[0, 1, 2].map((key) => (
                  <ProductCardSkeleton key={key} />
                ))}
              </div>
            </CardBody>
          ) : products.error ? (
            <CardBody>
              <div className="callout callout--warning" role="alert">
                <span className="callout__icon">
                  <Icon name="alert" size={15} />
                </span>
                <span>
                  {products.error}{' '}
                  <button type="button" className="btn btn--link btn--sm" onClick={products.reload}>
                    Try again
                  </button>
                </span>
              </div>
            </CardBody>
          ) : recentProducts.length === 0 ? (
            <CardBody>
              <EmptyState
                compact
                icon="package"
                title="No products yet"
                description="Add your first product and it will appear here, along with its public link and QR code."
                action={
                  <Link className={btnClass({ variant: 'primary', icon: 'plusCircle' })} to={paths.seller.addProduct}>
                    Add product
                  </Link>
                }
              />
            </CardBody>
          ) : (
            <CardBody flush>
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">Your five most recently updated products</caption>
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col">Price</th>
                      <th scope="col">Status</th>
                      <th scope="col">Updated</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentProducts.map((product) => (
                      <tr key={product.id}>
                        <td>
                          <div className="table__product">
                            {product.image ? (
                              <img
                                className="table__thumb"
                                src={product.image.url}
                                alt=""
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <span className="table__thumb table__thumb--empty" aria-hidden="true">
                                <Icon name="image" size={15} />
                              </span>
                            )}
                            <div style={{ minWidth: 0 }}>
                              <div className="table__name truncate">{product.name}</div>
                              <div className="table__sub">{productCategoryLabel(product)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="table__num">{priceLabel(product)}</td>
                        <td>
                          <Badge tone={STATUS_TONES[product.status]} dot>
                            {STATUS_LABELS[product.status]}
                          </Badge>
                        </td>
                        <td className="text-muted text-xs">{formatRelativeTime(product.updatedAt)}</td>
                        <td>
                          <div className="table__actions">
                            <Link
                              className="btn btn--ghost btn--sm"
                              to={paths.seller.editProduct(product.id)}
                            >
                              Edit
                            </Link>
                            <a
                              className="icon-btn icon-btn--sm"
                              href={store ? productUrl(product, store) : '#'}
                              target="_blank"
                              rel="noreferrer noopener"
                              aria-label={`Open the public page for ${product.name}`}
                              title="Open public page"
                            >
                              <Icon name="external" size={15} />
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" subtitle="Changes made to this store." />
          {activity.loading ? (
            <CardBody>
              <div className="skeleton-stack">
                {[0, 1, 2, 3].map((key) => (
                  <div className="skeleton skeleton--text" key={key} />
                ))}
              </div>
            </CardBody>
          ) : activity.error ? (
            <CardBody>
              <div className="callout callout--warning" role="alert">
                <span className="callout__icon">
                  <Icon name="alert" size={15} />
                </span>
                <span>{activity.error}</span>
              </div>
            </CardBody>
          ) : (
            <CardBody flush>
              <ActivityFeed events={activity.data ?? []} />
            </CardBody>
          )}
        </Card>
      </div>

      {store ? (
        <QrDialog
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          title="Store QR code"
          description="Print this anywhere a customer can scan it. It opens your public storefront."
          url={storeLink}
          fileName={`shringaar-${store.slug}-store`}
        />
      ) : null}
    </>
  )
}

/** Percentage change between two periods, or null when there is no baseline to compare against. */
function percentDelta(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}
