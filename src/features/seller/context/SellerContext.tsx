import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getSellerService, isDemoService, type SellerService } from '../services/sellerService'
import type { MutationResult, Seller, Store, StoreInput } from '../types/seller'
import { toErrorMessage } from '../hooks/useAsync'

/**
 * Session and store context for the dashboard shell.
 *
 * The sidebar, header, dashboard and settings all need the current store, and re-fetching it per
 * screen would mean four sources of truth for the store name. It is loaded once here and updated in
 * place when the store form saves.
 */

export interface SellerContextValue {
  /**
   * Null only when the service could not be constructed at all — a configured but unimplemented
   * backend. In that case `error` is set and `SellerLayout` renders the failure instead of children,
   * so screens can treat a null service as "this page is not reachable".
   */
  service: SellerService | null
  /** True while no backend is connected — drives every "Demo data" affordance. */
  isDemo: boolean
  seller: Seller | null
  store: Store | null
  loading: boolean
  error: string | null
  /** True when the seller has dismissed the demo-mode banner. Session-scoped, not persisted. */
  demoBannerDismissed: boolean
  dismissDemoBanner: () => void
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  saveStore: (input: StoreInput) => Promise<MutationResult<Store>>
  reload: () => void
}

const SellerContext = createContext<SellerContextValue | null>(null)

export function SellerProvider({ children }: { children: ReactNode }) {
  /**
   * Building the service can fail on purpose — a configured-but-unimplemented backend throws rather
   * than serving sample data (arch.md §5). Catching it here turns that into a screen a human can
   * read instead of a blank page from an exception thrown during render.
   */
  const [resolution] = useState<{ service: SellerService | null; error: string | null }>(() => {
    try {
      return { service: getSellerService(), error: null }
    } catch (cause) {
      return { service: null, error: toErrorMessage(cause) }
    }
  })

  const service = resolution.service

  const [seller, setSeller] = useState<Seller | null>(null)
  const [store, setStore] = useState<Store | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(resolution.error)
  const [nonce, setNonce] = useState(0)
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false)

  useEffect(() => {
    if (!service) {
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    async function load() {
      const session = await service!.getSession()
      if (!active) return

      if (!session.data) {
        setSeller(null)
        setStore(null)
        setLoading(false)
        return
      }

      const storeResult = await service!.getStore()
      if (!active) return

      setSeller(session.data)
      setStore(storeResult.data)
      setLoading(false)
    }

    load().catch((cause: unknown) => {
      if (!active) return
      setError(toErrorMessage(cause))
      setLoading(false)
    })

    return () => {
      active = false
    }
  }, [service, nonce])

  const requireService = useCallback((): SellerService => {
    if (!service) {
      throw new Error(resolution.error ?? 'No seller service is available.')
    }
    return service
  }, [service, resolution.error])

  const signIn = useCallback(async () => {
    const active = requireService()
    const result = await active.signIn()
    const storeResult = await active.getStore()

    setSeller(result.data)
    setStore(storeResult.data)
    setError(null)
  }, [requireService])

  const signOut = useCallback(async () => {
    if (!service) return
    await service.signOut()
    setSeller(null)
    setStore(null)
  }, [service])

  const saveStore = useCallback(
    async (input: StoreInput) => {
      const result = await requireService().updateStore(input)
      setStore(result.data)
      return result
    },
    [requireService],
  )

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  const dismissDemoBanner = useCallback(() => setDemoBannerDismissed(true), [])

  const value = useMemo<SellerContextValue>(
    () => ({
      service,
      isDemo: service ? isDemoService(service) : false,
      seller,
      store,
      loading,
      error,
      demoBannerDismissed,
      dismissDemoBanner,
      signIn,
      signOut,
      saveStore,
      reload,
    }),
    [
      service,
      seller,
      store,
      loading,
      error,
      demoBannerDismissed,
      dismissDemoBanner,
      signIn,
      signOut,
      saveStore,
      reload,
    ],
  )

  return <SellerContext.Provider value={value}>{children}</SellerContext.Provider>
}

export function useSeller(): SellerContextValue {
  const context = useContext(SellerContext)

  if (!context) {
    throw new Error('useSeller must be used inside a SellerProvider.')
  }

  return context
}

/**
 * Convenience accessor for the store, which is present on every signed-in screen. Throws rather
 * than returning null so callers do not sprinkle null checks through presentation code.
 */
export function useCurrentStore(): Store {
  const { store } = useSeller()

  if (!store) {
    throw new Error('useCurrentStore was used outside a signed-in seller route.')
  }

  return store
}
