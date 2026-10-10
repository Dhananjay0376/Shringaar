import { Link, Navigate, useParams } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { LoadingAnnouncement } from '@/components/ui/Skeleton'
import {
  categoryLabel,
  hasUsableTryOnAsset,
  productPublicUrl,
  resolveContactWhatsApp,
  storePath,
  tryOnUrl,
  whatsAppLink,
} from '@/lib/catalog'
import { config } from '@/lib/config'
import { formatCurrency } from '@/lib/format'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { paths } from '@/routes/paths'
import { usePublicProductView, useResolveProduct } from '../hooks/usePublicCatalog'
import type { ProductView } from '@/features/seller/types/seller'

/**
 * Public product page.
 *
 * Where a scanned QR code lands, and where the try-on experience starts. Everything about the
 * customer's next step lives here: try-on if the product has a usable asset, WhatsApp using the
 * number that belongs to *this* product (its own, falling back to the store's), and the seller's own
 * website if they linked one.
 *
 * The try-on button is only rendered when there is both a usable asset and a configured try-on host.
 * A button that leads nowhere — or worse, to a promise of a 3D model built from a photograph — is the
 * specific dishonesty arch.md §8 exists to prevent.
 */

export function PublicProduct() {
  const { storeSlug, productId } = useParams<{ storeSlug: string; productId: string }>()
  const product = usePublicProductView(storeSlug, productId)

  useDocumentTitle(
    product.loading
      ? 'Shringaar'
      : product.data
        ? `${product.data.product.name} — ${product.data.store.name}`
        : 'Product not available — Shringaar',
  )

  if (product.loading) {
    return (
      <div className="storefront-page">
        <LoadingAnnouncement label="Loading product" />
        <div className="skeleton-stack" style={{ padding: 'var(--sp-8)' }}>
          <div className="skeleton skeleton--title" />
          <div className="skeleton skeleton--card" />
        </div>
      </div>
    )
  }

  if (product.error) {
    return (
      <div className="notfound">
        <div className="auth__card" role="alert">
          <span className="empty__icon">
            <Icon name="alert" size={22} />
          </span>
          <h1 className="auth__title">This product could not be loaded</h1>
          <p className="auth__desc">{product.error}</p>
          <button type="button" className="btn btn--secondary" onClick={product.reload}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!product.data) {
    return <ProductNotFound />
  }

  return <ProductDetail view={product.data} isDemo={product.dataSource === 'demo'} />
}

/**
 * Bare `/p/:productId` links — from a printed QR code made before the store-scoped URL existed, or a
 * paste that lost its path. Resolves the owning store and forwards to the canonical URL rather than
 * rendering a page that cannot say which seller it belongs to.
 */
export function PublicProductResolver() {
  const { productId } = useParams<{ productId: string }>()
  const resolved = useResolveProduct(productId)

  useDocumentTitle(resolved.loading ? 'Shringaar' : 'Product not available — Shringaar')

  if (resolved.loading) {
    return (
      <div className="storefront-page">
        <LoadingAnnouncement label="Finding this product" />
        <div className="skeleton-stack" style={{ padding: 'var(--sp-8)' }}>
          <div className="skeleton skeleton--card" />
        </div>
      </div>
    )
  }

  if (!resolved.data) {
    return <ProductNotFound />
  }

  return (
    <Navigate
      to={paths.public.product(resolved.data.store.slug, resolved.data.product.id)}
      replace
    />
  )
}

function ProductNotFound() {
  return (
    <div className="notfound">
      <div className="auth__card">
        <span className="empty__icon">
          <Icon name="package" size={22} />
        </span>
        <h1 className="auth__title">This product is not available</h1>
        <p className="auth__desc">
          The product may have been removed by the seller, or the link may be incomplete. Try scanning
          the QR code again, or browse the store it came from.
        </p>
        <Link className="btn btn--secondary" to={paths.root}>
          Back to Shringaar
        </Link>
      </div>
    </div>
  )
}

function ProductDetail({ view, isDemo }: { view: ProductView; isDemo: boolean }) {
  const { store, product } = view

  const tryOnReady = hasUsableTryOnAsset(product)
  const tryOnHref = tryOnUrl(config.tryOnBaseUrl, product.id)
  const contactNumber = resolveContactWhatsApp(product, store)
  const whatsapp = contactNumber ? whatsAppLink(contactNumber) : null
  const publicUrl = productPublicUrl(config.publicSiteUrl, store.slug, product.id)

  const usesProductNumber =
    Boolean(product.whatsappNumber?.trim()) &&
    product.whatsappNumber?.trim() !== store.whatsappNumber?.trim()

  return (
    <div className="storefront-page">
      <div className="storefront__topbar">
        <Link className="brandmark" to={storePath(store.slug)} aria-label={`${store.name} storefront`}>
          श
        </Link>
        <Link className="brandmark__name" to={storePath(store.slug)} style={{ fontSize: '1rem' }}>
          {store.name}
        </Link>
        <span className="storefront__topbar-label">Virtual try-on storefront</span>
      </div>

      {isDemo ? (
        <div className="storefront-page__notice">
          <div className="banner banner--demo" role="note">
            <span className="banner__icon">
              <Icon name="info" size={16} />
            </span>
            <div className="banner__body">
              <div className="banner__title">Sample product</div>
              <p>
                This product and its seller are demonstration data. Nothing here can be ordered and the
                contact details are examples.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="product-detail">
        <div className="product-detail__media">
          {product.image ? (
            <img src={product.image.url} alt={product.name} decoding="async" />
          ) : (
            <div className="product-detail__placeholder">
              <Icon name="image" size={30} />
              <span className="sr-only">No product image</span>
            </div>
          )}
        </div>

        <div className="product-detail__panel">
          <p className="product-detail__cat">{categoryLabel(product.category)}</p>
          <h1 className="product-detail__name">{product.name}</h1>
          <p className="product-detail__price tabular">
            {formatCurrency(product.price, product.currency)}
          </p>

          {product.description ? (
            <p className="product-detail__desc">{product.description}</p>
          ) : null}

          {/* ── Try-on ──────────────────────────────────────────────────── */}
          {tryOnReady && tryOnHref ? (
            <div className="tryon-panel">
              <p className="tryon-panel__title">
                <Icon name="sparkle" size={16} />
                Try it on
              </p>
              <p className="tryon-panel__text">
                See how this piece looks on you, using your camera. Nothing is uploaded — the
                try-on runs against the seller’s asset for this exact product.
              </p>
              <a
                className="btn btn--primary btn--block"
                href={tryOnHref}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Icon name="sparkle" size={16} />
                Launch virtual try-on
              </a>
            </div>
          ) : tryOnReady ? (
            // The asset is usable but no try-on client is deployed. Say which half is missing.
            <div className="callout callout--info">
              <span className="callout__icon">
                <Icon name="info" size={15} />
              </span>
              <span>
                This product has a try-on asset ready, but no try-on experience is deployed yet. The
                seller has done their part — the AR client is the missing piece.
              </span>
            </div>
          ) : (
            <div className="callout callout--info">
              <span className="callout__icon">
                <Icon name="info" size={15} />
              </span>
              <span>
                Virtual try-on is not available for this piece yet. You can still view it in detail and
                contact the seller.
              </span>
            </div>
          )}

          {/* ── Contact ─────────────────────────────────────────────────── */}
          {whatsapp ? (
            <a
              className="btn btn--secondary btn--block"
              href={whatsapp}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Icon name="whatsapp" size={16} />
              Ask about this piece on WhatsApp
            </a>
          ) : (
            <p className="text-xs text-muted">
              This seller has not added a contact number, so there is no enquiry button on this page.
            </p>
          )}

          {product.externalProductUrl ? (
            <a
              className="btn btn--ghost btn--block"
              href={product.externalProductUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Icon name="external" size={16} />
              View on the seller’s website
            </a>
          ) : null}

          {/* ── Facts ───────────────────────────────────────────────────── */}
          <dl className="product-detail__facts">
            <div className="fact">
              <dt className="fact__label">Store</dt>
              <dd className="fact__value">
                <Link to={storePath(store.slug)}>{store.name}</Link>
              </dd>
            </div>
            <div className="fact">
              <dt className="fact__label">Category</dt>
              <dd className="fact__value">{categoryLabel(product.category)}</dd>
            </div>
            <div className="fact">
              <dt className="fact__label">Price</dt>
              <dd className="fact__value">
                {formatCurrency(product.price, product.currency)} {product.currency}
              </dd>
            </div>
            <div className="fact">
              <dt className="fact__label">Try-on</dt>
              <dd className="fact__value">
                {tryOnReady ? 'Asset available' : 'Not available'}
              </dd>
            </div>
            {whatsapp ? (
              <div className="fact">
                <dt className="fact__label">Enquiries go to</dt>
                <dd className="fact__value">
                  {contactNumber}
                  <span className="text-muted">
                    {usesProductNumber ? ' (set for this product)' : ' (the store’s number)'}
                  </span>
                </dd>
              </div>
            ) : null}
          </dl>

          <p className="text-xs text-muted">
            <Icon name="link" size={12} /> This page’s address: <span className="mono">{publicUrl}</span>
          </p>
        </div>
      </div>
    </div>
  )
}
