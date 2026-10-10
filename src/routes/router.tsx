import { createBrowserRouter, Navigate } from 'react-router-dom'
import { SellerLayout } from '@/features/seller/components/SellerLayout'
import { AddProduct } from '@/features/seller/pages/AddProduct'
import { EditProduct } from '@/features/seller/pages/EditProduct'
import { SellerAnalytics } from '@/features/seller/pages/SellerAnalytics'
import { SellerDashboard } from '@/features/seller/pages/SellerDashboard'
import { SellerProducts } from '@/features/seller/pages/SellerProducts'
import { SellerSettings } from '@/features/seller/pages/SellerSettings'
import { SellerSignIn } from '@/features/seller/pages/SellerSignIn'
import { SellerStore } from '@/features/seller/pages/SellerStore'
import { PublicProduct, PublicProductResolver } from '@/features/storefront/pages/PublicProduct'
import { PublicStore } from '@/features/storefront/pages/PublicStore'
import { NotFound } from './NotFound'
import { paths } from './paths'

/**
 * The application's routes.
 *
 * One router, one React app. There is deliberately no separate bundle per seller: every seller route
 * is scoped by the authenticated session, not by a URL segment, because a URL segment is a client
 * claim and not an authorisation. See arch.md §6.
 *
 * Public routes (`/s/*`, `/p/*`) render outside `SellerLayout` — a customer scanning a QR code must
 * never be inside a dashboard shell that assumes a session.
 */

export const router = createBrowserRouter([
  // The dashboard is the product; the root goes straight to it.
  { path: paths.root, element: <Navigate to={paths.seller.dashboard} replace /> },

  { path: paths.seller.signIn, element: <SellerSignIn /> },

  {
    // Every signed-in screen shares one layout, which is also the session guard.
    element: <SellerLayout />,
    children: [
      { path: paths.seller.dashboard, element: <SellerDashboard /> },
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

  { path: '*', element: <NotFound /> },
])
