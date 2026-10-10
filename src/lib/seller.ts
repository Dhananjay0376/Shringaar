/**
 * The seller domain contract.
 *
 * This module is the single source of truth for the shape of a seller, store, product, try-on asset
 * and analytics summary. Three consumers read it: the seller dashboard, the public storefront, and
 * the AR try-on client. A change here is a cross-module change — see arch.md §4 and §9.
 *
 * It was moved here from `features/seller/types/seller.ts`, which arch.md §9 rule 1 pre-authorised
 * for exactly this moment: when a third consumer of the contract appears, the contract moves down
 * into `lib` rather than having a third feature import across. It imports only `@/lib/catalog`, so
 * the "`lib/` must not import from `features/`" rule holds. `features/seller/types/seller.ts` is now
 * a re-export shim, so every existing import path keeps working untouched.
 *
 * This module is **not** types-only: `ServiceError`, `NotImplementedInDemoError` and
 * `isServiceError` are runtime values, consumed as values by the service adapters and the upload
 * fields. The shim therefore re-exports with `export *`, not `export type *`.
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

/**
 * Where a binary asset lives. Demo assets are browser previews, not storage objects.
 *
 * `asset-service` is a fourth case that is a real URL but not a Supabase object: an asset produced
 * by the processing service (`backend/`), served from that service's own `/files/` route. It is
 * kept distinct from `storage` because the two are not interchangeable — a `storage` URL is a
 * Supabase public object that outlives the request, while an `asset-service` URL is only as
 * available as the service that produced it. Collapsing them would let the UI claim a durable
 * publish for something that is not one.
 */
export type AssetOrigin = 'demo-seed' | 'local-preview' | 'storage' | 'asset-service'

/* ── Entities ────────────────────────────────────────────────────────────── */

export interface Seller {
  /** Auth user id. This is the ownership anchor that Row Level Security keys on. */
  id: string
  email: string
  displayName: string
  createdAt: string
}

/* ── Authentication ──────────────────────────────────────────────────────────
   What the app can ask of a session, stated once so the demo adapter and the Supabase adapter
   agree. `password` is optional here and not because it is optional in reality — a real backend
   requires one — but because the demo adapter has no credential to check and must not pretend
   otherwise. `ServiceCapabilities.auth` is how a screen knows which of the two it is talking to,
   and it is the only thing allowed to decide whether a password field is rendered.
   -------------------------------------------------------------------------- */

export interface SignInInput {
  email: string
  /** Required by a real backend. The demo adapter ignores it and says so. */
  password?: string
}

export interface SignUpInput {
  email: string
  /** Required by a real backend. */
  password?: string
  /** Pre-fills the profile the signup trigger creates. */
  displayName?: string
}

/**
 * The result of a sign-up, which is not always a session.
 *
 * When a project requires email confirmation, Supabase creates the user and returns **no session**
 * until the link in the email is followed. Modelling that as an error would be wrong — nothing
 * failed — and modelling it as success would strand the caller trying to use a session that is not
 * there. Hence a status the caller must switch on.
 */
export interface SignUpOutcome {
  status: 'active' | 'confirmation-required'
  /** The signed-in seller, or null when a confirmation email is still pending. */
  seller: Seller | null
  /** Sentence to show the seller. Written here so both adapters phrase it the same way. */
  message: string
}

/**
 * The third-party identities a seller can sign in with.
 *
 * A closed vocabulary, and deliberately a union rather than a bare `string`: the provider name is
 * forwarded to the backend, and a typo there would be rejected at runtime by a service that cannot
 * tell a misspelling from a provider that is simply not enabled. Adding one here is the single edit.
 */
export type OAuthProvider = 'google'

/** Display names, kept next to the union so a label cannot outlive the provider it names. */
export const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: 'Google',
}

export interface ServiceCapabilities {
  /** The backend verifies a credential. When false, the sign-in screen offers no password field. */
  auth: boolean
  /**
   * The backend can start a redirect-based sign-in with a third-party identity.
   *
   * Separate from `auth` on purpose. Both are true for Supabase, but they are different claims: a
   * backend could verify an email and password and have no provider configured, and a screen that
   * read `auth` as "show the Google button" would then offer a door that does not open.
   */
  oauth: boolean
  /** Bytes go to object storage rather than a data URL held in this browser. */
  uploads: boolean
  /** Writes land in a database rather than browser-local storage. */
  database: boolean
}

/** Notified when the session changes underneath the app — a sign-out in another tab, a token
 *  refresh that fails, or an email-confirmation link landing on this page. */
export type AuthStateListener = (seller: Seller | null) => void

export interface Store {
  id: string
  /**
   * The owning seller's auth id, or null on a **public projection**.
   *
   * A customer reading a storefront has no business knowing which account owns the shop, and the
   * public views in `supabase/migrations` deliberately omit it — so this is null for anything the
   * storefront fetched, and set for anything the dashboard fetched. Ownership is never *decided*
   * from this field on the client; Row Level Security decides it from the session. Treat it as
   * information, not authorisation.
   */
  sellerId: string | null
  name: string
  /** Public URL key. Lowercase, hyphenated, unique across the platform. */
  slug: string
  description: string
  /**
   * The city the seller trades from. Optional on purpose: a seller who is still setting up should
   * never be blocked at the door by a field that only ever appears in the storefront footer.
   */
  city: string | null
  logoUrl: string | null
  contactEmail: string | null
  contactPhone: string | null
  whatsappNumber: string | null
  currency: CurrencyCode
  /**
   * False while the guided first run is unfinished.
   *
   * A store row is created on the first step, not the last, so that a seller who closes the tab
   * halfway through has something to come back to. This flag is what makes resuming possible, and
   * what keeps a half-built store off the public storefront — the public views are gated on it.
   */
  onboardingCompleted: boolean
  createdAt: string
  updatedAt: string
}

/**
 * What storing a file produced, whichever backend stored it.
 *
 * The shared spine of `ProductImage` and `TryOnAsset`. Three assets in this system are bytes plus
 * facts about those bytes — a product photo, a 2D try-on overlay, a store logo — and they differ in
 * *where* they are kept and *what they mean*, never in what an upload reports back. Naming that
 * common part once means an uploader for any of them can be handed to the same picker, and
 * `origin` means nothing downstream can mistake a browser-held preview for a stored object.
 */
export interface StoredAsset {
  url: string
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  origin: AssetOrigin
  uploadedAt: string | null
}

/** A file the picker has taken responsibility for. Returns the facts, or throws with a reason. */
export type AssetUploader = (file: File, onProgress: UploadReporter) => Promise<StoredAsset>

export interface ProductImage extends StoredAsset {
  id: string
  width: number | null
  height: number | null
}

/**
 * The asset that drives the try-on experience, kept deliberately separate from the display image.
 *
 * An ordinary product photo is NOT converted into a 3D model anywhere in this system. `image` means
 * 2D placement of a cut-out; `glb`/`usdz` mean a real 3D asset authored elsewhere; `none` means the
 * product is browsable but has no AR experience yet. See arch.md §8.
 *
 * It is a `StoredAsset` in every field but one: `url` may be null. That extra state is a try-on
 * asset whose kind is declared while its bytes are not stored — reachable in the browser-local demo
 * store, which has nowhere to put a 45 MB mesh, and unreachable through a connected backend, where
 * an upload that returns no URL has failed. Widening this one field is how the demo stays honest
 * without making `ProductImage.url` nullable, which would put a null check on every thumbnail in
 * the app for a case that cannot happen.
 */
export interface TryOnAsset extends Omit<StoredAsset, 'url'> {
  url: string | null
  kind: TryOnAssetKind
  /** Where the AR client should attempt to place the piece — a hint, not a guarantee. */
  anchor: TryOnAnchor
}

/**
 * A try-on asset as it comes back from a successful upload, where the URL is not optional.
 *
 * Callers that hand an upload straight to a picker get this rather than the wider `TryOnAsset`, so
 * a URL that cannot be null does not have to be null-checked at every call site.
 */
export type StoredTryOnAsset = TryOnAsset & { url: string }

export interface Product {
  id: string
  /**
   * The owning seller's auth id, or null on a public projection — see `Store.sellerId`.
   *
   * Note that the `products` table has **no owner column**: ownership is
   * `products.store_id → stores.owner_id`, and Row Level Security resolves it there. This field is
   * filled in for the client's convenience from the parent store, and a denormalised copy that could
   * disagree with its store is exactly the ownership bug the schema refuses to store.
   */
  sellerId: string | null
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
  city: string | null
  logoUrl: string | null
  contactEmail: string | null
  contactPhone: string | null
  whatsappNumber: string | null
  currency: CurrencyCode
}

/**
 * The minimum a store needs in order to exist.
 *
 * Deliberately narrower than `StoreInput`: onboarding asks for a name and nothing it cannot do
 * without. Currency, description, contact email and slug are filled in from defaults and stay
 * editable on the store screen, so a seller photographing stock on a phone is never stopped by a
 * form they did not come here to fill in.
 */
export interface StoreSetupInput {
  name: string
  city: string | null
  logoUrl: string | null
  whatsappNumber: string | null
}

export interface ProductQuery {
  search?: string
  category?: ProductCategory | 'all'
  status?: ProductStatus | 'all'
}

/* ── Uploads ─────────────────────────────────────────────────────────────────
   Reported as a *phase* rather than a percentage, and the distinction is deliberate.

   `supabase-js` uploads through `fetch`, which exposes no byte-level progress — there is no
   `onUploadProgress` to subscribe to the way an `XMLHttpRequest` offers. A progress bar driven by
   a timer would be theatre: it would reach 100% while bytes were still going out, and the seller
   would learn to distrust it precisely when a large .glb was actually slow.

   A phase is a thing the client genuinely knows, so it is what the UI is given. `fraction` is
   filled in only where it can be measured honestly, and stays null otherwise.
   -------------------------------------------------------------------------- */

export type UploadPhase = 'validating' | 'uploading' | 'finishing'

export interface UploadProgress {
  phase: UploadPhase
  /** 0–1 when the transport can measure it, null when it cannot. Never a guess. */
  fraction: number | null
}

export type UploadReporter = (progress: UploadProgress) => void

export interface UploadOptions {
  /**
   * Ids the storage path with, so a product's images live under a folder named for the product.
   * Omitted while the product does not exist yet — the auth user id alone still scopes the object.
   */
  productId?: string
  onProgress?: UploadReporter
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
  /**
   * The backend refused the operation for this account — a Row Level Security policy with no
   * matching branch, or an operation attempted while signed out.
   *
   * Kept distinct from `validation` deliberately: "you cannot do this" and "what you typed is
   * wrong" call for different words on screen, and conflating them teaches a seller to retype
   * something that was never the problem.
   */
  | 'not_authorized'
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
