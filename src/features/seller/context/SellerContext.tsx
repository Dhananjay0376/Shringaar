import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { getSellerService, isDemoService, type SellerService } from '../services/sellerService'
import type {
  MutationResult,
  Seller,
  ServiceCapabilities,
  SignInInput,
  SignUpInput,
  SignUpOutcome,
  Store,
  StoreInput,
  StoreSetupInput,
} from '../types/seller'
import { toErrorMessage } from '../hooks/useAsync'

/**
 * Session and store context for the dashboard shell.
 *
 * The sidebar, header, dashboard and settings all need the current store, and re-fetching it per
 * screen would mean four sources of truth for the store name. It is loaded once here and updated in
 * place when the store form saves.
 *
 * It is also where the session actually lives. Nothing downstream calls `auth` directly: a screen
 * asks this context to sign in, and the context decides what that means for the store, the loading
 * state and the session listener. One place to get that sequence right beats six.
 */

/** What a service that could not be constructed can do: nothing. */
const NO_CAPABILITIES: ServiceCapabilities = {
  auth: false,
  oauth: false,
  uploads: false,
  database: false,
}

export interface SellerContextValue {
  /**
   * Null only when the service could not be constructed at all. In that case `error` is set and
   * `SellerLayout` renders the failure instead of children, so screens can treat a null service as
   * "this page is not reachable".
   */
  service: SellerService | null
  /** True while no backend is connected — drives every "Demo data" affordance. */
  isDemo: boolean
  /** What the live backend can do. Read by screens instead of assuming from `isDemo`. */
  capabilities: ServiceCapabilities
  seller: Seller | null
  store: Store | null
  loading: boolean
  error: string | null
  /** True when the seller has dismissed the demo-mode banner. Session-scoped, not persisted. */
  demoBannerDismissed: boolean
  dismissDemoBanner: () => void
  signUp: (input: SignUpInput) => Promise<SignUpOutcome>
  signIn: (input: SignInInput) => Promise<void>
  /**
   * Starts a Google sign-in, which leaves the page. It rejects only when the attempt failed before
   * navigating; on success the browser is already at the provider and nothing here runs again.
   */
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  /** Creates the store from the guided first-run flow. */
  createStore: (input: StoreSetupInput) => Promise<MutationResult<Store>>
  /** Marks the guided first run finished, which is also what publishes the store to customers. */
  completeOnboarding: () => Promise<MutationResult<Store>>
  saveStore: (input: StoreInput) => Promise<MutationResult<Store>>
  reload: () => void
}

const SellerContext = createContext<SellerContextValue | null>(null)

export function SellerProvider({ children }: { children: ReactNode }) {
  /**
   * Building the service can fail — a misconfigured backend throws rather than serving sample data
   * (arch.md §5). Catching it here turns that into a screen a human can read instead of a blank page
   * from an exception thrown during render.
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

  /**
   * The signed-in id as of the last render, readable from the auth listener without making the
   * listener's effect depend on `seller` (which would resubscribe on every session change).
   */
  const sellerIdRef = useRef<string | null>(null)
  sellerIdRef.current = seller?.id ?? null

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

      // Null here is a real, expected state — a seller who has signed up but not yet built a
      // store — not an error. Screens route on it; this context just reports it.
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

  /**
   * Session changes that did not come from this tab: a sign-out elsewhere, an expired refresh token,
   * or an email-confirmation link landing on this page and turning into a session.
   *
   * Reloads only when the identity actually changed. The adapter's listener fires on this tab's own
   * sign-in too, and reloading there would drop the dashboard back to a skeleton for a session it
   * already has in hand.
   */
  useEffect(() => {
    if (!service) return

    return service.onAuthStateChange((next) => {
      if ((next?.id ?? null) !== sellerIdRef.current) {
        setNonce((value) => value + 1)
      }
    })
  }, [service])

  const requireService = useCallback((): SellerService => {
    if (!service) {
      throw new Error(resolution.error ?? 'No seller service is available.')
    }
    return service
  }, [service, resolution.error])

  const signUp = useCallback(
    async (input: SignUpInput): Promise<SignUpOutcome> => {
      const outcome = await requireService().signUp(input)

      if (outcome.data.status === 'active' && outcome.data.seller) {
        // A confirmed signup is a session. Load the store too, so the caller can send the seller
        // straight to whichever step they are actually on rather than through a second spinner.
        const storeResult = await requireService().getStore()
        setSeller(outcome.data.seller)
        setStore(storeResult.data)
      }

      setError(null)
      return outcome.data
    },
    [requireService],
  )

  const signIn = useCallback(
    async (input: SignInInput) => {
      const active = requireService()
      const result = await active.signIn(input)
      const storeResult = await active.getStore()

      setSeller(result.data)
      setStore(storeResult.data)
      setError(null)
    },
    [requireService],
  )

  /**
   * Deliberately does not touch `seller` or `store`.
   *
   * A successful call navigates the page to the provider, so there is no moment at which this
   * context could observe the new session — the next thing that runs is a fresh page load. Writing
   * optimistic state here would paint a signed-in dashboard over a page that is already leaving.
   *
   * On the way back the session arrives by two routes and both are already handled: `getSession()`
   * on mount, and the `onAuthStateChange` listener above, which fires once supabase-js has exchanged
   * the code in the URL. The listener is what covers the race where this effect's first read of the
   * session happens before that exchange finishes.
   */
  const signInWithGoogle = useCallback(async () => {
    await requireService().signInWithOAuth('google')
  }, [requireService])

  const signOut = useCallback(async () => {
    if (!service) return
    await service.signOut()
    setSeller(null)
    setStore(null)
  }, [service])

  const createStore = useCallback(
    async (input: StoreSetupInput) => {
      const result = await requireService().createStore(input)
      // The seller is signed in already — the store was created under their session — but re-reading
      // costs one query and keeps the context in step with what the service just did rather than
      // assuming it.
      const session = await requireService().getSession()
      setStore(result.data)
      setSeller(session.data)
      setError(null)
      return result
    },
    [requireService],
  )

  const completeOnboarding = useCallback(async () => {
    const result = await requireService().completeOnboarding()
    setStore(result.data)
    return result
  }, [requireService])

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
      capabilities: service?.capabilities ?? NO_CAPABILITIES,
      seller,
      store,
      loading,
      error,
      demoBannerDismissed,
      dismissDemoBanner,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      createStore,
      completeOnboarding,
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
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      createStore,
      completeOnboarding,
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
