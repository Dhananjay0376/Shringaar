import { Link, useParams } from 'react-router-dom'
import { StorefrontCanvas } from '@/components/storefront/StorefrontCanvas'
import { Icon } from '@/components/ui/Icon'
import { LoadingAnnouncement } from '@/components/ui/Skeleton'
import { paths } from '@/routes/paths'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { usePublicStorefront } from '../hooks/usePublicCatalog'

/**
 * Public storefront.
 *
 * The page a QR code opens. It renders the same `StorefrontCanvas` the seller previews in My Store,
 * so there is no such thing as a preview that looks better than the real page.
 *
 * Nothing here needs a session: this is the customer side of the product, and the only data it can
 * read is a store's published catalogue. Drafts are filtered out before they reach the canvas.
 */

export function PublicStore() {
  const { storeSlug } = useParams<{ storeSlug: string }>()
  const storefront = usePublicStorefront(storeSlug)

  // A customer opening a shared link must not get a tab labelled "Seller Dashboard".
  useDocumentTitle(
    storefront.loading
      ? 'Shringaar'
      : storefront.data
        ? `${storefront.data.store.name} — Shringaar`
        : 'Store not found — Shringaar',
  )

  if (storefront.loading) {
    return (
      <div className="storefront-page">
        <LoadingAnnouncement label="Loading storefront" />
        <div className="skeleton-stack" style={{ padding: 'var(--sp-8)' }}>
          <div className="skeleton skeleton--title" />
          <div className="skeleton skeleton--card" />
        </div>
      </div>
    )
  }

  if (storefront.error) {
    return (
      <div className="notfound">
        <div className="auth__card" role="alert">
          <span className="empty__icon">
            <Icon name="alert" size={22} />
          </span>
          <h1 className="auth__title">This store could not be loaded</h1>
          <p className="auth__desc">{storefront.error}</p>
          <button type="button" className="btn btn--secondary" onClick={storefront.reload}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!storefront.data) {
    return (
      <div className="notfound">
        <div className="auth__card">
          <span className="empty__icon">
            <Icon name="store" size={22} />
          </span>
          <h1 className="auth__title">No store at /s/{storeSlug}</h1>
          <p className="auth__desc">
            This address does not belong to a store. Check the link or the QR code you scanned — a
            store address never changes on its own.
          </p>
          <Link className="btn btn--secondary" to={paths.seller.dashboard}>
            Go to the seller dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="storefront-page">
      {storefront.dataSource === 'demo' ? (
        <div className="storefront-page__notice">
          <div className="banner banner--demo" role="note">
            <span className="banner__icon">
              <Icon name="info" size={16} />
            </span>
            <div className="banner__body">
              <div className="banner__title">Sample storefront</div>
              <p>
                This store and its products are demonstration data, not a real shop. Nothing here can
                be ordered, and the contact details are examples.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <StorefrontCanvas
        store={storefront.data.store}
        products={storefront.data.products}
        viewer="public"
        linkMode="route"
      />
    </div>
  )
}
