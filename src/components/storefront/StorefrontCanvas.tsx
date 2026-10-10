import { Link } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import {
  categoryLabel,
  hasUsableTryOnAsset,
  productPath,
  whatsAppLink,
} from '@/lib/catalog'
import { formatCurrency } from '@/lib/format'
import { placeholderLogoDataUrl } from '@/lib/placeholder'
// Type-only import of the shared contract. The dashboard, this storefront and the future AR client
// all read the same `Product` shape — see arch.md §4. No runtime coupling either way.
import type { Store, Product } from '@/features/seller/types/seller'

/**
 * Presentational storefront.
 *
 * Lives in shared `components/` rather than inside either feature because two very different callers
 * render it: the public `/s/:storeSlug` route a customer sees, and the live preview on the seller's
 * My Store screen. Sharing the markup is what makes the preview trustworthy — it is the same
 * component, not a mock-up that can drift from the real thing.
 *
 * Draft handling is the caller's decision (`products` is already filtered); this component only
 * renders what it is given.
 */

export interface StorefrontCanvasProps {
  store: Store
  products: Product[]
  /** Distinguishes the owner's preview from the real public view, in the banner text only. */
  viewer: 'owner' | 'public'
  /**
   * `route` renders in-app links. `external` opens the real public URL in a new tab — used inside the
   * dashboard preview, where navigating in place would throw the seller out of their editor.
   */
  linkMode: 'route' | 'external'
  /** Origin used to build external links. Defaults to the current origin. */
  origin?: string
}

export function StorefrontCanvas({
  store,
  products,
  viewer,
  linkMode,
  origin = typeof window === 'undefined' ? '' : window.location.origin,
}: StorefrontCanvasProps) {
  const logoSrc = store.logoUrl ?? placeholderLogoDataUrl(store.name)
  const whatsapp = store.whatsappNumber ? whatsAppLink(store.whatsappNumber) : null
  const drafts = products.filter((product) => product.status === 'draft').length

  function productHref(product: Product): string {
    const path = productPath(store.slug, product.id)
    return linkMode === 'route' ? path : `${origin.replace(/\/+$/, '')}${path}`
  }

  return (
    <div className="storefront">
      <div className="storefront__topbar">
        <span className="brandmark" aria-hidden="true">
          श
        </span>
        <span className="brandmark__name" style={{ fontSize: '1rem' }}>
          Shringaar
        </span>
        <span className="storefront__topbar-label">
          {viewer === 'owner'
            ? 'Owner preview — this is the same storefront customers see'
            : 'Virtual try-on storefront'}
        </span>
      </div>

      <header className="storefront__hero">
        {store.logoUrl ? (
          <img className="storefront__logo" src={logoSrc} alt={`${store.name} logo`} />
        ) : (
          <div className="storefront__logo storefront__logo--fallback" aria-hidden="true">
            {store.name.slice(0, 1).toUpperCase()}
          </div>
        )}

        <h1 className="storefront__name">{store.name}</h1>

        {store.description ? <p className="storefront__desc">{store.description}</p> : null}

        {whatsapp || store.contactEmail ? (
          <div className="storefront__contact">
            {whatsapp ? (
              <a
                className="btn btn--secondary btn--sm"
                href={whatsapp}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Icon name="whatsapp" size={15} />
                Chat on WhatsApp
              </a>
            ) : null}

            {store.contactEmail ? (
              <a className="btn btn--secondary btn--sm" href={`mailto:${store.contactEmail}`}>
                <Icon name="mail" size={15} />
                {store.contactEmail}
              </a>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="storefront__body">
        {viewer === 'owner' && drafts > 0 ? (
          <div className="banner banner--info" role="note">
            <span className="banner__icon">
              <Icon name="info" size={16} />
            </span>
            <span className="banner__body">
              {drafts === 1
                ? '1 draft is included below for your preview. Customers cannot see it.'
                : `${drafts} drafts are included below for your preview. Customers cannot see them.`}
            </span>
          </div>
        ) : null}

        {products.length === 0 ? (
          <div className="empty">
            <span className="empty__icon">
              <Icon name="package" size={22} />
            </span>
            <h3 className="empty__title">Nothing published yet</h3>
            <p className="empty__desc">
              {viewer === 'owner'
                ? 'Publish a product and it will appear here, exactly as customers will see it.'
                : 'This store has not published any products yet.'}
            </p>
          </div>
        ) : (
          <div className="storefront__grid">
            {products.map((product) => (
              <article className="storefront__card" key={product.id}>
                <div className="storefront__card-media">
                  {product.image ? (
                    <img src={product.image.url} alt={product.name} loading="lazy" />
                  ) : (
                    <div className="product-card__placeholder">
                      <Icon name="image" size={24} />
                    </div>
                  )}
                </div>

                <div className="storefront__card-body">
                  <span className="storefront__card-cat">{categoryLabel(product.category)}</span>
                  <h2 className="storefront__card-name">{product.name}</h2>

                  {hasUsableTryOnAsset(product) ? (
                    <span className="product-card__tryon-flag">
                      <Icon name="sparkle" size={12} />
                      Virtual try-on
                    </span>
                  ) : null}

                  <span className="storefront__card-price">
                    {formatCurrency(product.price, product.currency)}
                  </span>

                  {linkMode === 'route' ? (
                    <Link className="btn btn--secondary btn--sm btn--block" to={productHref(product)}>
                      View details
                    </Link>
                  ) : (
                    <a
                      className="btn btn--secondary btn--sm btn--block"
                      href={productHref(product)}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      View details
                      <Icon name="external" size={14} />
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
