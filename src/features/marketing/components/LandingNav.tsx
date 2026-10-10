import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { useSeller } from '@/features/seller/context/SellerContext'
import { paths } from '@/routes/paths'

/**
 * The landing navigation.
 *
 * Two exits, and the wording matters more than the styling. "Sign in" is for a seller whose store
 * already exists; "Create your store" is for one who does not yet have one. Offering a single
 * "Get started" would send both to the same screen and leave the returning seller filling in a
 * store name they already chose.
 *
 * The bar is sticky and overlaps the hero it sits on, so the links are visible from the first pixel
 * and stay visible down the page.
 */

const SECTIONS = [
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
]

export function LandingNav() {
  const { seller } = useSeller()
  const { pathname, hash } = useLocation()
  const [open, setOpen] = useState(false)

  // A menu left open across a navigation would cover the screen it opened onto.
  useEffect(() => {
    setOpen(false)
  }, [pathname, hash])

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <header className="mk-nav">
      <div className="mk-logo-pill">
        <Link className="mk-logo" to={paths.root}>
          <span className="mk-logo__mark" aria-hidden="true">
            श
          </span>
          Shringaar
        </Link>

        <nav className="mk-nav__links" aria-label="Sections">
          {SECTIONS.map((section) => (
            <a key={section.href} href={section.href} className="mk-nav__link">
              {section.label}
            </a>
          ))}
        </nav>
      </div>

      <div className="mk-nav__side">
        {/* Already signed in: the honest primary action is the dashboard, not a second sign-in. */}
        {seller ? (
          <Link className="mk-btn mk-btn--brand mk-btn--sm" to={paths.seller.dashboard}>
            Open dashboard
            <Icon name="chevronRight" size={14} />
          </Link>
        ) : (
          <>
            <Link className="mk-btn mk-btn--white mk-btn--sm" to={paths.marketing.signIn}>
              Sign in
            </Link>
            <Link className="mk-btn mk-btn--brand mk-btn--sm" to={paths.marketing.getStarted}>
              Create your store
            </Link>
          </>
        )}

        <button
          type="button"
          className="mk-nav__burger"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mk-nav-menu"
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={open ? 'x' : 'menu'} size={18} />
        </button>
      </div>

      {open ? (
        <>
          <button
            type="button"
            className="mk-nav__scrim"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="mk-menu" id="mk-nav-menu">
            <nav aria-label="Sections">
              {SECTIONS.map((section) => (
                <a key={section.href} href={section.href} className="mk-menu__link">
                  {section.label}
                  <Icon name="chevronRight" size={15} />
                </a>
              ))}
            </nav>

            {seller ? (
              <Link className="mk-btn mk-btn--brand mk-btn--wide" to={paths.seller.dashboard}>
                Open dashboard
              </Link>
            ) : (
              <>
                <Link className="mk-btn mk-btn--brand mk-btn--wide" to={paths.marketing.getStarted}>
                  Create your store
                </Link>
                <Link className="mk-btn mk-btn--white mk-btn--wide" to={paths.marketing.signIn}>
                  Sign in
                </Link>
              </>
            )}
          </div>
        </>
      ) : null}
    </header>
  )
}
