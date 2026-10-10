import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, btnClass } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { ProductCardSkeleton, ListSkeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { CATEGORY_OPTIONS, PRODUCT_STATUSES, STATUS_LABELS } from '@/lib/catalog'
import { copyText } from '@/lib/clipboard'
import { pluralise } from '@/lib/format'
import { paths } from '@/routes/paths'
import { useSeller } from '../context/SellerContext'
import { useDebounced } from '../hooks/useDebounced'
import { useProducts } from '../hooks/useProducts'
import type { Product, ProductCategory, ProductStatus } from '../types/seller'
import { productCategoryLabel, productUrl, sortByUpdatedDesc } from '../utils/product'
import { EmptyState } from '../components/EmptyState'
import { ProductCard } from '../components/ProductCard'
import { ProductTable } from '../components/ProductTable'
import { QrDialog } from '../components/QrDialog'

/**
 * Products.
 *
 * The catalogue screen: find a product, check whether it is published and try-on ready, then act on
 * it. Filtering runs through the service rather than in the browser, so the same query works
 * unchanged against a real backend with server-side filtering.
 *
 * Two views because the job differs: the grid answers "which product is this?" and the table answers
 * "which of these are still drafts?".
 */

type ViewMode = 'grid' | 'table'

export function SellerProducts() {
  const { store } = useSeller()
  const toast = useToast()
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<ProductCategory | 'all'>('all')
  const [status, setStatus] = useState<ProductStatus | 'all'>('all')
  const [view, setView] = useState<ViewMode>('grid')

  // Only the debounced term reaches the service; the input stays instant.
  const debouncedSearch = useDebounced(search)
  const products = useProducts({ search: debouncedSearch, category, status })

  const [pendingDelete, setPendingDelete] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [qrProduct, setQrProduct] = useState<Product | null>(null)

  const sorted = useMemo(() => sortByUpdatedDesc(products.data ?? []), [products.data])

  // "You have no products" and "nothing matches this filter" are different situations and need
  // different next steps — the first offers Add product, the second offers Clear filters.
  const filtersActive = debouncedSearch.trim() !== '' || category !== 'all' || status !== 'all'

  async function handleCopyLink(product: Product) {
    if (!store) return
    const copied = await copyText(productUrl(product, store))
    if (copied) {
      toast.success(`Public link for "${product.name}" copied.`)
    } else {
      toast.error('The browser blocked clipboard access. Open the QR dialog to copy the link instead.')
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return

    setDeleting(true)
    try {
      await products.deleteProduct(pendingDelete.id)
      toast.success(`"${pendingDelete.name}" was deleted.`)
      setPendingDelete(null)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'The product could not be deleted.')
    } finally {
      setDeleting(false)
    }
  }

  function clearFilters() {
    setSearch('')
    setCategory('all')
    setStatus('all')
  }

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Everything in your catalogue, with its public link and try-on availability."
        actions={
          <Link className={btnClass({ variant: 'primary', icon: 'plusCircle' })} to={paths.seller.addProduct}>
            Add product
          </Link>
        }
      />

      <Card>
        <div className="toolbar">
          <div className="toolbar__search">
            <span className="toolbar__search-icon" aria-hidden="true">
              <Icon name="search" size={16} />
            </span>
            <label className="sr-only" htmlFor="product-search">
              Search products by name, category or description
            </label>
            <input
              className="input"
              id="product-search"
              type="search"
              placeholder="Search products…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="toolbar__filters">
            <label className="sr-only" htmlFor="product-category">
              Filter by category
            </label>
            <select
              className="select toolbar__select"
              id="product-category"
              value={category}
              onChange={(event) => setCategory(event.target.value as ProductCategory | 'all')}
            >
              <option value="all">All categories</option>
              {CATEGORY_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor="product-status">
              Filter by publication status
            </label>
            <select
              className="select toolbar__select"
              id="product-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as ProductStatus | 'all')}
            >
              <option value="all">All statuses</option>
              {PRODUCT_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {STATUS_LABELS[item]}
                </option>
              ))}
            </select>

            <div className="view-toggle" role="group" aria-label="Change how products are displayed">
              <button
                type="button"
                className={`view-toggle__btn ${view === 'grid' ? 'view-toggle__btn--active' : ''}`}
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
              >
                <Icon name="gridView" size={16} />
                <span className="sr-only">Card view</span>
              </button>
              <button
                type="button"
                className={`view-toggle__btn ${view === 'table' ? 'view-toggle__btn--active' : ''}`}
                aria-pressed={view === 'table'}
                onClick={() => setView('table')}
              >
                <Icon name="listView" size={16} />
                <span className="sr-only">Table view</span>
              </button>
            </div>
          </div>
        </div>

        <div className="toolbar__meta" role="status" aria-live="polite">
          {products.loading
            ? 'Loading products…'
            : filtersActive
              ? `${pluralise(sorted.length, 'product')} ${
                  sorted.length === 1 ? 'matches' : 'match'
                } your filters`
              : pluralise(sorted.length, 'product')}
        </div>

        {products.loading ? (
          <CardBody>
            {view === 'grid' ? (
              <div className="product-grid">
                {[0, 1, 2, 3, 4, 5].map((key) => (
                  <ProductCardSkeleton key={key} />
                ))}
              </div>
            ) : (
              <ListSkeleton rows={5} />
            )}
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
        ) : sorted.length === 0 ? (
          <CardBody>
            {filtersActive ? (
              <EmptyState
                compact
                icon="search"
                title="No products match these filters"
                description="Try a different search term, or widen the category and status filters."
                action={
                  <Button variant="secondary" icon="refresh" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon="package"
                title="Your catalogue is empty"
                description="Add a product with a photo, a price and its try-on asset. It will get a public link and a QR code the moment you save it."
                action={
                  <Link className={btnClass({ variant: 'primary', icon: 'plusCircle' })} to={paths.seller.addProduct}>
                    Add your first product
                  </Link>
                }
              />
            )}
          </CardBody>
        ) : (
          <CardBody flush={view === 'table'}>
            {store ? (
              view === 'grid' ? (
                <div className="product-grid">
                  {sorted.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      store={store}
                      onEdit={() => navigate(paths.seller.editProduct(product.id))}
                      onDelete={() => setPendingDelete(product)}
                      onCopyLink={() => void handleCopyLink(product)}
                      onShowQr={() => setQrProduct(product)}
                    />
                  ))}
                </div>
              ) : (
                <ProductTable
                  products={sorted}
                  store={store}
                  onEdit={(product) => navigate(paths.seller.editProduct(product.id))}
                  onDelete={(product) => setPendingDelete(product)}
                  onCopyLink={(product) => void handleCopyLink(product)}
                  onShowQr={(product) => setQrProduct(product)}
                />
              )
            ) : null}
          </CardBody>
        )}
      </Card>

      {/* One delete dialog for the whole page, not one per row. */}
      <Modal
        open={pendingDelete !== null}
        onClose={() => (deleting ? undefined : setPendingDelete(null))}
        title="Delete this product?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" will be removed from your catalogue.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" icon="trash" loading={deleting} onClick={handleDelete}>
              Delete product
            </Button>
          </>
        }
      >
        {pendingDelete ? (
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            <div className="callout callout--warning">
              <span className="callout__icon">
                <Icon name="alert" size={15} />
              </span>
              <span>
                Its public link and QR code will stop working. Anyone who already printed the QR code
                will land on a page that no longer resolves.
              </span>
            </div>

            <dl className="fact-list">
              <div className="fact">
                <dt className="fact__label">Category</dt>
                <dd className="fact__value">{productCategoryLabel(pendingDelete)}</dd>
              </div>
              <div className="fact">
                <dt className="fact__label">Status</dt>
                <dd className="fact__value">{STATUS_LABELS[pendingDelete.status]}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </Modal>

      {store && qrProduct ? (
        <QrDialog
          open
          onClose={() => setQrProduct(null)}
          title="Product QR code"
          description="Scanning this opens the public page for this exact product."
          url={productUrl(qrProduct, store)}
          fileName={`shringaar-${store.slug}-${qrProduct.slug}`}
          extraRows={[
            { label: 'Product', value: qrProduct.name },
            { label: 'Category', value: productCategoryLabel(qrProduct) },
            { label: 'Store', value: store.name },
          ]}
        />
      ) : null}
    </>
  )
}
