import { useCallback, useMemo, useState } from 'react'
import type {
  ActivityEvent,
  AnalyticsRange,
  AnalyticsSummary,
  Product,
  ProductQuery,
  StorefrontView,
} from '../types/seller'
import { getSellerService } from '../services/sellerService'
import { useAsync, type AsyncState } from './useAsync'

/**
 * Feature hooks.
 *
 * These are the only place screens touch the service. Every read unwraps the `ServiceResult` so
 * components receive plain data, and the `dataSource` travels separately where the UI needs to
 * label it.
 */

/**
 * Resolved lazily, inside each loader rather than at module scope.
 *
 * A module-level call would throw while the bundle is being evaluated — a white screen with no
 * explanation — when a backend is configured but not implemented. Calling it per request is free:
 * `getSellerService()` returns a cached singleton, and a throw now happens inside React's control
 * flow where it can be rendered.
 */
function service() {
  return getSellerService()
}

/* ── Products ────────────────────────────────────────────────────────────── */

export interface ProductListState extends AsyncState<Product[]> {
  /** Restores a locally-updated row (after an edit or delete) without refetching the list. */
  patchProduct: (product: Product) => void
  removeProduct: (productId: string) => void
  /**
   * Deletes through the service, then drops the row locally. Deleting only in local state would
   * look like it worked and then reappear on the next load — the exact failure mode arch.md §5
   * rules out.
   */
  deleteProduct: (productId: string) => Promise<void>
}

export function useProducts(query: ProductQuery = {}): ProductListState {
  const { search, category, status } = query

  // Deps are the primitives, not the query object — a new object literal every render would refetch
  // on every render.
  const state = useAsync(
    () => service().listProducts({ search, category, status }).then((result) => result.data),
    [search ?? '', category ?? 'all', status ?? 'all'],
  )

  const patchProduct = useCallback(
    (product: Product) => {
      state.setData(
        (state.data ?? []).map((candidate) => (candidate.id === product.id ? product : candidate)),
      )
    },
    [state],
  )

  const removeProduct = useCallback(
    (productId: string) => {
      state.setData((state.data ?? []).filter((candidate) => candidate.id !== productId))
    },
    [state],
  )

  const deleteProduct = useCallback(
    async (productId: string) => {
      await service().deleteProduct(productId)
      removeProduct(productId)
    },
    [removeProduct],
  )

  return useMemo(
    () => ({ ...state, patchProduct, removeProduct, deleteProduct }),
    [state, patchProduct, removeProduct, deleteProduct],
  )
}

export function useProduct(productId: string | undefined): AsyncState<Product | null> {
  return useAsync(
    () =>
      productId
        ? service().getProduct(productId).then((result) => result.data)
        : Promise.resolve(null),
    [productId ?? ''],
  )
}

/* ── Activity ────────────────────────────────────────────────────────────── */

export function useActivity(limit = 8): AsyncState<ActivityEvent[]> {
  return useAsync(() => service().listActivity(limit).then((result) => result.data), [limit])
}

/* ── Analytics ───────────────────────────────────────────────────────────── */

export interface AnalyticsState {
  summary: AnalyticsSummary | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useAnalytics(range: AnalyticsRange): AnalyticsState {
  const state = useAsync(
    () => service().getAnalytics(range).then((result) => result.data),
    [range],
  )

  return {
    summary: state.data,
    loading: state.loading,
    error: state.error,
    reload: state.reload,
  }
}

/* ── Storefront (owner preview) ──────────────────────────────────────────── */

/**
 * The owner's preview of their own storefront. `includeDrafts` is a seller-only view; the public
 * storefront has its own hooks in the storefront feature and never passes it.
 */
export function useStorefront(
  storeSlug: string | undefined,
  options: { includeDrafts?: boolean } = {},
): AsyncState<StorefrontView | null> {
  const includeDrafts = Boolean(options.includeDrafts)

  return useAsync(
    () =>
      storeSlug
        ? service().getStorefront(storeSlug, { includeDrafts }).then((result) => result.data)
        : Promise.resolve(null),
    [storeSlug ?? '', includeDrafts],
  )
}

/* ── Mutable action helper ───────────────────────────────────────────────── */
export interface ActionState {
  busy: boolean
  error: string | null
}

/**
 * Wraps a one-shot mutation so screens can show a busy button and an inline error without each
 * re-implementing the try/catch. Returns `null` when the action fails, so callers branch on the
 * result rather than on an exception.
 */
export function useAction(): {
  state: ActionState
  run: <T>(action: () => Promise<T>) => Promise<T | null>
  reset: () => void
} {
  const [state, setState] = useState<ActionState>({ busy: false, error: null })

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    setState({ busy: true, error: null })

    try {
      const result = await action()
      setState({ busy: false, error: null })
      return result
    } catch (cause) {
      setState({ busy: false, error: cause instanceof Error ? cause.message : 'Something went wrong.' })
      return null
    }
  }, [])

  const reset = useCallback(() => setState({ busy: false, error: null }), [])

  return { state, run, reset }
}
