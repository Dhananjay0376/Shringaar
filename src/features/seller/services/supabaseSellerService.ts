/**
 * ╔══════════════════════════════════════════════════════════════════════════════════════════╗
 * ║  SUPABASE ADAPTER — the live backend.                                                      ║
 * ║                                                                                          ║
 * ║  Every read comes from Postgres. Every write lands in Postgres. Nothing here is cached or  ║
 * ║  mirrored locally, because a second source of truth is how a dashboard ends up showing a   ║
 * ║  product that was deleted in another tab.                                                 ║
 * ║                                                                                          ║
 * ║  Two rules this file exists to keep:                                                      ║
 * ║                                                                                          ║
 * ║   1. **Ownership is never asserted by the client.** No query here filters by a seller id   ║
 * ║      taken from a URL or a form. Row Level Security derives the owner from the session, so  ║
 * ║      a forged store id returns zero rows rather than another seller's data. The adapter     ║
 * ║      reads what it is given and reports "not found" for what it is not.                     ║
 * ║                                                                                          ║
 * ║   2. **The public reads go through views, not tables.** `storefront_stores` and            ║
 * ║      `storefront_products` are the access-control boundary for anonymous traffic; the base  ║
 * ║      tables are owner-only and carry columns a customer must never see. See               ║
 * ║      `20261010090100_rls_policies.sql`.                                                    ║
 * ╚══════════════════════════════════════════════════════════════════════════════════════════╝
 */

import { isMissingSession, supabase } from '@/lib/supabaseClient'
import {
  CATEGORIES,
  CURRENCIES,
  isReservedSlug,
  slugify,
  TRYON_ANCHORS,
  TRYON_ASSET_KINDS,
  type CategoryKey,
  type CurrencyKey,
  type TryOnAnchor,
  type TryOnAssetKind,
} from '@/lib/catalog'
import { validateImageFile, validateModelFile } from '@/lib/files'
import { matchesQuery, sortByCreatedDesc, uniqueProductSlug } from '../utils/product'
import { oauthRedirectUrl } from '../utils/oauth'
import type {
  ActivityEvent,
  AnalyticsPoint,
  AnalyticsRange,
  AnalyticsSummary,
  AnalyticsTopProduct,
  AnalyticsTotals,
  AuthStateListener,
  MutationResult,
  OAuthProvider,
  Product,
  ProductImage,
  ProductInput,
  ProductQuery,
  ProductView,
  Seller,
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
  TryOnAsset,
  UploadOptions,
  UploadProgress,
} from '../types/seller'
import { ServiceError } from '../types/seller'
import { createId } from '@/lib/id'
import type { SellerService } from './sellerService'

/* ══ Storage layout ══════════════════════════════════════════════════════════
   `{auth.uid()}/{folder}/{uuid}.{ext}`

   The leading segment is the owner's user id, which is what the storage policies compare against
   — so a seller cannot overwrite another seller's object even knowing its exact path. The middle
   segment groups related files: a product's images under the product id, a brand's logo under
   `store-logo`. It is passed explicitly rather than derived from `options.productId`, because the
   logo is not a product and a default of `unassigned` would quietly lump every logo on the platform
   into one folder name.
   ══════════════════════════════════════════════════════════════════════════ */

const BUCKET_IMAGES = 'product-images'
const BUCKET_TRYON = 'tryon-assets'
const BUCKET_LOGOS = 'store-logos'

/** The folder a store logo lands in. Not a product id — a logo outlives every product. */
const LOGO_FOLDER = 'store-logo'

/* ══ Row shapes ══════════════════════════════════════════════════════════════
   Written out rather than generated, because the generated types describe the database and these
   describe the database *as this adapter reads it*. PostgREST hands back `numeric` as a string to
   protect precision, and the public views return a strictly smaller column set than the tables —
   both facts are visible here rather than hidden behind a cast.
   ══════════════════════════════════════════════════════════════════════════ */

interface StoreRow {
  id: string
  owner_id: string
  name: string
  slug: string
  description: string
  logo_url: string | null
  business_type: string | null
  whatsapp_number: string | null
  existing_website_url: string | null
  onboarding_completed: boolean
  city: string | null
  contact_email: string | null
  contact_phone: string | null
  currency: string
  created_at: string
  updated_at: string
}

/** What `storefront_stores` exposes. Owner identity and contact details are absent by design. */
type PublicStoreRow = Omit<StoreRow, 'owner_id' | 'contact_email' | 'contact_phone'>

interface ProductRow {
  id: string
  store_id: string
  name: string
  slug: string
  description: string
  /** PostgREST returns `numeric` as a string. Converted, never trusted as a number directly. */
  price: number | string | null
  currency: string
  category: string
  product_image_url: string | null
  try_on_asset_url: string | null
  try_on_asset_kind: string
  try_on_anchor: string
  original_product_url: string | null
  status: string
  source: string
  whatsapp_number: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

interface ProfileRow {
  id: string
  display_name: string | null
  created_at: string
}

interface EventRow {
  event_type: string
  product_id: string | null
  occurred_at: string
}

/* ══ Errors ══════════════════════════════════════════════════════════════════
   Postgres speaks in five-character codes. Translating them once, here, is what lets a screen say
   "that address is taken" instead of "duplicate key value violates unique constraint".
   ══════════════════════════════════════════════════════════════════════════ */

function toServiceError(error: unknown, context: string): ServiceError {
  if (error instanceof ServiceError) return error

  const code = (error as { code?: string } | null)?.code
  const message = (error as { message?: string } | null)?.message ?? 'Unknown error'

  switch (code) {
    case '23505':
      return new ServiceError('conflict', `${context} clashed with something that already exists.`)
    case '23514':
    case '22P02':
      return new ServiceError('validation', `${context} was not accepted. Check the values and try again.`)
    case '23503':
      return new ServiceError('not_found', `${context} refers to something that no longer exists.`)
    // Raised by RLS when a policy has no matching branch — including the WITH CHECK half, which is
    // what a write into someone else's store hits.
    case '42501':
      return new ServiceError('not_authorized', `${context} is not permitted for this account.`)
    case 'PGRST116':
      return new ServiceError('not_found', `${context} was not found.`)
    default:
      return new ServiceError('unknown', `${context} failed. ${message}`)
  }
}

/* ══ Auth errors ═════════════════════════════════════════════════════════════
   Supabase auth returns sentences meant for a developer. These are the same failures said to a
   seller, without leaking whether an address is registered more than the endpoint already does.
   ══════════════════════════════════════════════════════════════════════════ */

function toAuthError(error: unknown, fallback: string): ServiceError {
  const message = (error as { message?: string } | null)?.message ?? ''
  const status = (error as { status?: number } | null)?.status
  const lower = message.toLowerCase()

  if (lower.includes('invalid login credentials')) {
    return new ServiceError('validation', 'That email and password do not match an account.')
  }
  if (lower.includes('email not confirmed')) {
    return new ServiceError(
      'validation',
      'This account still needs its email confirmed. Open the link we sent, then sign in.',
    )
  }
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return new ServiceError('conflict', 'An account already exists for that email. Sign in instead.')
  }
  if (lower.includes('password') && lower.includes('least')) {
    return new ServiceError('validation', 'Choose a longer password — at least 6 characters.')
  }
  if (status === 429 || lower.includes('rate limit')) {
    return new ServiceError(
      'validation',
      'Too many attempts just now. Wait a minute and try again — the email service is rate limited.',
    )
  }

  return new ServiceError('unknown', message || fallback)
}

/* ══ Row → domain ════════════════════════════════════════════════════════════
   Guards rather than casts. The database column is `text` with a check constraint, and a cast
   would turn a future constraint change into a silent type lie in the UI.
   ══════════════════════════════════════════════════════════════════════════ */

function toCurrency(value: string | null | undefined): CurrencyKey {
  return value && value in CURRENCIES ? (value as CurrencyKey) : 'INR'
}

function toCategory(value: string | null | undefined): CategoryKey {
  return value && value in CATEGORIES ? (value as CategoryKey) : 'other'
}

function toTryOnKind(value: string | null | undefined): TryOnAssetKind {
  return TRYON_ASSET_KINDS.includes(value as TryOnAssetKind)
    ? (value as TryOnAssetKind)
    : 'none'
}

function toAnchor(value: string | null | undefined): TryOnAnchor {
  return TRYON_ANCHORS.includes(value as TryOnAnchor) ? (value as TryOnAnchor) : 'unspecified'
}

/**
 * The last path segment of a storage URL, used to show a readable name for an uploaded asset.
 * We never stored the original filename, so this is the closest true answer available.
 */
function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : url
  } catch {
    return url.split('/').filter(Boolean).pop() ?? url
  }
}

function toImage(url: string | null): ProductImage | null {
  if (!url) return null

  return {
    id: nameFromUrl(url),
    url,
    fileName: nameFromUrl(url),
    // Dimensions and byte size are not columns. Reporting null is honest; inventing a size so the
    // row looks complete would put a fabricated number in front of a seller.
    mimeType: null,
    sizeBytes: null,
    width: null,
    height: null,
    origin: 'storage',
    uploadedAt: null,
  }
}

/**
 * A product with no try-on asset returns **null**, not an asset of kind `'none'`.
 *
 * Both are valid in the domain and every consumer handles both, but null is the one that says what
 * is true: there is no asset. `hasUsableTryOnAsset` treats them identically, and `ProductForm`
 * substitutes an empty asset on edit, so the distinction costs nothing and means something.
 */
function toTryOnAsset(row: {
  try_on_asset_kind: string
  try_on_asset_url: string | null
  try_on_anchor: string
}): TryOnAsset | null {
  const kind = toTryOnKind(row.try_on_asset_kind)
  const url = row.try_on_asset_url

  if (kind === 'none' && !url) return null

  return {
    kind,
    url,
    fileName: url ? nameFromUrl(url) : null,
    mimeType: null,
    sizeBytes: null,
    anchor: toAnchor(row.try_on_anchor),
    origin: url ? 'storage' : 'demo-seed',
    uploadedAt: null,
  }
}

function toStore(row: StoreRow): Store {
  return {
    id: row.id,
    sellerId: row.owner_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    city: row.city,
    logoUrl: row.logo_url,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    whatsappNumber: row.whatsapp_number,
    currency: toCurrency(row.currency),
    onboardingCompleted: row.onboarding_completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * A store as a customer sees it. `sellerId` is null because the public view does not carry it —
 * see the note on `Store.sellerId`. `onboardingCompleted` is true because the view only returns
 * rows that are.
 */
function toPublicStore(row: PublicStoreRow): Store {
  return {
    id: row.id,
    sellerId: null,
    name: row.name,
    slug: row.slug,
    description: row.description,
    city: row.city,
    logoUrl: row.logo_url,
    contactEmail: null,
    contactPhone: null,
    whatsappNumber: row.whatsapp_number,
    currency: toCurrency(row.currency),
    onboardingCompleted: true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toProduct(row: ProductRow, sellerId: string | null): Product {
  return {
    id: row.id,
    sellerId,
    storeId: row.store_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    // A null price means a draft that never had one (the import path). The domain models price as a
    // number, and the manual form cannot produce a null, so zero is the only value that keeps the
    // rest of the app's arithmetic true.
    price: row.price === null ? 0 : Number(row.price),
    currency: toCurrency(row.currency),
    category: toCategory(row.category),
    status: row.status === 'published' ? 'published' : 'draft',
    image: toImage(row.product_image_url),
    tryOnAsset: toTryOnAsset(row),
    externalProductUrl: row.original_product_url,
    whatsappNumber: row.whatsapp_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  }
}

function toSeller(
  user: { id: string; email?: string | null; created_at: string; user_metadata?: unknown },
  profile: ProfileRow | null,
): Seller {
  const metadata = (user.user_metadata ?? {}) as { display_name?: unknown }
  const fromMetadata =
    typeof metadata.display_name === 'string' ? metadata.display_name.trim() : ''
  const fromProfile = profile?.display_name?.trim() ?? ''
  const email = user.email ?? ''

  return {
    id: user.id,
    email,
    // Three places a name can come from, in the order they become true: the profile row the signup
    // trigger wrote, the metadata it was given, then the email's local part. A seller still setting
    // up should never be greeted by a blank.
    displayName: fromProfile || fromMetadata || email.split('@')[0] || 'Seller',
    createdAt: profile?.created_at ?? user.created_at,
  }
}

/** Columns written on a product insert or update. Built once so both paths cannot drift. */
function toProductColumns(input: ProductInput, slug: string) {
  return {
    name: input.name.trim(),
    slug,
    description: input.description.trim(),
    price: Number.isFinite(input.price) ? input.price : 0,
    currency: input.currency,
    category: input.category,
    status: input.status,
    product_image_url: input.image?.url ?? null,
    try_on_asset_url: input.tryOnAsset?.url ?? null,
    try_on_asset_kind: input.tryOnAsset?.kind ?? 'none',
    try_on_anchor: input.tryOnAsset?.anchor ?? 'unspecified',
    original_product_url: input.externalProductUrl?.trim() || null,
    whatsapp_number: input.whatsappNumber?.trim() || null,
  }
}

/* ══ Analytics ═══════════════════════════════════════════════════════════════
   Real aggregation over `analytics_events`, which the public storefront writes and the owner may
   only read. There is no seed data: a store with no traffic reports zero, because a dashboard that
   invents a baseline is a dashboard nobody can make decisions from.
   ══════════════════════════════════════════════════════════════════════════ */

const EVENT_TO_TOTAL: Record<string, keyof AnalyticsTotals> = {
  store_visit: 'storeVisits',
  product_view: 'productViews',
  tryon_start: 'tryOnStarts',
  outbound_click: 'outboundClicks',
  contact_click: 'contactClicks',
}

function emptyTotals(): AnalyticsTotals {
  return {
    storeVisits: 0,
    productViews: 0,
    tryOnStarts: 0,
    outboundClicks: 0,
    contactClicks: 0,
  }
}

function isoDay(value: string): string {
  return value.slice(0, 10)
}

function aggregate(
  events: EventRow[],
  range: AnalyticsRange,
  now: Date,
): Pick<AnalyticsSummary, 'totals' | 'previousTotals' | 'series' | 'topProducts'> {
  const dayMs = 86_400_000
  const startOfRange = now.getTime() - range * dayMs
  const startOfPrevious = startOfRange - range * dayMs

  const totals = emptyTotals()
  const previousTotals = emptyTotals()

  // Every day in the window is present even when nothing happened, so a chart does not silently
  // drop its quiet days and draw a busier-looking line than the truth.
  const byDay = new Map<string, AnalyticsTotals>()
  for (let offset = range - 1; offset >= 0; offset -= 1) {
    const day = isoDay(new Date(now.getTime() - offset * dayMs).toISOString())
    byDay.set(day, emptyTotals())
  }

  const byProduct = new Map<string, AnalyticsTopProduct>()

  for (const event of events) {
    const field = EVENT_TO_TOTAL[event.event_type]
    const at = new Date(event.occurred_at).getTime()

    if (at >= startOfRange) {
      if (field) totals[field] += 1

      const bucket = byDay.get(isoDay(event.occurred_at))
      if (bucket && field) bucket[field] += 1

      if (event.product_id && (field === 'productViews' || field === 'tryOnStarts' || field === 'outboundClicks')) {
        const entry = byProduct.get(event.product_id) ?? {
          productId: event.product_id,
          name: '',
          views: 0,
          tryOnStarts: 0,
          outboundClicks: 0,
        }
        if (field === 'productViews') entry.views += 1
        if (field === 'tryOnStarts') entry.tryOnStarts += 1
        if (field === 'outboundClicks') entry.outboundClicks += 1
        byProduct.set(event.product_id, entry)
      }
    } else if (at >= startOfPrevious) {
      if (field) previousTotals[field] += 1
    }
  }

  const series: AnalyticsPoint[] = [...byDay.entries()].map(([date, point]) => ({
    date,
    ...point,
  }))

  return {
    totals,
    previousTotals,
    series,
    topProducts: [...byProduct.values()].sort(
      (a, b) => b.views + b.tryOnStarts - (a.views + a.tryOnStarts),
    ),
  }
}

/* ══ The adapter ═════════════════════════════════════════════════════════════ */

export function createSupabaseSellerService(): SellerService {
  /** `auth.uid()` for the current session, or null. Cached per call site, never across one. */
  async function currentUser() {
    const { data, error } = await supabase().auth.getUser()

    if (error) {
      /**
       * Being signed out is the ordinary starting state, not a failure — `SellerLayout` routes on a
       * null seller to decide where to send the visitor, and `landingPathFor` sends an anonymous one
       * to sign-in. Left unhandled, every seller route became a dead end for a signed-out visitor:
       * "Could not load your dashboard / Auth session missing!" beside a "Try again" button that
       * could only ever fail again.
       */
      if (isMissingSession(error)) return null

      // An expired or revoked token reads as signed out too.
      if (error.status === 401 || error.status === 403) return null

      throw toAuthError(error, 'Could not read the current session.')
    }

    return data.user ?? null
  }

  async function currentSeller(): Promise<Seller | null> {
    const user = await currentUser()
    if (!user) return null

    // RLS restricts this to the caller's own row, so no id filter is needed — and adding one would
    // imply the client gets to choose whose profile it reads.
    const { data: profile } = await supabase()
      .from('profiles')
      .select('id, display_name, created_at')
      .maybeSingle<ProfileRow>()

    return toSeller(user, profile ?? null)
  }

  /** The signed-in seller's store row, or null when they have not created one. */
  async function storeRow(): Promise<StoreRow | null> {
    const { data, error } = await supabase()
      .from('stores')
      .select('*')
      .maybeSingle<StoreRow>()

    if (error) throw toServiceError(error, 'Reading your store')
    return data ?? null
  }

  async function requireStoreRow(): Promise<StoreRow> {
    const row = await storeRow()
    if (!row) {
      throw new ServiceError('not_found', 'You do not have a store yet. Set one up first.')
    }
    return row
  }

  /** Reports a phase, and never a percentage the transport cannot support. See `UploadProgress`. */
  function reporter(options: UploadOptions | undefined) {
    return (phase: UploadProgress['phase']) => options?.onProgress?.({ phase, fraction: null })
  }

  function extensionFor(file: File): string {
    const fromName = file.name.includes('.') ? file.name.split('.').pop() : ''
    if (fromName && fromName.length <= 5) return fromName.toLowerCase()

    switch (file.type) {
      case 'image/jpeg':
        return 'jpg'
      case 'image/png':
        return 'png'
      case 'image/webp':
        return 'webp'
      case 'image/avif':
        return 'avif'
      case 'model/vnd.usdz+zip':
        return 'usdz'
      default:
        return 'bin'
    }
  }

  async function upload(
    bucket: string,
    folder: string,
    file: File,
    options: UploadOptions | undefined,
    context: string,
  ): Promise<{ url: string; path: string }> {
    const user = await currentUser()
    if (!user) throw new ServiceError('not_authorized', `${context} needs you to be signed in.`)

    const report = reporter(options)
    report('uploading')

    // The leading segment must be the auth user id or the storage policy rejects the write. The
    // second is a folder the caller owns — a product id, or a family like `store-logo` — so a
    // product's objects can be found and removed together.
    const path = `${user.id}/${folder}/${crypto.randomUUID()}.${extensionFor(file)}`

    const { error } = await supabase()
      .storage.from(bucket)
      .upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type || undefined })

    if (error) throw toServiceError(error, context)

    report('finishing')

    const { data } = supabase().storage.from(bucket).getPublicUrl(path)
    return { url: data.publicUrl, path }
  }

  /** What an `upload()` call hands a caller that is building a domain asset: the stored facts. */
  function storedFacts(file: File, url: string): StoredAsset {
    return {
      url,
      fileName: file.name,
      mimeType: file.type || null,
      sizeBytes: file.size,
      origin: 'storage',
      uploadedAt: new Date().toISOString(),
    }
  }

  /** Pulls `{ bucket, path }` back out of a public storage URL, so a delete can target the object. */
  function storageTarget(url: string): { bucket: string; path: string } | null {
    const marker = '/object/public/'
    const index = url.indexOf(marker)
    if (index === -1) return null

    const rest = url.slice(index + marker.length)
    const slash = rest.indexOf('/')
    if (slash === -1) return null

    return { bucket: rest.slice(0, slash), path: decodeURIComponent(rest.slice(slash + 1)) }
  }

  /**
   * Best-effort object removal. Never throws.
   *
   * An orphaned object costs a few kilobytes; a cleanup failure that propagated would fail a delete
   * or a save the seller has already been told succeeded — and they would have no way to act on it.
   */
  async function removeAsset(url: string): Promise<void> {
    const target = storageTarget(url)
    if (!target) return

    try {
      await supabase().storage.from(target.bucket).remove([target.path])
    } catch {
      // Swallowed on purpose. See above.
    }
  }

  return {
    mode: 'live' as const,

    capabilities: { auth: true, oauth: true, uploads: true, database: true },

    /* ── Session ─────────────────────────────────────────────────────────── */

    async getSession(): Promise<ServiceResult<Seller | null>> {
      return { data: await currentSeller(), dataSource: 'live' }
    },

    async signUp(input: SignUpInput): Promise<ServiceResult<SignUpOutcome>> {
      const email = input.email.trim()

      const { data, error } = await supabase().auth.signUp({
        email,
        password: input.password ?? '',
        options: {
          // Read by `handle_new_user()` to pre-fill the profile row. It is the seller's own claim
          // about their own name — it grants nothing.
          data: input.displayName ? { display_name: input.displayName.trim() } : undefined,
        },
      })

      if (error) throw toAuthError(error, 'That account could not be created.')

      // No session means the project requires email confirmation. Not a failure — a different next
      // step — so it is reported as a status the caller must handle rather than thrown.
      if (!data.session || !data.user) {
        return {
          data: {
            status: 'confirmation-required',
            seller: null,
            message: `Check ${email} for a confirmation link, then sign in.`,
          },
          dataSource: 'live',
        }
      }

      const seller = await currentSeller()

      return {
        data: {
          status: 'active',
          seller,
          message: 'Account created.',
        },
        dataSource: 'live',
      }
    },

    async signIn(input: SignInInput): Promise<ServiceResult<Seller>> {
      if (!input.password) {
        throw new ServiceError('validation', 'Enter your password.')
      }

      const { error } = await supabase().auth.signInWithPassword({
        email: input.email.trim(),
        password: input.password,
      })

      if (error) throw toAuthError(error, 'Sign-in failed. Try again.')

      const seller = await currentSeller()
      if (!seller) {
        // The credential was accepted but the profile could not be read. Rather than fabricate one,
        // say what happened: the account exists, this build could not finish opening it.
        throw new ServiceError(
          'unknown',
          'Signed in, but your seller profile could not be loaded. Try again in a moment.',
        )
      }

      return { data: seller, dataSource: 'live' }
    },

    /**
     * Hands the browser to the provider and never comes back.
     *
     * `signInWithOAuth` resolves once Supabase has minted the authorize URL and, with the default
     * `skipBrowserRedirect: false`, has already set `window.location`. So the success path ends the
     * page's life; what this awaits is only the failure path — a provider that is not enabled on the
     * project, or a request that could not be made. Any line after a successful call would be
     * unreachable, which is why this returns `void` and not a session.
     *
     * `prompt: 'select_account'` is asked of Google specifically. Without it, a browser already
     * signed into one Google account silently reuses it, and a seller who shares a machine has no
     * way to reach their own — the consent screen never appears to offer the choice.
     *
     * The PKCE verifier `createClient` stores is what makes the return trip work; it is read back on
     * whichever page the redirect lands on, which is why that page is the sign-in screen and not the
     * dashboard. See `oauthRedirectUrl`.
     */
    async signInWithOAuth(provider: OAuthProvider): Promise<void> {
      const { error } = await supabase().auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: oauthRedirectUrl(),
          ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
        },
      })

      if (error) throw toAuthError(error, 'That sign-in could not be started. Try again.')
    },

    async signOut(): Promise<void> {
      const { error } = await supabase().auth.signOut()
      if (error) throw toAuthError(error, 'Sign-out failed.')
    },

    onAuthStateChange(listener: AuthStateListener): () => void {
      const { data } = supabase().auth.onAuthStateChange((_event, session) => {
        // Called synchronously from inside the auth library's own lock, so no `await` here: a
        // Supabase call made from this callback can deadlock against the refresh it is reporting.
        // `getUser()`'s user is enough for the shape the app needs, and the profile is re-read by
        // whichever screen reacts.
        const user = session?.user
        if (!user) {
          listener(null)
          return
        }

        const metadata = (user.user_metadata ?? {}) as { display_name?: unknown }
        listener({
          id: user.id,
          email: user.email ?? '',
          displayName:
            (typeof metadata.display_name === 'string' ? metadata.display_name.trim() : '') ||
            (user.email ?? '').split('@')[0] ||
            'Seller',
          createdAt: user.created_at,
        })
      })

      return () => data.subscription.unsubscribe()
    },

    /* ── Store ───────────────────────────────────────────────────────────── */

    async getStore(): Promise<ServiceResult<Store | null>> {
      const row = await storeRow()
      return { data: row ? toStore(row) : null, dataSource: 'live' }
    },

    async createStore(input: StoreSetupInput): Promise<MutationResult<Store>> {
      const name = input.name.trim()
      if (!name) throw new ServiceError('validation', 'Your store needs a name.')

      const seller = await currentSeller()
      if (!seller) throw new ServiceError('not_authorized', 'Sign in to create your store.')

      const existing = await storeRow()

      // Retry safety. A first attempt that reached the database but whose response was lost leaves a
      // row behind; a blind second INSERT would fail on `stores_one_per_owner_idx` and strand the
      // seller on a form whose contents are already saved. Updating the row we already have is the
      // same outcome the first attempt was trying to reach.
      if (existing) {
        const { data, error } = await supabase()
          .from('stores')
          .update({
            name,
            city: input.city?.trim() || null,
            logo_url: input.logoUrl,
            whatsapp_number: input.whatsappNumber?.trim() || null,
          })
          .eq('id', existing.id)
          .select('*')
          .single<StoreRow>()

        if (error) throw toServiceError(error, 'Saving your store')
        return { data: toStore(data), dataSource: 'live', persistence: 'database' }
      }

      const base = slugify(name) || 'store'

      // The onboarding form asks for a name, not a URL, so a taken slug must not dead-end the flow.
      // Suffixing keeps the seller moving and leaves the address editable on the store screen, where
      // changing it is explained. Reserved words are skipped for the same reason: `/s/seller` is not
      // a store, whatever the seller is called.
      const candidates = [base, ...Array.from({ length: 4 }, (_, index) => `${base}-${index + 2}`)]
        .filter((slug) => !isReservedSlug(slug))

      if (candidates.length === 0) {
        throw new ServiceError(
          'conflict',
          'That name maps to an address we reserve. Pick a slightly different store name.',
        )
      }

      let lastError: ServiceError | null = null

      for (const slug of candidates) {
        const { data, error } = await supabase()
          .from('stores')
          .insert({
            name,
            slug,
            city: input.city?.trim() || null,
            logo_url: input.logoUrl,
            whatsapp_number: input.whatsappNumber?.trim() || null,
            contact_email: seller.email || null,
            // Set on the last onboarding step, not here: until then the store is resumable and
            // invisible to customers.
            onboarding_completed: false,
          })
          .select('*')
          .single<StoreRow>()

        if (!error) {
          return { data: toStore(data), dataSource: 'live', persistence: 'database' }
        }

        const translated = toServiceError(error, 'Creating your store')
        // Only a slug clash is worth retrying. Anything else — a policy denial, a bad value — will
        // fail identically for every candidate, and retrying just delays the error.
        if (translated.code !== 'conflict') throw translated
        lastError = translated
      }

      throw (
        lastError ??
        new ServiceError('conflict', 'That store address is taken. Try a different store name.')
      )
    },

    async completeOnboarding(): Promise<MutationResult<Store>> {
      const row = await requireStoreRow()

      const { data, error } = await supabase()
        .from('stores')
        .update({ onboarding_completed: true })
        .eq('id', row.id)
        .select('*')
        .single<StoreRow>()

      if (error) throw toServiceError(error, 'Finishing setup')
      return { data: toStore(data), dataSource: 'live', persistence: 'database' }
    },

    async isSlugAvailable(slug: string): Promise<boolean> {
      const candidate = slugify(slug)
      if (!candidate || isReservedSlug(candidate)) return false

      // Asked of the database, not of a local list: only the database can see every store,
      // including the half-built ones that are not yet publicly readable.
      const { data, error } = await supabase().rpc('slug_available', { candidate })
      if (error) throw toServiceError(error, 'Checking that address')

      return data === true
    },

    async updateStore(input: StoreInput): Promise<MutationResult<Store>> {
      const row = await requireStoreRow()
      const slug = slugify(input.slug)

      if (!slug) throw new ServiceError('validation', 'Your store needs a web address.')
      if (isReservedSlug(slug)) {
        throw new ServiceError('conflict', `“${slug}” is reserved and cannot be used as a store address.`)
      }

      const { data, error } = await supabase()
        .from('stores')
        .update({
          name: input.name.trim(),
          slug,
          description: input.description.trim(),
          city: input.city?.trim() || null,
          logo_url: input.logoUrl,
          contact_email: input.contactEmail?.trim() || null,
          contact_phone: input.contactPhone?.trim() || null,
          whatsapp_number: input.whatsappNumber?.trim() || null,
          currency: input.currency,
        })
        .eq('id', row.id)
        .select('*')
        .single<StoreRow>()

      if (error) {
        const translated = toServiceError(error, 'Saving your store')
        if (translated.code === 'conflict') {
          throw new ServiceError(
            'conflict',
            `The address /s/${slug} is already taken. Try another.`,
          )
        }
        throw translated
      }

      return { data: toStore(data), dataSource: 'live', persistence: 'database' }
    },

    /* ── Products ────────────────────────────────────────────────────────── */

    async listProducts(query: ProductQuery = {}): Promise<ServiceResult<Product[]>> {
      const store = await requireStoreRow()

      let request = supabase().from('products').select('*').eq('store_id', store.id)

      // Category and status are filtered in SQL — they are indexed single-column equalities and
      // pushing them down is free. Search is not: the app's search spans the category *label* and
      // the price as text, which SQL cannot reproduce without duplicating `matchesQuery` in another
      // language. Filtering it client-side keeps one definition of what a search means.
      if (query.category && query.category !== 'all') request = request.eq('category', query.category)
      if (query.status && query.status !== 'all') request = request.eq('status', query.status)

      const { data, error } = await request
        .order('updated_at', { ascending: false })
        .returns<ProductRow[]>()

      if (error) throw toServiceError(error, 'Loading your products')

      const products = (data ?? []).map((row) => toProduct(row, store.owner_id))

      const search = query.search?.trim().toLowerCase()
      if (!search) return { data: products, dataSource: 'live' }

      return { data: products.filter((product) => matchesQuery(product, { search })), dataSource: 'live' }
    },

    async getProduct(productId: string): Promise<ServiceResult<Product | null>> {
      const { data, error } = await supabase()
        .from('products')
        .select('*')
        .eq('id', productId)
        .maybeSingle<ProductRow>()

      // RLS is what makes this safe: another seller's product id returns no row rather than a row.
      if (error) throw toServiceError(error, 'Loading that product')
      if (!data) return { data: null, dataSource: 'live' }

      const store = await storeRow()
      return { data: toProduct(data, store?.owner_id ?? null), dataSource: 'live' }
    },

    async createProduct(input: ProductInput): Promise<MutationResult<Product>> {
      const store = await requireStoreRow()
      const seller = await currentSeller()

      const { data: siblings } = await supabase()
        .from('products')
        .select('slug')
        .eq('store_id', store.id)
        .returns<{ slug: string }[]>()

      // Slug uniqueness is per store in the schema; de-duplicating here means a second "gold-jhumka"
      // becomes "gold-jhumka-2" instead of a 23505 the seller cannot act on.
      const slug = uniqueProductSlug(slugify(input.name) || 'product', siblings ?? [])

      const { data, error } = await supabase()
        .from('products')
        .insert({ ...toProductColumns(input, slug), store_id: store.id })
        .select('*')
        .single<ProductRow>()

      if (error) throw toServiceError(error, 'Creating that product')

      return {
        data: toProduct(data, seller?.id ?? store.owner_id),
        dataSource: 'live',
        persistence: 'database',
      }
    },

    async updateProduct(productId: string, input: ProductInput): Promise<MutationResult<Product>> {
      const store = await requireStoreRow()

      const { data: current, error: readError } = await supabase()
        .from('products')
        .select('slug')
        .eq('id', productId)
        .maybeSingle<{ slug: string }>()

      if (readError) throw toServiceError(readError, 'Loading that product')
      if (!current) {
        throw new ServiceError('not_found', 'That product no longer exists. It may have been deleted.')
      }

      // The slug is only re-derived when the name actually changed, so editing a description never
      // silently moves a URL a customer may have bookmarked.
      const renamed = slugify(input.name) !== '' && slugify(input.name) !== current.slug
      let slug = current.slug

      if (renamed) {
        const { data: siblings } = await supabase()
          .from('products')
          .select('slug')
          .eq('store_id', store.id)
          .neq('id', productId)
          .returns<{ slug: string }[]>()

        slug = uniqueProductSlug(slugify(input.name), siblings ?? [])
      }

      const { data, error } = await supabase()
        .from('products')
        .update(toProductColumns(input, slug))
        .eq('id', productId)
        .select('*')
        .single<ProductRow>()

      if (error) throw toServiceError(error, 'Saving that product')

      return {
        data: toProduct(data, store.owner_id),
        dataSource: 'live',
        persistence: 'database',
      }
    },

    async deleteProduct(productId: string): Promise<MutationResult<{ id: string }>> {
      // Read the asset URLs first: once the row is gone nothing records where its bytes live, and
      // the objects would sit in the bucket forever with no way to find them again.
      const { data: doomed } = await supabase()
        .from('products')
        .select('product_image_url, try_on_asset_url')
        .eq('id', productId)
        .maybeSingle<Pick<ProductRow, 'product_image_url' | 'try_on_asset_url'>>()

      const { error } = await supabase().from('products').delete().eq('id', productId)
      if (error) throw toServiceError(error, 'Deleting that product')

      // Cleanup runs after the delete and after the row is already gone. `removeAsset` never throws,
      // so a storage failure here cannot resurrect a deleted product or turn a successful delete
      // into an error the seller has to interpret.
      const assets = [doomed?.product_image_url, doomed?.try_on_asset_url].filter(
        (url): url is string => Boolean(url),
      )
      await Promise.all(assets.map(removeAsset))

      return { data: { id: productId }, dataSource: 'live', persistence: 'database' }
    },

    /* ── Uploads ─────────────────────────────────────────────────────────── */

    async uploadProductImage(
      file: File,
      options?: UploadOptions,
    ): Promise<MutationResult<ProductImage>> {
      const invalid = validateImageFile(file)
      if (invalid) throw new ServiceError('validation', invalid)

      const { url } = await upload(
        BUCKET_IMAGES,
        options?.productId ?? 'unassigned',
        file,
        options,
        'Uploading that image',
      )

      return {
        data: {
          // Generated rather than taken from `file.name`: the id is a React key and the identity
          // the form compares to decide whether the picture changed. A file name is reusable across
          // two different uploads of the same product, which would make the second look unchanged.
          id: createId('img'),
          width: null,
          height: null,
          ...storedFacts(file, url),
        },
        dataSource: 'live',
        persistence: 'database',
      }
    },

    async uploadTryOnAsset(
      file: File,
      options?: UploadOptions,
    ): Promise<MutationResult<StoredTryOnAsset>> {
      // Models are accepted by extension too, because browsers report `.glb` as `application/octet-stream`
      // or as an empty type depending on the OS. The size limits in `lib/files` are aligned with the
      // bucket's own `file_size_limit`, so a file that passes here is not going to be refused later.
      const isModel = /\.(glb|usdz)$/i.test(file.name)
      const invalid = isModel ? validateModelFile(file) : validateImageFile(file)
      if (invalid) throw new ServiceError('validation', invalid)

      const { url } = await upload(
        BUCKET_TRYON,
        options?.productId ?? 'unassigned',
        file,
        options,
        'Uploading that try-on asset',
      )

      const kind: TryOnAssetKind = /\.usdz$/i.test(file.name) ? 'usdz' : isModel ? 'glb' : 'image'

      return {
        data: {
          kind,
          // The form re-applies the seller's chosen anchor when they save; this is only the default
          // for a freshly uploaded file.
          anchor: 'unspecified',
          ...storedFacts(file, url),
        },
        dataSource: 'live',
        persistence: 'database',
      }
    },

    async uploadStoreLogo(
      file: File,
      options?: UploadOptions,
    ): Promise<MutationResult<StoredAsset>> {
      const invalid = validateImageFile(file)
      if (invalid) throw new ServiceError('validation', invalid)

      const { url } = await upload(BUCKET_LOGOS, LOGO_FOLDER, file, options, 'Uploading that logo')

      return {
        data: storedFacts(file, url),
        dataSource: 'live',
        persistence: 'database',
      }
    },

    async deleteUploadedAsset(url: string): Promise<void> {
      await removeAsset(url)
    },

    /* ── Activity and analytics ──────────────────────────────────────────── */

    /**
     * There is no activity table, and this does not pretend there is one.
     *
     * Every entry below is reconstructed from a real timestamp column — `created_at`,
     * `published_at`, `updated_at` — so the feed says what actually happened and when. It cannot
     * say *who* changed something or what the old value was, because nothing records that, and it
     * does not imply otherwise.
     */
    async listActivity(limit = 8): Promise<ServiceResult<ActivityEvent[]>> {
      const store = await storeRow()
      if (!store) return { data: [], dataSource: 'live' }

      const { data, error } = await supabase()
        .from('products')
        .select('id, name, status, created_at, updated_at, published_at')
        .eq('store_id', store.id)
        .order('updated_at', { ascending: false })
        .limit(60)
        .returns<
          Pick<ProductRow, 'id' | 'name' | 'status' | 'created_at' | 'updated_at' | 'published_at'>[]
        >()

      if (error) throw toServiceError(error, 'Loading recent activity')

      const events: ActivityEvent[] = []

      for (const row of data ?? []) {
        events.push({
          id: `${row.id}:created`,
          type: 'product_created',
          message: `Created “${row.name}”`,
          productId: row.id,
          productName: row.name,
          at: row.created_at,
        })

        if (row.status === 'published' && row.published_at) {
          events.push({
            id: `${row.id}:published`,
            type: 'product_published',
            message: `Published “${row.name}”`,
            productId: row.id,
            productName: row.name,
            at: row.published_at,
          })
        } else if (new Date(row.updated_at).getTime() > new Date(row.created_at).getTime() + 1000) {
          // A one-second grace, because an insert and its own trigger can differ by milliseconds and
          // reporting "Created" and "Updated" for the same instant would be noise.
          events.push({
            id: `${row.id}:updated`,
            type: 'product_updated',
            message: `Updated “${row.name}”`,
            productId: row.id,
            productName: row.name,
            at: row.updated_at,
          })
        }
      }

      if (new Date(store.updated_at).getTime() > new Date(store.created_at).getTime() + 1000) {
        events.push({
          id: `${store.id}:store`,
          type: 'store_updated',
          message: 'Updated store settings',
          productId: null,
          productName: null,
          at: store.updated_at,
        })
      }

      events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      return { data: events.slice(0, limit), dataSource: 'live' }
    },

    async getAnalytics(range: AnalyticsRange): Promise<ServiceResult<AnalyticsSummary>> {
      const store = await storeRow()
      const now = new Date()

      const empty: AnalyticsSummary = {
        range,
        dataSource: 'live',
        generatedAt: now.toISOString(),
        totals: emptyTotals(),
        previousTotals: emptyTotals(),
        series: [],
        topProducts: [],
      }

      if (!store) return { data: empty, dataSource: 'live' }

      // Two windows in one query: the range plus the one before it, which is what the deltas need.
      const since = new Date(now.getTime() - range * 2 * 86_400_000).toISOString()

      const { data, error } = await supabase()
        .from('analytics_events')
        .select('event_type, product_id, occurred_at')
        .eq('store_id', store.id)
        .gte('occurred_at', since)
        .returns<EventRow[]>()

      if (error) throw toServiceError(error, 'Loading analytics')
      if (!data || data.length === 0) {
        return { data: { ...empty, ...aggregate([], range, now) }, dataSource: 'live' }
      }

      // Names for the top-products table come from the catalogue, not from the event, which only
      // stores an id — and a product deleted since its views were recorded simply drops out.
      const names = new Map<string, string>()
      const { data: products } = await supabase()
        .from('products')
        .select('id, name')
        .eq('store_id', store.id)
        .returns<{ id: string; name: string }[]>()

      for (const product of products ?? []) names.set(product.id, product.name)

      const aggregated = aggregate(data, range, now)

      return {
        data: {
          ...empty,
          ...aggregated,
          topProducts: aggregated.topProducts
            .filter((entry) => names.has(entry.productId))
            .map((entry) => ({ ...entry, name: names.get(entry.productId) ?? '' }))
            .slice(0, 5),
        },
        dataSource: 'live',
      }
    },

    /* ── Public storefront ───────────────────────────────────────────────── */

    async getStorefront(
      storeSlug: string,
      options: { includeDrafts?: boolean } = {},
    ): Promise<ServiceResult<StorefrontView | null>> {
      const slug = slugify(storeSlug)
      if (!slug) return { data: null, dataSource: 'live' }

      // The owner path reads the base tables. RLS scopes that read to the caller's own store, so a
      // seller asking for someone else's slug with `includeDrafts` gets nothing and falls through to
      // the public view below — the refusal is the database's, not a check this code could get wrong.
      if (options.includeDrafts) {
        const { data: own } = await supabase()
          .from('stores')
          .select('*')
          .eq('slug', slug)
          .maybeSingle<StoreRow>()

        if (own) {
          const { data: products, error } = await supabase()
            .from('products')
            .select('*')
            .eq('store_id', own.id)
            .order('updated_at', { ascending: false })
            .returns<ProductRow[]>()

          if (error) throw toServiceError(error, 'Loading your storefront preview')

          return {
            data: {
              store: toStore(own),
              products: (products ?? []).map((row) => toProduct(row, own.owner_id)),
              viewer: 'owner',
            },
            dataSource: 'live',
          }
        }
      }

      const { data: store, error: storeError } = await supabase()
        .from('storefront_stores')
        .select('*')
        .eq('slug', slug)
        .maybeSingle<PublicStoreRow>()

      if (storeError) throw toServiceError(storeError, 'Loading that storefront')
      if (!store) return { data: null, dataSource: 'live' }

      const { data: products, error: productError } = await supabase()
        .from('storefront_products')
        .select('*')
        .eq('store_id', store.id)
        .returns<ProductRow[]>()

      if (productError) throw toServiceError(productError, 'Loading that storefront')

      return {
        data: {
          store: toPublicStore(store),
          // Published only — the view filters, and sorting newest-first matches what the dashboard's
          // own "created" ordering promises a seller their customers see.
          products: sortByCreatedDesc((products ?? []).map((row) => toProduct(row, null))),
          viewer: 'public',
        },
        dataSource: 'live',
      }
    },

    async getPublicProduct(
      storeSlug: string,
      productId: string,
    ): Promise<ServiceResult<ProductView | null>> {
      const slug = slugify(storeSlug)
      if (!slug) return { data: null, dataSource: 'live' }

      const { data: store, error: storeError } = await supabase()
        .from('storefront_stores')
        .select('*')
        .eq('slug', slug)
        .maybeSingle<PublicStoreRow>()

      if (storeError) throw toServiceError(storeError, 'Loading that product')
      if (!store) return { data: null, dataSource: 'live' }

      const { data: product, error } = await supabase()
        .from('storefront_products')
        .select('*')
        .eq('id', productId)
        .eq('store_id', store.id)
        .maybeSingle<ProductRow>()

      if (error) throw toServiceError(error, 'Loading that product')
      // A draft is "not found" to a customer, and the view is why — it never returns one.
      if (!product) return { data: null, dataSource: 'live' }

      return { data: { store: toPublicStore(store), product: toProduct(product, null) }, dataSource: 'live' }
    },

    async resolveProduct(productId: string): Promise<ServiceResult<ProductView | null>> {
      const { data: product, error } = await supabase()
        .from('storefront_products')
        .select('*')
        .eq('id', productId)
        .maybeSingle<ProductRow>()

      if (error) throw toServiceError(error, 'Resolving that link')
      if (!product) return { data: null, dataSource: 'live' }

      const { data: store, error: storeError } = await supabase()
        .from('storefront_stores')
        .select('*')
        .eq('id', product.store_id)
        .maybeSingle<PublicStoreRow>()

      if (storeError) throw toServiceError(storeError, 'Resolving that link')
      if (!store) return { data: null, dataSource: 'live' }

      return { data: { store: toPublicStore(store), product: toProduct(product, null) }, dataSource: 'live' }
    },
  }
}
