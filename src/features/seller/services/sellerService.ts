/**
 * The seller service contract, and the one place an adapter is chosen.
 *
 * Screens and hooks talk to `SellerService` and nothing else. Adding a real backend means writing a
 * second adapter that satisfies this interface — no page component changes. See arch.md §5.
 */

import { isSupabaseConfigured } from '@/lib/config'
import { ServiceError } from '../types/seller'
import type {
  ActivityEvent,
  AnalyticsRange,
  AnalyticsSummary,
  DataSource,
  MutationResult,
  Product,
  ProductInput,
  ProductQuery,
  ProductView,
  Seller,
  ServiceResult,
  Store,
  StorefrontView,
  StoreInput,
} from '../types/seller'
import { createMockSellerService } from './mockSellerService'

export interface SellerService {
  /** Which backend this instance talks to. Drives the demo badges in the UI. */
  readonly mode: DataSource

  /* ── Session ───────────────────────────────────────────────────────────── */
  getSession(): Promise<ServiceResult<Seller | null>>
  signIn(): Promise<ServiceResult<Seller>>
  signOut(): Promise<void>

  /* ── Store ─────────────────────────────────────────────────────────────── */
  getStore(): Promise<ServiceResult<Store>>
  isSlugAvailable(slug: string): Promise<boolean>
  updateStore(input: StoreInput): Promise<MutationResult<Store>>

  /* ── Products ──────────────────────────────────────────────────────────── */
  listProducts(query?: ProductQuery): Promise<ServiceResult<Product[]>>
  getProduct(productId: string): Promise<ServiceResult<Product | null>>
  createProduct(input: ProductInput): Promise<MutationResult<Product>>
  updateProduct(productId: string, input: ProductInput): Promise<MutationResult<Product>>
  deleteProduct(productId: string): Promise<MutationResult<{ id: string }>>

  /* ── Activity and analytics ────────────────────────────────────────────── */
  listActivity(limit?: number): Promise<ServiceResult<ActivityEvent[]>>
  getAnalytics(range: AnalyticsRange): Promise<ServiceResult<AnalyticsSummary>>

  /* ── Public storefront ─────────────────────────────────────────────────── */
  /**
   * `includeDrafts` is an owner-only view. The mock adapter serves it because there is a single
   * demo seller; a real adapter must reject it unless `auth.uid() = store.seller_id`.
   */
  getStorefront(
    storeSlug: string,
    options?: { includeDrafts?: boolean },
  ): Promise<ServiceResult<StorefrontView | null>>
  getPublicProduct(storeSlug: string, productId: string): Promise<ServiceResult<ProductView | null>>
  /** Resolves a bare `/p/:productId` link to the store that owns the product. */
  resolveProduct(productId: string): Promise<ServiceResult<ProductView | null>>
}

let instance: SellerService | null = null

/**
 * Operations only a browser-local adapter can offer. They exist so the Settings screen can show the
 * storage caveat truthfully and let a developer wipe demo state — they are not part of the contract
 * a real backend has to satisfy, so they live outside `SellerService`.
 */
export interface DemoMaintenance {
  resetDemoData(): Promise<void>
  describePersistence(): { mode: 'browser-local'; detail: string }
}

export function isDemoService(
  service: SellerService,
): service is SellerService & DemoMaintenance {
  return service.mode === 'demo'
}

/**
 * Builds the service for the current configuration.
 *
 * When Supabase variables are present but no adapter has been written, this **fails loudly**. It
 * deliberately does not fall back to the demo store: a configuration that claims a backend exists
 * and then quietly serves fake data is exactly the failure mode arch.md §5 exists to prevent.
 */
export function createSellerService(): SellerService {
  if (isSupabaseConfigured) {
    throw new ServiceError(
      'not_implemented',
      'Supabase is configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set) but the Supabase adapter has not been implemented in this repository. Implement createSupabaseSellerService() against the SellerService interface and its schema and RLS policies in arch.md §7, or unset the variables to run against the browser-local demo store.',
    )
  }

  return createMockSellerService()
}

/** Cached singleton. Adapters are stateless, so one instance serves the whole app. */
export function getSellerService(): SellerService {
  instance ??= createSellerService()
  return instance
}

/** Test seam — lets a test or story swap in a stub adapter. */
export function setSellerService(next: SellerService | null): void {
  instance = next
}
