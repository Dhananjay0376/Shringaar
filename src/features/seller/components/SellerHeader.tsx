import { Link } from 'react-router-dom'
import { Badge, DemoBadge } from '@/components/ui/Badge'
import { Icon } from '@/components/ui/Icon'
import { formatInitials } from '@/lib/format'
import { paths } from '@/routes/paths'
import type { Seller, Store } from '../types/seller'
import { storeUrl } from '../utils/product'
import { useDismissable } from '../hooks/useDismissable'

/**
 * Dashboard header.
 *
 * Carries the two things that must be visible on every screen: which store is being edited, and
 * whether the numbers on it are real. The demo chip lives here rather than on a single page because
 * the demo/live state applies to the whole dashboard.
 */

export interface SellerHeaderProps {
  seller: Seller
  store: Store
  /** Label for the current section, e.g. "Products". */
  section: string
  isDemo: boolean
  onOpenDrawer: () => void
  onSignOut: () => void
  signingOut: boolean
}

export function SellerHeader({
  seller,
  store,
  section,
  isDemo,
  onOpenDrawer,
  onSignOut,
  signingOut,
}: SellerHeaderProps) {
  const profile = useDismissable<HTMLDivElement>()

  return (
    <header className="header">
      <div className="header__left">
        <button
          type="button"
          className="icon-btn header__menu-btn"
          onClick={onOpenDrawer}
          aria-label="Open navigation menu"
        >
          <Icon name="menu" size={18} />
        </button>

        <p className="header__crumb">
          <strong>{store.name}</strong>
          <span aria-hidden="true"> / </span>
          {section}
        </p>
      </div>

      <div className="header__actions">
        {isDemo ? <DemoBadge /> : <Badge tone="success" dot>Live</Badge>}

        <div className="menu-anchor" ref={profile.ref}>
          <button
            type="button"
            className="profile-trigger"
            aria-haspopup="menu"
            aria-expanded={profile.open}
            onClick={(event) => {
              profile.triggerRef.current = event.currentTarget
              profile.toggle()
            }}
          >
            <span className="avatar" aria-hidden="true">
              {formatInitials(seller.displayName)}
            </span>
            <span className="profile-trigger__name">{seller.displayName}</span>
            <Icon name="chevronDown" size={14} />
          </button>

          {profile.open ? (
            <div className="menu" role="menu">
              <div className="menu__head">
                <div className="menu__name">{seller.displayName}</div>
                <div className="menu__email">{seller.email}</div>
              </div>

              <Link className="menu__item" to={paths.seller.settings} role="menuitem" onClick={() => profile.close()}>
                <Icon name="settings" size={15} />
                Store settings
              </Link>

              <a
                className="menu__item"
                href={storeUrl(store)}
                target="_blank"
                rel="noreferrer noopener"
                role="menuitem"
                onClick={() => profile.close()}
              >
                <Icon name="external" size={15} />
                View my store
              </a>

              <div className="menu__sep" />

              <button
                type="button"
                className="menu__item menu__item--danger"
                role="menuitem"
                disabled={signingOut}
                onClick={() => {
                  profile.close()
                  onSignOut()
                }}
              >
                <Icon name="logout" size={15} />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
