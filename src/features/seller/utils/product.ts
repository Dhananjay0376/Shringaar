/**
 * Product-level derivations shared by the seller screens and the storefront.
 *
 * Everything here is pure and takes the domain types, so both features can use it without either
 * importing the other's components.
 */

import {
  categoryLabel,
  hasUsableTryOnAsset as hasUsableAsset,
  normaliseWhatsApp,
  productPublicUrl,
  resolveContactWhatsApp,
  storePublicUrl,
  tryOnUrl,
} from '@/lib/catalog'
import { config } from '@/lib/config'
import { formatCurrency } from '@/lib/format'
import type { Product, ProductQuery, Store, TryOnAssetKind } from '../types/seller'

export function priceLabel(product: Product): string {
  return formatCurrency(product.price, product.currency)
}

export function productCategoryLabel(product: Product): string {
  return categoryLabel(product.category)
}

/**
 * The WhatsApp destination for a product: the product's own number when set, otherwise the store's.
 * The rule itself lives in `@/lib/catalog` so the storefront resolves it identically — see the
 * comment there.
 */
export function resolveContactNumber(product: Product, store: Store): string | null {
  return resolveContactWhatsApp(product, store)
}

/** Absolute public URL of a product — the value a QR code and the copy-link action encode. */
export function productUrl(product: Product, store: Store): string {
  return productPublicUrl(config.publicSiteUrl, store.slug, product.id)
}

/** Absolute public URL of the storefront. */
export function storeUrl(store: Store): string {
  return storePublicUrl(config.publicSiteUrl, store.slug)
}

/** AR client link, or null when no try-on host is configured yet. */
export function productTryOnUrl(product: Product): string | null {
  return tryOnUrl(config.tryOnBaseUrl, product.id)
}

/** True when this product has an asset an AR client could actually render. */
export function hasUsableTryOnAsset(product: Product): boolean {
  return hasUsableAsset(product)
}

export function tryOnKindLabel(kind: TryOnAssetKind): string {
  switch (kind) {
    case 'glb':
      return 'glTF 3D'
    case 'usdz':
      return 'USDZ 3D'
    case 'image':
      return '2D overlay'
    default:
      return 'None'
  }
}

/* ── Filtering and sorting ───────────────────────────────────────────────── */

export function matchesQuery(product: Product, query: ProductQuery): boolean {
  const category = query.category ?? 'all'
  const status = query.status ?? 'all'

  if (category !== 'all' && product.category !== category) return false
  if (status !== 'all' && product.status !== status) return false

  const search = query.search?.trim().toLowerCase()
  if (!search) return true

  // Search covers the fields a seller would actually scan by. Category label matching means typing
  // "necklace" finds a product filed under "Necklaces".
  const haystack = [
    product.name,
    product.description,
    categoryLabel(product.category),
    product.status,
    String(product.price),
  ]
    .join(' ')
    .toLowerCase()

  return search.split(/\s+/).every((term) => haystack.includes(term))
}

/** Newest first — the order a seller expects when they have just added something. */
export function sortByUpdatedDesc(products: Product[]): Product[] {
  return [...products].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
}

export function sortByCreatedDesc(products: Product[]): Product[] {
  return [...products].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

/* ── Counts used by the dashboard and filters ────────────────────────────── */

export interface ProductCounts {
  total: number
  published: number
  drafts: number
  withTryOn: number
}

export function countProducts(products: Product[]): ProductCounts {
  return {
    total: products.length,
    published: products.filter((product) => product.status === 'published').length,
    drafts: products.filter((product) => product.status === 'draft').length,
    withTryOn: products.filter(hasUsableTryOnAsset).length,
  }
}

/* ── Slug generation for products ────────────────────────────────────────── */

/**
 * Products need a slug for a readable URL, but the public URL is keyed on the product id, so a
 * duplicate slug is a cosmetic problem rather than a routing one. We still de-duplicate within the
 * store to keep future database uniqueness constraints satisfiable.
 */
export function uniqueProductSlug(base: string, existing: Product[], excludeId?: string): string {
  const taken = new Set(
    existing.filter((product) => product.id !== excludeId).map((product) => product.slug),
  )

  if (!taken.has(base)) return base

  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

/** Digits-only WhatsApp comparison, so "+91 98200 00000" and "919820000000" match. */
export function sameContactNumber(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return normaliseWhatsApp(a) === normaliseWhatsApp(b)
}
