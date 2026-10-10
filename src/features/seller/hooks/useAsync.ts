import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import { isServiceError } from '../types/seller'

/**
 * Minimal async data hook.
 *
 * A data-fetching library would be a reasonable addition later, but for six screens it would add
 * more surface than it removes. What this does provide is the part that is easy to get wrong: it
 * ignores a response that arrives after its inputs have changed, and it never leaves `loading` set
 * on a stale request.
 */

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** Re-runs the loader. Safe to call from an error state's retry button. */
  reload: () => void
  /** Applies a locally-known result without a round trip, e.g. after a successful save. */
  setData: (next: T) => void
}

export function toErrorMessage(error: unknown): string {
  if (isServiceError(error)) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Try again.'
}

export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  // The loader closes over the current render's values; keeping it in a ref means the effect only
  // re-runs when the caller's deps change, not on every render.
  const loadRef = useRef(load)
  loadRef.current = load

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
        setData(result)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (!active || ticket !== ticketRef.current) return
        setError(toErrorMessage(cause))
        setLoading(false)
      })

    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])

  return { data, loading, error, reload, setData }
}
