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

  seller: {
    signIn: '/seller/sign-in',
    dashboard: '/seller/dashboard',
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
  },
} as const

/** Section labels for the header breadcrumb, keyed by the path they belong to. */
export const SELLER_SECTIONS = {
  dashboard: 'Overview',
  products: 'Products',
  addProduct: 'Add Product',
  editProduct: 'Edit Product',
  store: 'My Store',
  analytics: 'Analytics',
  settings: 'Settings',
} as const
