import { useEffect, useState } from 'react'

/**
 * Debounces a rapidly changing value — used for the product search box so typing does not fire a
 * request per keystroke.
 */
export function useDebounced<T>(value: T, delay = 260): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])

  return debounced
}
