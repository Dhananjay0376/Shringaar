/**
 * The seller service contract, and the one place an adapter is chosen.
 *
 * Screens and hooks talk to `SellerService` and nothing else. Adding a real backend means writing a
 * second adapter that satisfies this interface — no page component changes. See arch.md §5.
 *
 * Two things about this interface are worth stating before reading it:
 *
 *  * **Reads say where they came from.** Every `ServiceResult` carries `dataSource`, and every
 *    `MutationResult` carries `persistence`. A screen never has to guess whether it is looking at a
 *    database or at browser-local sample data, because it is told.
 *
 *  * **Capabilities are asked for, not inferred.** `capabilities` says what this particular backend
 *    can actually do, so "should there be a password field?" is answered by the backend rather than
 *    by a hard-coded assumption about which adapter is in play.
 */

import { isSupabaseConfigured } from '@/lib/config'
import { ServiceError } from '../types/seller'
import type {
  ActivityEvent,
  AnalyticsRange,
  AnalyticsSummary,
  AuthStateListener,
  DataSource,
  MutationResult,
  OAuthProvider,
  Product,
  ProductImage,
  ProductInput,
  ProductQuery,
  ProductView,
  Seller,
  ServiceCapabilities,
  ServiceResult,
  SignInInput,
  SignUpInput,
  SignUpOutcome,
  Store,
  StorefrontView,
  StoreInput,
  StoreSetupInput,
  StoredAsset,
  StoredTryOnAsset,
  UploadOptions,
} from '../types/seller'
import { createMockSellerService } from './mockSellerService'
import { createSupabaseSellerService } from './supabaseSellerService'

export interface SellerService {
  /** Which backend this instance talks to. Drives the demo badges in the UI. */
  readonly mode: DataSource

  /** What this backend can actually do. Read by screens instead of guessing from `mode`. */
  readonly capabilities: ServiceCapabilities

  /* ── Session ───────────────────────────────────────────────────────────── */

  getSession(): Promise<ServiceResult<Seller | null>>

  /**
   * Creates an account. Does **not** always open a session — a project with email confirmation
   * enabled returns `status: 'confirmation-required'` and no seller, and the caller must show the
   * seller their next step rather than route them into a dashboard they cannot load.
   */
  signUp(input: SignUpInput): Promise<ServiceResult<SignUpOutcome>>

  /**
   * Opens the session. `password` is required by the Supabase adapter and ignored by the demo one,
   * which has no credential to verify — `capabilities.auth` is what tells a form which it is
   * dealing with, and therefore whether to render a password field at all.
   */
  signIn(input: SignInInput): Promise<ServiceResult<Seller>>

  /**
   * Starts a sign-in with a third-party identity and **navigates the page away**.
   *
   * It resolves only when the attempt failed before leaving — a provider that is not enabled on the
   * project, a blocked popup, a network fault. On success there is no return value and no
   * subsequent line of the caller's runs, because the browser is already at the provider. The app
   * picks the session up on the way back through `getSession()` and `onAuthStateChange`.
   *
   * Returning `void` rather than a session is the honest shape: a promise that resolved with a
   * seller would describe a state the page can never observe.
   *
   * Guarded by `capabilities.oauth`, which the demo adapter reports false and never reaches.
   */
  signInWithOAuth(provider: OAuthProvider): Promise<void>

  signOut(): Promise<void>

  /**
   * Subscribes to session changes that originate outside this app's own calls — a token refresh
   * that fails, a sign-out in another tab, an email-confirmation link landing on this page.
   * Returns an unsubscribe function.
   *
   * The demo adapter has no auth service and therefore no such events; it returns a no-op
   * unsubscribe rather than pretending to emit.
   */
  onAuthStateChange(listener: AuthStateListener): () => void

  /* ── Store ─────────────────────────────────────────────────────────────── */

  /**
   * The signed-in seller's store, or null when they have not created one yet.
   *
   * Nullable because that is the true state of a seller thirty seconds after signing up, and an
   * adapter that returned a placeholder store here would send them to a dashboard whose "My Store"
   * screen edits a row that does not exist. Callers route on it: null means onboarding.
   */
  getStore(): Promise<ServiceResult<Store | null>>

  /**
   * Creates the seller's store, or brings the one they already have up to date.
   *
   * Deliberately idempotent: a submit that times out and is retried must not fail with a duplicate
   * key, which is what a plain INSERT against `stores_one_per_owner_idx` would do. Onboarding writes
   * are safe to retry because this is the first of them.
   */
  createStore(input: StoreSetupInput): Promise<MutationResult<Store>>

  /**
   * Marks the guided first run finished, which is also what makes the store publicly readable —
   * the `storefront_*` views are gated on the same flag. Until then the store exists, is resumable,
   * and is invisible to customers.
   */
  completeOnboarding(): Promise<MutationResult<Store>>

  /** Whether a store slug is free. Answered by the backend, because only it can see all stores. */
  isSlugAvailable(slug: string): Promise<boolean>

  updateStore(input: StoreInput): Promise<MutationResult<Store>>

  /* ── Products ──────────────────────────────────────────────────────────── */

  listProducts(query?: ProductQuery): Promise<ServiceResult<Product[]>>
  getProduct(productId: string): Promise<ServiceResult<Product | null>>
  createProduct(input: ProductInput): Promise<MutationResult<Product>>
  updateProduct(productId: string, input: ProductInput): Promise<MutationResult<Product>>
  deleteProduct(productId: string): Promise<MutationResult<{ id: string }>>

  /* ── Uploads ───────────────────────────────────────────────────────────── */

  /**
   * Puts an image in object storage and returns the record to attach to a product.
   *
   * Kept strictly separate from `uploadTryOnAsset`: a product photo is a 2D image a customer looks
   * at, and nothing in this system turns one into a 3D model. They land in different buckets under
   * different size limits for that reason.
   */
  uploadProductImage(
    file: File,
    options?: UploadOptions,
  ): Promise<MutationResult<ProductImage>>

  /** Stores an authored try-on asset — a 2D placement photo, or a real `.glb`/`.usdz`. */
  uploadTryOnAsset(
    file: File,
    options?: UploadOptions,
  ): Promise<MutationResult<StoredTryOnAsset>>

  /**
   * Stores the store's logo.
   *
   * A third bucket rather than a folder in `product-images`, because a logo outlives any product:
   * the cleanup that removes a deleted product's objects must not be able to reach the brand.
   */
  uploadStoreLogo(file: File, options?: UploadOptions): Promise<MutationResult<StoredAsset>>

  /**
   * Removes a previously uploaded object. Best-effort by contract: a failure here must never block
   * a delete or a save that has already succeeded, because an orphaned object costs a few kilobytes
   * and a failed save costs the seller their work. Callers log, they do not surface.
   */
  deleteUploadedAsset(url: string): Promise<void>

  /* ── Activity and analytics ────────────────────────────────────────────── */

  listActivity(limit?: number): Promise<ServiceResult<ActivityEvent[]>>
  getAnalytics(range: AnalyticsRange): Promise<ServiceResult<AnalyticsSummary>>

  /* ── Public storefront ─────────────────────────────────────────────────── */

  /**
   * `includeDrafts` is an owner-only view. The backend refuses it for anyone who does not own the
   * store — in Supabase this is not a check the adapter performs but a consequence of Row Level
   * Security, which returns nothing at all to a non-owner reading the base tables.
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
 * With Supabase variables present it returns the Supabase adapter. Without them it returns the
 * browser-local demo store. There is deliberately no third behaviour and no silent fallback: a
 * build that claims a backend exists and then serves sample data is the failure arch.md §5 exists
 * to prevent, and a build configured for demo that silently reaches the network would be worse.
 */
export function createSellerService(): SellerService {
  if (isSupabaseConfigured) {
    return createSupabaseSellerService()
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

/** Re-exported so adapter authors do not have to reach into the types module for the error class. */
export { ServiceError }
