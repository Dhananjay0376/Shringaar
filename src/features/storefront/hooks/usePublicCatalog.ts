import { useCallback, useEffect, useRef, useState } from 'react'
import { getSellerService } from '@/features/seller/services/sellerService'
// Type-only import of the shared contract — the same documented exception `StorefrontCanvas` uses
// (arch.md §9). No seller *code* is imported here: this feature talks to the service interface, so
// the public storefront and the dashboard read one contract without depending on each other.
import type { DataSource, ProductView, StorefrontView } from '@/features/seller/types/seller'

/**
 * Public catalogue hooks.
 *
 * The storefront deliberately does not reuse the seller dashboard's hooks: those live inside the
 * seller feature, and the storefront must be able to ship — and be broken — independently of it. What
 * it does share is the service interface and the data contract, which is where the agreement actually
 * matters.
 *
 * Unlike the dashboard's hooks these also carry `dataSource` through, because a customer-facing page
 * that is serving sample data must be able to say so.
 */

export interface PublicResult<T> {
  data: T | null
  dataSource: DataSource | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Resolved per call rather than at module scope so a configured-but-unimplemented backend surfaces
 * as a rendered error instead of a bundle that fails to evaluate. `getSellerService()` caches its
 * instance, so this costs nothing.
 */
function service() {
  return getSellerService()
}

function usePublicResource<T>(
  load: () => Promise<{ data: T; dataSource: DataSource | null }>,
  deps: unknown[],
): PublicResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [dataSource, setDataSource] = useState<DataSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const loadRef = useRef(load)
  loadRef.current = load

  // Ticket guard: a slow response for an abandoned product must not overwrite a newer one.
  const ticketRef = useRef(0)

  useEffect(() => {
    const ticket = ticketRef.current + 1
    ticketRef.current = ticket

    let active = true
    setLoading(true)
    setError(null)

    loadRef
      .current()
      .then((result) => {
        if (!active || ticket !== ticketRef.current) return
        setData(result.data)
        setDataSource(result.dataSource)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (!active || ticket !== ticketRef.current) return
        setError(cause instanceof Error ? cause.message : 'Something went wrong.')
        setLoading(false)
      })

    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  return { data, dataSource, loading, error, reload }
}

/**
 * A storefront. Drafts are excluded unconditionally — there is no session here, so there is no
 * owner path to include them, and the parameter that would allow it is never passed.
 */
export function usePublicStorefront(storeSlug: string | undefined): PublicResult<StorefrontView | null> {
  return usePublicResource(
    () =>
      storeSlug
        ? service().getStorefront(storeSlug).then((result) => ({
            data: result.data,
            dataSource: result.dataSource,
          }))
        : // No slug in the URL: nothing was loaded, so no data source is claimed.
          Promise.resolve({ data: null, dataSource: null }),
    [storeSlug ?? ''],
  )
}

export function usePublicProductView(
  storeSlug: string | undefined,
  productId: string | undefined,
): PublicResult<ProductView | null> {
  return usePublicResource(
    () =>
      storeSlug && productId
        ? service().getPublicProduct(storeSlug, productId).then((result) => ({
            data: result.data,
            dataSource: result.dataSource,
          }))
        : Promise.resolve({ data: null, dataSource: null }),
    [storeSlug ?? '', productId ?? ''],
  )
}

export function useResolveProduct(productId: string | undefined): PublicResult<ProductView | null> {
  return usePublicResource(
    () =>
      productId
        ? service().resolveProduct(productId).then((result) => ({
            data: result.data,
            dataSource: result.dataSource,
          }))
        : Promise.resolve({ data: null, dataSource: null }),
    [productId ?? ''],
  )
}
