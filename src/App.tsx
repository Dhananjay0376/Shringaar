import { RouterProvider } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/Toast'
import { SellerProvider } from '@/features/seller/context/SellerContext'
import { router } from '@/routes/router'

/**
 * Application root.
 *
 * Providers are mounted once, above the router, so any route — including a public storefront page —
 * can use toasts, and every seller route shares one session and one store. A provider per route
 * would mean a second "current store", which is how two screens end up disagreeing.
 *
 * When Supabase is configured but no adapter exists, `getSellerService()` throws on the first
 * request. That failure surfaces in `SellerProvider` as a visible error screen rather than a blank
 * page — see arch.md §5.
 */
export function App() {
  return (
    <ToastProvider>
      <SellerProvider>
        <RouterProvider router={router} />
      </SellerProvider>
    </ToastProvider>
  )
}
