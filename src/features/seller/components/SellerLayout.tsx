import { useCallback, useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { LoadingAnnouncement } from '@/components/ui/Skeleton'
import { Icon } from '@/components/ui/Icon'
import { paths, SELLER_SECTIONS } from '@/routes/paths'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useSeller } from '../context/SellerContext'
import { landingPathFor } from '../utils/landing'
import { SellerHeader } from './SellerHeader'
import { SellerSidebar } from './SellerSidebar'

/**
 * The dashboard shell.
 *
 * One layout for every seller route: sidebar, header, scrolling content. It is also the session
 * guard — every screen under `/seller/*` needs a signed-in seller and a store, and checking that in
 * six page components instead of once here is how a route eventually ships without the check.
 *
 * While the session loads it renders the shell chrome around a quiet placeholder rather than a blank
 * screen, so the layout does not jump when data arrives.
 */

/** Derives the header breadcrumb label from the URL, so pages do not each pass a `section` prop. */
function sectionForPath(pathname: string): string {
  switch (pathname) {
    case paths.seller.dashboard:
      return SELLER_SECTIONS.dashboard
    case paths.seller.collection:
      return SELLER_SECTIONS.collection
    case paths.seller.products:
      return SELLER_SECTIONS.products
    case paths.seller.addProduct:
      return SELLER_SECTIONS.addProduct
    case paths.seller.store:
      return SELLER_SECTIONS.store
    case paths.seller.analytics:
      return SELLER_SECTIONS.analytics
    case paths.seller.settings:
      return SELLER_SECTIONS.settings
    default:
      return pathname.startsWith('/seller/products/')
        ? SELLER_SECTIONS.editProduct
        : SELLER_SECTIONS.dashboard
  }
}

export function SellerLayout() {
  const { seller, store, loading, error, isDemo, signOut, reload } = useSeller()
  const location = useLocation()
  const navigate = useNavigate()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  // The tab says which screen it is, so three open seller tabs are distinguishable.
  useDocumentTitle(`Shringaar — ${sectionForPath(location.pathname)}`)

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  // A drawer left open during a route change would cover the page it just navigated to.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // Escape closes the drawer, matching every other transient layer in the app.
  useEffect(() => {
    if (!drawerOpen) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  const handleSignOut = useCallback(async () => {
    setSigningOut(true)
    try {
      await signOut()
      navigate(paths.seller.signIn, { replace: true })
    } finally {
      setSigningOut(false)
    }
  }, [navigate, signOut])

  if (loading) {
    return (
      <div className="shell">
        <div className="shell__main">
          <LoadingAnnouncement label="Loading your dashboard" />
          <div className="shell__content">
            <div className="skeleton skeleton--title" />
            <div className="stat-grid" style={{ marginTop: 'var(--sp-6)' }}>
              {[0, 1, 2, 3].map((key) => (
                <div className="skeleton skeleton--card" key={key} />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // A session is required for everything below, and an unavailable backend is a real failure — it
  // must not be papered over with an empty dashboard that looks like "no products".
  if (error) {
    return (
      <div className="auth">
        <div className="auth__card" role="alert">
          <h1 className="auth__title">Could not load your dashboard</h1>
          <p className="auth__desc">{error}</p>
          <Button onClick={reload}>Try again</Button>
        </div>
      </div>
    )
  }

  if (!seller || !store || !store.onboardingCompleted) {
    /**
     * A session without a finished store is not "signed out". Sending them to sign-in would ask for
     * credentials they already have, and showing the dashboard would show a shop that is not
     * published yet. `landingPathFor` names the step they are actually on — sign-in with no session,
     * the store form with no store, the end of the guided run while the setup is unfinished — and
     * only the first of those can return them here, so only that one carries `from`.
     */
    const landing = landingPathFor(seller, store)

    return (
      <Navigate
        to={landing}
        replace
        state={landing === paths.marketing.signIn ? { from: location.pathname } : undefined}
      />
    )
  }

  return (
    <div className="shell">
      <SellerSidebar
        store={store}
        seller={seller}
        isDemo={isDemo}
        open={drawerOpen}
        onNavigate={closeDrawer}
        onSignOut={handleSignOut}
        signingOut={signingOut}
      />

      {drawerOpen ? (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="Close navigation menu"
          onClick={closeDrawer}
        />
      ) : null}

      <div className="shell__main">
        <SellerHeader
          seller={seller}
          store={store}
          section={sectionForPath(location.pathname)}
          isDemo={isDemo}
          onOpenDrawer={() => setDrawerOpen(true)}
          onSignOut={handleSignOut}
          signingOut={signingOut}
        />

        <main className="shell__content" id="main">
          <Outlet />
        </main>

        <footer className="shell__footer">
          <span className="text-muted text-xs">
            <Icon name="info" size={13} /> Shringaar seller dashboard
            {isDemo ? ' — demo data, not connected to a backend' : ''}
          </span>
        </footer>
      </div>
    </div>
  )
}
