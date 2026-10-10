/**
 * The seller domain contract.
 *
 * This module is the single source of truth for the shape of a seller, store, product, try-on asset
 * and analytics summary. Three consumers read it: the seller dashboard, the public storefront, and
 * (later) the AR try-on client. A change here is a cross-module change — see arch.md §4 and §9.
 *
 * Closed vocabularies (categories, currencies, statuses, try-on kinds and anchors) are derived from
 * `@/lib/catalog`, so there is exactly one place to add a category.
 */

import type {
  CategoryKey,
  CurrencyKey,
  ProductStatusKey,
  TryOnAnchor,
  TryOnAssetKind,
} from '@/lib/catalog'

export type ProductCategory = CategoryKey
export type CurrencyCode = CurrencyKey
export type ProductStatus = ProductStatusKey
export type { TryOnAnchor, TryOnAssetKind }

/* ── Provenance ──────────────────────────────────────────────────────────────
   Every read tells the caller whether it came from a real backend or from the
   browser-local demo store. Nothing in the UI may guess this — it is carried
   with the data. See arch.md §5.
   -------------------------------------------------------------------------- */

export type DataSource = 'demo' | 'live'
export type PersistenceMode = 'browser-local' | 'database'

export interface ServiceResult<T> {
  data: T
  dataSource: DataSource
}

export interface MutationResult<T> {
  data: T
  dataSource: DataSource
  /** Where the write actually landed. Demo writes are `browser-local`, never `database`. */
  persistence: PersistenceMode
  /**
   * Set when the write succeeded in memory but could not be persisted (demo storage quota, blocked
   * storage). The UI surfaces this so a change is never silently lost on reload.
   */
  warning?: string
}

/** Where a binary asset lives. Demo assets are browser previews, not storage objects. */
export type AssetOrigin = 'demo-seed' | 'local-preview' | 'storage'

/* ── Entities ────────────────────────────────────────────────────────────── */

export interface Seller {
  /** Auth user id. This is the ownership anchor that Row Level Security keys on. */
  id: string
  email: string
  displayName: string
  createdAt: string
}

export interface Store {
  id: string
  sellerId: string
  name: string
  /** Public URL key. Lowercase, hyphenated, unique across the platform. */
  slug: string
  description: string
  logoUrl: string | null
  contactEmail: string | null
  contactPhone: string | null
  whatsappNumber: string | null
  currency: CurrencyCode
  createdAt: string
  updatedAt: string
}

export interface ProductImage {
  id: string
  url: string
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  width: number | null
  height: number | null
  origin: AssetOrigin
  uploadedAt: string | null
}

/**
 * The asset that drives the try-on experience, kept deliberately separate from the display image.
 *
 * An ordinary product photo is NOT converted into a 3D model anywhere in this system. `image` means
 * 2D placement of a cut-out; `glb`/`usdz` mean a real 3D asset authored elsewhere; `none` means the
 * product is browsable but has no AR experience yet. See arch.md §8.
 */
export interface TryOnAsset {
  kind: TryOnAssetKind
  url: string | null
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  /** Where the AR client should attempt to place the piece — a hint, not a guarantee. */
  anchor: TryOnAnchor
  origin: AssetOrigin
  uploadedAt: string | null
}

export interface Product {
  id: string
  /** Denormalised ownership column. RLS keys on this — see arch.md §7.3. */
  sellerId: string
  storeId: string
  name: string
  slug: string
  description: string
  /** Stored as a number; formatted at render time. Never a pre-formatted string. */
  price: number
  currency: CurrencyCode
  category: ProductCategory
  status: ProductStatus
  image: ProductImage | null
  tryOnAsset: TryOnAsset | null
  /** An existing listing elsewhere (the seller's own website). Optional. */
  externalProductUrl: string | null
  /** Overrides the store's WhatsApp number for this product only. */
  whatsappNumber: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

/* ── Inputs ──────────────────────────────────────────────────────────────── */

export interface ProductInput {
  name: string
  description: string
  price: number
  currency: CurrencyCode
  category: ProductCategory
  status: ProductStatus
  image: ProductImage | null
  tryOnAsset: TryOnAsset | null
  externalProductUrl: string | null
  whatsappNumber: string | null
}

export interface StoreInput {
  name: string
  slug: string
  description: string
  logoUrl: string | null
  contactEmail: string | null
  contactPhone: string | null
  whatsappNumber: string | null
  currency: CurrencyCode
}

export interface ProductQuery {
  search?: string
  category?: ProductCategory | 'all'
  status?: ProductStatus | 'all'
}

/* ── Analytics ───────────────────────────────────────────────────────────── */

export type AnalyticsRange = 7 | 30 | 90

export interface AnalyticsTotals {
  storeVisits: number
  productViews: number
  tryOnStarts: number
  outboundClicks: number
  contactClicks: number
}

export interface AnalyticsPoint extends AnalyticsTotals {
  /** ISO date (day granularity). */
  date: string
}

export interface AnalyticsTopProduct {
  productId: string
  name: string
  views: number
  tryOnStarts: number
  outboundClicks: number
}

export interface AnalyticsSummary {
  range: AnalyticsRange
  dataSource: DataSource
  generatedAt: string
  totals: AnalyticsTotals
  /** The immediately preceding window of the same length, for deltas. */
  previousTotals: AnalyticsTotals
  series: AnalyticsPoint[]
  topProducts: AnalyticsTopProduct[]
}

/* ── Activity ────────────────────────────────────────────────────────────── */

export type ActivityType =
  | 'product_created'
  | 'product_updated'
  | 'product_published'
  | 'product_unpublished'
  | 'product_deleted'
  | 'store_updated'
  | 'asset_uploaded'

export interface ActivityEvent {
  id: string
  type: ActivityType
  message: string
  productId: string | null
  productName: string | null
  at: string
}

/* ── Public projections ──────────────────────────────────────────────────── */

/**
 * What a storefront route renders. `viewer` decides whether drafts appear: the owning seller
 * previews everything, the public sees published products only.
 */
export interface StorefrontView {
  store: Store
  products: Product[]
  viewer: 'owner' | 'public'
}

export interface ProductView {
  store: Store
  product: Product
}

/* ── Errors ──────────────────────────────────────────────────────────────── */

export type ServiceErrorCode =
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'not_implemented'
  | 'unknown'

export class ServiceError extends Error {
  readonly code: ServiceErrorCode

  constructor(code: ServiceErrorCode, message: string) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
  }
}

/**
 * Thrown for operations a browser-local store cannot honestly perform — uploading to storage,
 * authenticating a real user, writing analytics events. Failing loudly is the point: silently
 * pretending would make demo mode indistinguishable from a working backend.
 */
export class NotImplementedInDemoError extends ServiceError {
  constructor(operation: string, detail: string) {
    super(
      'not_implemented',
      `${operation} needs a connected backend. ${detail} The dashboard is running in demo mode.`,
    )
    this.name = 'NotImplementedInDemoError'
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError
}
