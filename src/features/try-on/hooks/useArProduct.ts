/**
 * Resolves a product for the try-on page, from its id alone.
 *
 * The try-on URL is `/tryon/:productId` — no store slug — so this uses `resolveProduct`, the same
 * service method the `/p/:productId` redirect uses. It goes through the service interface rather than
 * the storefront's hooks, which live inside another feature and are not this feature's to depend on;
 * what is shared is the contract in `@/lib/seller`, which is exactly the layer the architecture
 * record says shared code belongs in.
 *
 * ### What this deliberately does not do
 *
 * It reads nothing beyond `ProductView`, which the storefront already renders in public. There is no
 * owner id, no draft, no seller-private field: a try-on page is a public page, and it must not become
 * the one place a private column leaks. `resolveProduct` on the live backend reads the
 * `storefront_products` view, which exposes published rows and nothing else.
 *
 * ### Why it does not reuse `usePublicResource`
 *
 * That helper is private to the storefront hooks, and importing it would make this feature depend on
 * another feature's internals for ten lines of ticket-guarded loading. The duplication is deliberate;
 * the alternative is the coupling the architecture record warns about.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { getSellerService } from '@/features/seller/services/sellerService'
import type { DataSource, ProductView } from '@/lib/seller'

export interface ArProductResult {
  readonly data: ProductView | null
  readonly dataSource: DataSource | null
  readonly loading: boolean
  readonly error: string | null
  readonly reload: () => void
}

/**
 * Resolved per call rather than at module scope, so a configured-but-unimplemented backend surfaces as
 * a rendered error instead of a module that throws on import. `getSellerService` caches its instance,
 * so this costs nothing.
 */
function service() {
  return getSellerService()
}

export function useArProduct(productId: string | undefined): ArProductResult {
  const [data, setData] = useState<ProductView | null>(null)
  const [dataSource, setDataSource] = useState<DataSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  /* A ticket guard, not just an `active` flag. A slow response for an abandoned product must not
     overwrite a newer one — and on a route whose only parameter is the id, navigating from one
     product to another while the first request is still in flight is an ordinary thing to do. */
  const ticketRef = useRef(0)

  useEffect(() => {
    const ticket = ticketRef.current + 1
    ticketRef.current = ticket

    if (!productId) {
      /* No id in the URL. Nothing was loaded, so no data source is claimed — reporting `'demo'` here
         would put a "sample data" badge on an empty page. */
      setData(null)
      setDataSource(null)
      setLoading(false)
      setError(null)
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    service()
      .resolveProduct(productId)
      .then((result) => {
        if (!active || ticket !== ticketRef.current) return
        setData(result.data)
        setDataSource(result.dataSource)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (!active || ticket !== ticketRef.current) return
        setError(cause instanceof Error ? cause.message : 'This product could not be loaded.')
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [productId, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  return { data, dataSource, loading, error, reload }
}
