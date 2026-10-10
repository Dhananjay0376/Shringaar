import { NavLink } from 'react-router-dom'
import { Icon, type IconName } from '@/components/ui/Icon'
import { formatInitials } from '@/lib/format'
import { placeholderLogoDataUrl } from '@/lib/placeholder'
import { paths } from '@/routes/paths'
import type { Seller, Store } from '../types/seller'

/**
 * Dashboard navigation.
 *
 * Fixed on desktop, a slide-over drawer below 1024px (see app.css §19). Navigating closes the drawer,
 * because on a phone the menu is modal — leaving it open over the page it just navigated to is the
 * most common way a mobile drawer feels broken.
 */

export interface SellerSidebarProps {
  store: Store
  seller: Seller
  isDemo: boolean
  /** Drawer visibility on small screens. Ignored at desktop width. */
  open: boolean
  onNavigate: () => void
  onSignOut: () => void
  /** True while the sign-out request is in flight. */
  signingOut?: boolean
}

interface NavItem {
  to: string
  label: string
  icon: IconName
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: paths.seller.dashboard, label: 'Overview', icon: 'grid', end: true },
  { to: paths.seller.products, label: 'Products', icon: 'box', end: true },
  { to: paths.seller.addProduct, label: 'Add Product', icon: 'plusCircle' },
  { to: paths.seller.store, label: 'My Store', icon: 'store' },
  { to: paths.seller.analytics, label: 'Analytics', icon: 'chart' },
  { to: paths.seller.settings, label: 'Settings', icon: 'settings' },
]

export function SellerSidebar({
  store,
  seller,
  isDemo,
  open,
  onNavigate,
  onSignOut,
  signingOut,
}: SellerSidebarProps) {
  const logoSrc = store.logoUrl ?? placeholderLogoDataUrl(store.name)

  return (
    <aside className={['sidebar', open ? 'sidebar--open' : ''].filter(Boolean).join(' ')}>
      <div className="sidebar__brand">
        <span className="brandmark" aria-hidden="true">
          श
        </span>
        <span className="brandmark__text">
          <span className="brandmark__name">Shringaar</span>
          <span className="brandmark__sub">Seller</span>
        </span>
      </div>

      <div className="sidebar__store">
        <div className="store-chip">
          <img className="store-chip__logo" src={logoSrc} alt="" width={32} height={32} />
          <span className="store-chip__text">
            <span className="store-chip__name truncate">{store.name}</span>
            <span className="store-chip__slug truncate">/s/{store.slug}</span>
          </span>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="Seller dashboard sections">
        <p className="nav__label-heading">Manage</p>
        <div className="nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                ['nav__item', isActive ? 'nav__item--active' : ''].filter(Boolean).join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <span className="nav__icon">
                    <Icon name={item.icon} size={17} />
                  </span>
                  <span>{item.label}</span>
                  {isActive ? <span className="sr-only">(current section)</span> : null}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="sidebar__footer">
        <div className="store-chip">
          <span className="avatar" aria-hidden="true">
            {formatInitials(seller.displayName)}
          </span>
          <span className="store-chip__text">
            <span className="store-chip__name truncate">{seller.displayName}</span>
            <span className="store-chip__slug truncate">{seller.email}</span>
          </span>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            onClick={onSignOut}
            disabled={signingOut}
            aria-label="Sign out"
            title="Sign out"
          >
            <Icon name="logout" size={15} />
          </button>
        </div>

        {isDemo ? (
          <p className="sidebar__hint">
            Demo mode. Changes are saved in this browser only — nothing is written to a database.
          </p>
        ) : null}
      </div>
    </aside>
  )
}
