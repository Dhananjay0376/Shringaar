import { productPath, storePath } from '@/lib/catalog'

/**
 * Every route in the app, in one place.
 *
 * Nothing in the codebase writes a URL as a literal string — links go through here, which is what
 * keeps a route rename from turning into a hunt through components. The public paths are generated
 * by `@/lib/catalog` because the QR codes, the copy-link buttons and the storefront all have to
 * agree on exactly the same URL down to the character; a second definition is a second chance for
 * a printed QR code to point somewhere that 404s.
 *
 * See arch.md §6 for the routing table.
 */

export const paths = {
  root: '/',

  /**
   * The public marketing surface a seller lands on before they have an account. Split from
   * `seller.*` because none of it assumes a session — it is the same page for a visitor, a
   * half-onboarded seller and a signed-in one.
   */
  marketing: {
    landing: '/',
    /** Creates a store. The path names the intent, not the step, so the flow can gain steps. */
    getStarted: '/get-started',
    signIn: '/sign-in',
  },

  /**
   * The guided first run. Each step is its own URL so a refresh, a back button and a shared link all
   * behave — a wizard held in component state alone loses a seller who reloads on step three.
   */
  onboarding: {
    store: '/onboarding/store',
    ready: '/onboarding/ready',
    products: '/onboarding/products',
  },

  seller: {
    // The sign-in screen lives at the marketing path; the seller entry is an alias so every existing
    // redirect into it keeps working.
    signIn: '/sign-in',
    dashboard: '/seller/dashboard',
    collection: '/seller/collection',
    products: '/seller/products',
    addProduct: '/seller/products/new',
    /** Edit is a distinct route so it survives a refresh and can be linked to. */
    editProduct: (productId: string) => `/seller/products/${productId}/edit`,
    store: '/seller/store',
    analytics: '/seller/analytics',
    settings: '/seller/settings',
  },

  public: {
    store: (storeSlug: string) => storePath(storeSlug),
    product: (storeSlug: string, productId: string) => productPath(storeSlug, productId),
    /**
     * Bare product URL, without the store slug. Used only when a link arrives from outside and the
     * store is not yet known — the route resolves the product and redirects to the canonical
     * store-scoped URL rather than serving a page that cannot identify the seller.
     */
    resolveProduct: (productId: string) => `/p/${productId}`,
    /**
     * The in-repo try-on experience. Its shape is not a free choice: `tryOnUrl()` in `@/lib/catalog`
     * has always built `${base}/tryon/${id}`, and the product page has always linked to that. Keeping
     * the same shape means the existing `VITE_TRYON_BASE_URL` seam keeps working untouched — unset
     * resolves in-app, set points at the external host exactly as before.
     */
    tryOn: (productId: string) => `/tryon/${productId}`,
    /** Developer diagnostics for the tracking engine. Needs no session and shows no seller data. */
    tryOnLab: '/tryon/lab',
  },
} as const

/** Section labels for the header breadcrumb, keyed by the path they belong to. */
export const SELLER_SECTIONS = {
  dashboard: 'Home',
  collection: 'Collection',
  products: 'Products',
  addProduct: 'Add Product',
  editProduct: 'Edit Product',
  store: 'My Store',
  analytics: 'Analytics',
  settings: 'Settings',
} as const
