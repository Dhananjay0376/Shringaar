import { useEffect } from 'react'

/**
 * Sets the browser tab title for the duration of a screen.
 *
 * Two titles exist in this app — the seller's dashboard and a customer's storefront — and a shared
 * storefront link must not open a tab labelled "Seller Dashboard" in front of a buyer. Each screen
 * declares its own; the value in `index.html` is only the fallback for the first paint.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return
    document.title = title
  }, [title])
}
