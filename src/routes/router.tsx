import { Suspense, lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { BatchProducts } from '@/features/onboarding/pages/BatchProducts'
import { CreateStore } from '@/features/onboarding/pages/CreateStore'
import { SellerSignIn } from '@/features/onboarding/pages/SignIn'
import { StoreReady } from '@/features/onboarding/pages/StoreReady'
import { Landing } from '@/features/marketing/pages/Landing'
import { SellerLayout } from '@/features/seller/components/SellerLayout'
import { AddProduct } from '@/features/seller/pages/AddProduct'
import { EditProduct } from '@/features/seller/pages/EditProduct'
import { SellerAnalytics } from '@/features/seller/pages/SellerAnalytics'
import { SellerCollection } from '@/features/seller/pages/SellerCollection'
import { SellerHome } from '@/features/seller/pages/SellerHome'
import { SellerProducts } from '@/features/seller/pages/SellerProducts'
import { SellerSettings } from '@/features/seller/pages/SellerSettings'
import { SellerStore } from '@/features/seller/pages/SellerStore'
import { PublicProduct, PublicProductResolver } from '@/features/storefront/pages/PublicProduct'
import { PublicStore } from '@/features/storefront/pages/PublicStore'
import { NotFound } from './NotFound'
import { paths } from './paths'

/**
 * The try-on module, split into its own chunk.
 *
 * `lazy()` needs a default export; the pages use named ones like the rest of the codebase, so the
 * mapping is done here rather than changing the pages to suit the router.
 */
const TryOnLab = lazy(() => import('@/features/try-on/pages/TryOnLab').then((module) => ({ default: module.TryOnLab })))
const TryOnProduct = lazy(() =>
  import('@/features/try-on/pages/TryOnProduct').then((module) => ({ default: module.TryOnProduct })),
)

/** Shown while a lazily-loaded route's chunk is in flight. Deliberately plain: it is on screen for
 *  one network round trip on a cold cache, and a spinner that flashes is worse than nothing. */
function RouteFallback(): JSX.Element {
  return (
    <div className="try-page">
      <p className="try-note">Loading the try-on viewer…</p>
    </div>
  )
}

/**
 * The application's routes.
 *
 * Four groups, in the order a seller meets them:
 *
 *   1. **Marketing** — the landing page and sign-in, at the root. No session assumed.
 *   2. **Onboarding** — create the store, then add the first pieces. Session required, but a store
 *      may not exist yet, which is why these sit outside `SellerLayout` rather than inside it.
 *   3. **Dashboard** — one layout (sidebar, header, session guard) over every seller screen.
 *   4. **Public storefront** — what a customer sees after scanning a QR code.
 *
 * There is deliberately no separate bundle per seller: every seller route is scoped by the
 * authenticated session, not by a URL segment, because a URL segment is a client claim and not an
 * authorisation. See arch.md §6.
 */

export const router = createBrowserRouter([
  /* ── Marketing ──────────────────────────────────────────────────────────── */
  { path: paths.marketing.landing, element: <Landing /> },
  { path: paths.marketing.signIn, element: <SellerSignIn /> },

  /* ── Onboarding ─────────────────────────────────────────────────────────── */
  /**
   * `getStarted` and `onboarding.store` are the same screen under two names: the first is what the
   * landing page links to, the second is what the flow's own URLs look like. A redirect rather than
   * a second route keeps them from drifting into two different forms.
   */
  { path: paths.marketing.getStarted, element: <CreateStore /> },
  { path: paths.onboarding.store, element: <CreateStore /> },
  { path: paths.onboarding.ready, element: <StoreReady /> },
  { path: paths.onboarding.products, element: <BatchProducts /> },

  /* ── Dashboard ──────────────────────────────────────────────────────────── */
  {
    // Every signed-in screen shares one layout, which is also the session guard.
    element: <SellerLayout />,
    children: [
      { path: paths.seller.dashboard, element: <SellerHome /> },
      { path: paths.seller.collection, element: <SellerCollection /> },
      { path: paths.seller.products, element: <SellerProducts /> },
      { path: paths.seller.addProduct, element: <AddProduct /> },
      { path: '/seller/products/:productId/edit', element: <EditProduct /> },
      { path: paths.seller.store, element: <SellerStore /> },
      { path: paths.seller.analytics, element: <SellerAnalytics /> },
      { path: paths.seller.settings, element: <SellerSettings /> },
    ],
  },

  /* ── Public storefront ──────────────────────────────────────────────────── */
  { path: '/s/:storeSlug', element: <PublicStore /> },
  { path: '/s/:storeSlug/p/:productId', element: <PublicProduct /> },
  /**
   * Bare product URL. Kept because QR codes and links from outside may carry only the product id;
   * the route resolves the owning store and redirects to the canonical store-scoped URL.
   */
  { path: '/p/:productId', element: <PublicProductResolver /> },

  /* ── Try-on ─────────────────────────────────────────────────────────────── */
  /**
   * Both try-on routes sit in the public group, because a shopper is a signed-out visitor by default
   * and neither reads seller data: the lab reads no product at all, and the product route reads the
   * same public projection the storefront already renders.
   *
   * **Lazy, unlike every other route in this file.** Try-on carries the only optional heavy
   * dependency graph in the app, and it is the one surface most visitors never open. Imported
   * eagerly, its solver, calibration, camera and WASM code sat in the entry chunk for every seller
   * browsing their dashboard — measured at +19 kB raw, +7 kB gzip for a feature they were not using.
   * The `Suspense` boundary is required by `lazy()`; without one React throws rather than showing a
   * fallback, so the two go together.
   */
  {
    path: paths.public.tryOnLab,
    element: (
      <Suspense fallback={<RouteFallback />}>
        <TryOnLab />
      </Suspense>
    ),
  },

  /**
   * The customer-facing try-on. Declared after the lab deliberately, even though React Router ranks a
   * static segment above a dynamic one on its own: `lab` would otherwise be a candidate value for
   * `:productId`, and reading the two in this order is what makes it obvious that it is not one.
   *
   * Lazy, for the reason given above and one more — this route mounts a camera and a WASM detector,
   * and neither belongs in the bundle a seller downloads to look at their dashboard.
   */
  {
    path: paths.public.tryOn(':productId'),
    element: (
      <Suspense fallback={<RouteFallback />}>
        <TryOnProduct />
      </Suspense>
    ),
  },

  /**
   * The old sign-in path. It was `/seller/sign-in` before the marketing surface moved to the root,
   * and QR codes, bookmarks and links in the wild may still carry it.
   */
  { path: '/seller/sign-in', element: <Navigate to={paths.marketing.signIn} replace /> },

  { path: '*', element: <NotFound /> },
])
