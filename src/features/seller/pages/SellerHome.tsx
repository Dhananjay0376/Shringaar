import { Link } from 'react-router-dom'
import { btnClass } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { LoadingAnnouncement } from '@/components/ui/Skeleton'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { formatNumber } from '@/lib/format'
import { useProducts } from '../hooks/useProducts'
import { useSeller } from '../context/SellerContext'
import { DemoModeBanner } from '../components/DemoModeBanner'
import { paths } from '@/routes/paths'

/**
 * Home — the first screen after signing in.
 *
 * The job of this page is to answer one question: what do I do next. Everything on it points at
 * "add a product", because for a seller with a shop full of stock and nothing online, that is the
 * only action that changes anything. The counts are there to tell them how far along they are, not
 * to be a dashboard.
 *
 * The figures are real reads of the store — not placeholders — but in this build the store is
 * browser-local (arch.md §5), so the footnote says exactly that rather than letting "12 products"
 * imply a live shop.
 */
export function SellerHome() {
  const { store, isDemo, demoBannerDismissed, dismissDemoBanner } = useSeller()
  const products = useProducts()

  useDocumentTitle('Home — Shringaar')

  const all = products.data ?? []
  const published = all.filter((product) => product.status === 'published')
  const withPhoto = all.filter((product) => product.image)

  if (products.loading) {
    return <LoadingAnnouncement label="Loading your store" />
  }

  return (
    <div className="home">
      {isDemo && !demoBannerDismissed ? <DemoModeBanner onDismiss={dismissDemoBanner} /> : null}

      <header className="home__head">
        <span className="home__kicker">
          <Icon name="store" size={13} />
          My jewellery store
        </span>

        <h1 className="home__title">{store?.name ?? 'Your store'}</h1>

        <p className="home__welcome">
          Welcome back! Let&rsquo;s grow your online store.
        </p>

        {store ? (
          <div className="home__meta">
            <span className="home__slug">/s/{store.slug}</span>
            {store.city ? <span>{store.city}</span> : null}
          </div>
        ) : null}
      </header>

      <section className="home__stats" aria-label="Your store at a glance">
        <div className="home__stat">
          <span className="home__stat-v tabular">{formatNumber(all.length)}</span>
          <span className="home__stat-l">Products</span>
          <span className="home__stat-n">
            {withPhoto.length === all.length
              ? 'Every piece has a photo'
              : `${all.length - withPhoto.length} still need a photo`}
          </span>
        </div>

        <div className="home__stat">
          <span className="home__stat-v tabular">{formatNumber(all.length)}</span>
          <span className="home__stat-l">Product QR codes</span>
          <span className="home__stat-n">One per piece, ready to print</span>
        </div>

        <div className="home__stat">
          <span className="home__stat-v tabular">{formatNumber(published.length)}</span>
          <span className="home__stat-l">Live on your storefront</span>
          <span className="home__stat-n">
            {published.length === all.length
              ? 'All of it is visible to customers'
              : `${all.length - published.length} kept as drafts`}
          </span>
        </div>
      </section>

      <section className="home__actions" aria-label="Quick actions">
        <Link className="home__action home__action--primary" to={paths.onboarding.products}>
          <span className="home__action-icon" aria-hidden="true">
            <Icon name="camera" size={20} />
          </span>
          <span className="home__action-body">
            <span className="home__action-title">Add new product</span>
            <span className="home__action-note">
              Photograph a piece and price it — add as many as you like in one go.
            </span>
          </span>
          <Icon name="chevronRight" size={16} className="home__action-go" />
        </Link>

        <Link className="home__action" to={paths.seller.store}>
          <span className="home__action-icon" aria-hidden="true">
            <Icon name="settings" size={20} />
          </span>
          <span className="home__action-body">
            <span className="home__action-title">Store settings</span>
            <span className="home__action-note">
              Store name, logo, city and the WhatsApp number customers reach you on.
            </span>
          </span>
          <Icon name="chevronRight" size={16} className="home__action-go" />
        </Link>
      </section>

      {all.length === 0 ? (
        <section className="home__empty">
          <h2>Your store is empty</h2>
          <p>
            Nothing is visible to customers yet. Add your first piece and it gets its own page and
            QR code straight away.
          </p>
          <Link className={btnClass({ variant: 'primary', icon: 'camera' })} to={paths.onboarding.products}>
            Add your first product
            <Icon name="chevronRight" size={15} />
          </Link>
        </section>
      ) : (
        <p className="home__more">
          <Link to={paths.seller.collection}>
            See everything you have added <Icon name="chevronRight" size={14} />
          </Link>
        </p>
      )}

      <p className="home__footnote">
        {isDemo ? (
          <>
            Figures read from the browser-local demo store — not a live shop. See <code>arch.md</code>{' '}
            §5.
          </>
        ) : (
          <>Figures are read from your connected store.</>
        )}
      </p>
    </div>
  )
}
