/**
 * ╔══════════════════════════════════════════════════════════════════════════════════════════╗
 * ║  MOCK ADAPTER — the dashboard's development fallback.                                     ║
 * ║                                                                                          ║
 * ║  Reads come from a browser-local demo database (mockDb.ts). Writes mutate that database   ║
 * ║  and are mirrored into localStorage — they are NOT database writes, and every             ║
 * ║  MutationResult says so via `persistence: 'browser-local'`.                               ║
 * ║                                                                                          ║
 * ║  Operations a browser cannot honestly fake (real auth, storage uploads, analytics         ║
 * ║  ingestion) throw NotImplementedInDemoError rather than returning plausible nonsense.     ║
 * ╚══════════════════════════════════════════════════════════════════════════════════════════╝
 */

import { isReservedSlug, slugify } from '@/lib/catalog'
import { createId, ID_PREFIXES } from '@/lib/id'
import { NotImplementedInDemoError, OAUTH_PROVIDER_LABELS } from '../types/seller'
import type {
  ActivityEvent,
  ActivityType,
  AnalyticsRange,
  AnalyticsSummary,
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
  UploadOptions,
} from '../types/seller'
import { ServiceError } from '../types/seller'
import {
  hasUsableTryOnAsset,
  matchesQuery,
  sortByCreatedDesc,
  sortByUpdatedDesc,
  uniqueProductSlug,
} from '../utils/product'
import { buildDemoAnalytics } from './mockAnalytics'
import { commit, loadDatabase, resetDatabase, type DemoDatabase } from './mockDb'

/**
 * A short artificial delay so loading and skeleton states behave like they will against a network
 * backend. Without it the UI would never exercise its own async paths.
 */
const LATENCY_MS = { min: 110, max: 260 }

function delay(): Promise<void> {
  const ms = LATENCY_MS.min + Math.random() * (LATENCY_MS.max - LATENCY_MS.min)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function demo<T>(data: T): ServiceResult<T> {
  return { data, dataSource: 'demo' }
}

function mutation<T>(data: T, warning?: string): MutationResult<T> {
  return {
    data,
    dataSource: 'demo',
    persistence: 'browser-local',
    ...(warning ? { warning } : {}),
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function requireSession(db: DemoDatabase): void {
  if (!db.signedIn) {
    throw new ServiceError('validation', 'Sign in to manage your store.')
  }
}

function recordActivity(
  db: DemoDatabase,
  type: ActivityType,
  message: string,
  product: Product | null,
): void {
  // Newest first, and bounded so the demo store cannot grow without limit.
  db.activity = [
    {
      id: createId(ID_PREFIXES.activity),
      type,
      message,
      productId: product?.id ?? null,
      productName: product?.name ?? null,
      at: new Date().toISOString(),
    },
    ...db.activity,
  ].slice(0, 40)
}

function toStorefront(db: DemoDatabase, includeDrafts: boolean): StorefrontView {
  const products = includeDrafts
    ? db.products
    : db.products.filter((product) => product.status === 'published')

  return {
    store: db.store,
    products: includeDrafts ? sortByUpdatedDesc(products) : sortByCreatedDesc(products),
    viewer: includeDrafts ? 'owner' : 'public',
  }
}

function findProduct(db: DemoDatabase, productId: string): Product | undefined {
  return db.products.find((product) => product.id === productId)
}

/** Applies a form payload onto an existing product, producing the next stored version. */
function applyInput(db: DemoDatabase, existing: Product, input: ProductInput): Product {
  const now = new Date().toISOString()
  const isPublishing = input.status === 'published'
  const wasPublished = existing.status === 'published'

  return {
    ...existing,
    name: input.name.trim(),
    slug: uniqueProductSlug(
      slugify(input.name) || existing.slug,
      db.products,
      existing.id,
    ),
    description: input.description.trim(),
    price: input.price,
    currency: input.currency,
    category: input.category,
    status: input.status,
    image: input.image ? { ...input.image } : null,
    tryOnAsset: input.tryOnAsset ? { ...input.tryOnAsset } : null,
    externalProductUrl: input.externalProductUrl?.trim() || null,
    whatsappNumber: input.whatsappNumber?.trim() || null,
    updatedAt: now,
    publishedAt: isPublishing ? (wasPublished ? existing.publishedAt : now) : null,
  }
}

export function createMockSellerService() {
  return {
    mode: 'demo' as const,

    /**
     * Nothing here is backed by a service: there is no auth to verify a credential against, no
     * object storage, and no database. Saying so is the whole point — the sign-in screen renders a
     * password field only when `auth` is true, so demo mode is never asked for one it cannot check.
     */
    capabilities: { auth: false, oauth: false, uploads: false, database: false },

    /* ── Session ─────────────────────────────────────────────────────────── */

    async getSession(): Promise<ServiceResult<Seller | null>> {
      await delay()
      const db = loadDatabase()
      return demo(db.signedIn ? clone(db.seller) : null)
    },

    /**
     * Creates a local "account" by opening the demo session. No credential is stored or checked,
     * and the returned status is always `active` because there is no mail to confirm.
     */
    async signUp(input: SignUpInput): Promise<ServiceResult<SignUpOutcome>> {
      await delay()
      const email = input.email.trim()

      commit((db) => {
        db.signedIn = true
        if (email) db.seller = { ...db.seller, email }
        if (input.displayName?.trim()) {
          db.seller = { ...db.seller, displayName: input.displayName.trim() }
        }
      })

      return demo<SignUpOutcome>({
        status: 'active',
        seller: clone(loadDatabase().seller),
        message: 'Demo account ready. Nothing was sent to that address.',
      })
    },

    async signIn(input: SignInInput): Promise<ServiceResult<Seller>> {
      await delay()
      commit((db) => {
        db.signedIn = true
        // The email is the only identity a browser-local store can honestly hold: it is what the
        // seller typed, echoed back so the dashboard can greet them by it. The password is ignored
        // rather than stored — there is no auth service to check it against, and keeping one would
        // imply otherwise.
        const next = input.email.trim()
        if (next) db.seller = { ...db.seller, email: next }
      })
      return demo(clone(loadDatabase().seller))
    },

    async signOut(): Promise<void> {
      await delay()
      commit((db) => {
        db.signedIn = false
      })
    },

    /**
     * Refused, not faked.
     *
     * A provider sign-in needs a real identity behind it. There is nowhere to redirect to and
     * nothing to come back with, so opening the demo session here would hand the seller a dashboard
     * that looks signed in by Google and is not. It throws the same error the other unbacked
     * operations throw, and `capabilities.oauth` is false so the button is never rendered anyway —
     * this is the second line of defence, for a caller that ignored the flag.
     */
    async signInWithOAuth(provider: OAuthProvider): Promise<void> {
      await delay()
      throw new NotImplementedInDemoError(
        `Signing in with ${OAUTH_PROVIDER_LABELS[provider]}`,
        'It needs a provider configured on a real auth service.',
      )
    },

    /**
     * No auth service means no auth events: nothing can sign this session out from another tab,
     * and no token can expire. Returns an unsubscribe that does nothing rather than inventing
     * callbacks the app would then wait for.
     */
    onAuthStateChange(_listener: AuthStateListener): () => void {
      return () => {}
    },

    /* ── Store ───────────────────────────────────────────────────────────── */

    /**
     * Never null in demo mode, and that is not a simplification — the seeded demo store always
     * exists, which is what makes the demo dashboard show a populated shop.
     */
    async getStore(): Promise<ServiceResult<Store | null>> {
      await delay()
      return demo<Store | null>(clone(loadDatabase().store))
    },

    /**
     * The guided flow already walks the store's `onboardingCompleted` flag on to true, because a
     * browser-local store has no second step that can fail. Reporting the write as browser-local
     * keeps the demo honest about where it landed.
     */
    async completeOnboarding(): Promise<MutationResult<Store>> {
      await delay()

      let updated: Store = loadDatabase().store

      const outcome = commit((draft) => {
        draft.store = { ...draft.store, onboardingCompleted: true, updatedAt: new Date().toISOString() }
        updated = draft.store
      })

      return mutation(clone(updated), outcome.warning)
    },

    async isSlugAvailable(slug: string): Promise<boolean> {
      const candidate = slugify(slug)
      if (!candidate) return false

      // Reserved addresses are the only thing a single-store demo can genuinely check. Uniqueness
      // across *other* sellers' stores is a database constraint (arch.md §7.2) and cannot be
      // verified from a browser — the store form says so next to the field.
      return !isReservedSlug(candidate)
    },

    async updateStore(input: StoreInput): Promise<MutationResult<Store>> {
      await delay()
      const db = loadDatabase()
      requireSession(db)

      let updated: Store = db.store

      const outcome = commit((draft) => {
        draft.store = {
          ...draft.store,
          name: input.name.trim(),
          slug: slugify(input.slug),
          description: input.description.trim(),
          city: input.city?.trim() || null,
          logoUrl: input.logoUrl,
          contactEmail: input.contactEmail?.trim() || null,
          contactPhone: input.contactPhone?.trim() || null,
          whatsappNumber: input.whatsappNumber?.trim() || null,
          currency: input.currency,
          updatedAt: new Date().toISOString(),
        }
        updated = draft.store
        recordActivity(draft, 'store_updated', 'Updated store settings', null)
      })

      return mutation(clone(updated), outcome.warning)
    },

    /**
     * Creates the seller's store from the guided first-run flow, and opens the session.
     *
     * This **replaces** the seeded demonstration catalogue rather than adding to it. A seller who has
     * just typed their own store name and is told they already have six products they never
     * photographed would be reading someone else's inventory. The seed remains available through the
     * explicit "continue as demo seller" route on the sign-in screen; this path is a genuine
     * empty start, which is what makes the first-run screen ("add your first product") true.
     *
     * Fields the guided flow does not ask for are defaulted, not left blank: a store with no currency
     * cannot price anything, and `slugify` of the name is a better public URL than an empty one.
     */
    async createStore(input: StoreSetupInput): Promise<MutationResult<Store>> {
      await delay()
      const db = loadDatabase()

      const name = input.name.trim()
      if (!name) {
        throw new ServiceError('validation', 'Your store needs a name.')
      }

      const now = new Date().toISOString()
      let created: Store = db.store

      const outcome = commit((draft) => {
        const slug = slugify(name) || `store-${draft.store.id.slice(-6)}`

        draft.store = {
          ...draft.store,
          name,
          slug,
          description: '',
          city: input.city?.trim() || null,
          logoUrl: input.logoUrl,
          contactEmail: draft.seller.email || null,
          contactPhone: null,
          whatsappNumber: input.whatsappNumber?.trim() || null,
          currency: draft.store.currency,
          // Starts false, matching the live adapter. The demo runs the same resume logic as the real
          // thing, so the redirect a seller meets here is the one they meet in production.
          onboardingCompleted: false,
          createdAt: now,
          updatedAt: now,
        }
        // A brand-new store has no catalogue and no history.
        draft.products = []
        draft.activity = []
        draft.signedIn = true

        created = draft.store
      })

      return mutation(clone(created), outcome.warning)
    },

    /* ── Products ────────────────────────────────────────────────────────── */

    async listProducts(query: ProductQuery = {}): Promise<ServiceResult<Product[]>> {
      await delay()
      const db = loadDatabase()
      const filtered = db.products.filter((product) => matchesQuery(product, query))
      return demo(sortByUpdatedDesc(clone(filtered)))
    },

    async getProduct(productId: string): Promise<ServiceResult<Product | null>> {
      await delay()
      const product = findProduct(loadDatabase(), productId)
      return demo(product ? clone(product) : null)
    },

    async createProduct(input: ProductInput): Promise<MutationResult<Product>> {
      await delay()
      const db = loadDatabase()
      requireSession(db)

      const now = new Date().toISOString()
      // The id is minted here so the response can reference the created row before it is stored.
      const created: Product = {
        id: createId(ID_PREFIXES.product),
        sellerId: db.seller.id,
        storeId: db.store.id,
        name: input.name.trim(),
        slug: uniqueProductSlug(slugify(input.name) || 'product', db.products),
        description: input.description.trim(),
        price: input.price,
        currency: input.currency,
        category: input.category,
        status: input.status,
        image: input.image ? { ...input.image } : null,
        tryOnAsset: input.tryOnAsset ? { ...input.tryOnAsset } : null,
        externalProductUrl: input.externalProductUrl?.trim() || null,
        whatsappNumber: input.whatsappNumber?.trim() || null,
        createdAt: now,
        updatedAt: now,
        publishedAt: input.status === 'published' ? now : null,
      }

      const outcome = commit((draft) => {
        draft.products = [created, ...draft.products]
        recordActivity(
          draft,
          input.status === 'published' ? 'product_published' : 'product_created',
          input.status === 'published'
            ? `Published “${created.name}”`
            : `Created draft “${created.name}”`,
          created,
        )
      })

      return mutation(clone(created), outcome.warning)
    },

    async updateProduct(productId: string, input: ProductInput): Promise<MutationResult<Product>> {
      await delay()
      const db = loadDatabase()
      requireSession(db)

      const existing = findProduct(db, productId)
      if (!existing) {
        throw new ServiceError('not_found', 'That product no longer exists. It may have been deleted.')
      }

      const next = applyInput(db, existing, input)

      const outcome = commit((draft) => {
        draft.products = draft.products.map((product) => (product.id === productId ? next : product))

        const becamePublished = next.status === 'published' && existing.status !== 'published'
        const becameDraft = next.status === 'draft' && existing.status === 'published'

        recordActivity(
          draft,
          becamePublished ? 'product_published' : becameDraft ? 'product_unpublished' : 'product_updated',
          becamePublished
            ? `Published “${next.name}”`
            : becameDraft
              ? `Moved “${next.name}” back to draft`
              : `Updated “${next.name}”`,
          next,
        )
      })

      return mutation(clone(next), outcome.warning)
    },

    async deleteProduct(productId: string): Promise<MutationResult<{ id: string }>> {
      await delay()
      const db = loadDatabase()
      requireSession(db)

      const existing = findProduct(db, productId)
      if (!existing) {
        throw new ServiceError('not_found', 'That product no longer exists.')
      }

      const outcome = commit((draft) => {
        draft.products = draft.products.filter((product) => product.id !== productId)
        recordActivity(draft, 'product_deleted', `Deleted “${existing.name}”`, existing)
      })

      return mutation({ id: productId }, outcome.warning)
    },

    /* ── Uploads ─────────────────────────────────────────────────────────── */

    /**
     * Refuses, rather than returning a data URL dressed up as a stored object.
     *
     * Demo uploads already work — `ImageUploadField` reads the file into a browser data URL — but
     * that is a *preview*, and the difference between a preview and an object in a bucket is the
     * entire point of `capabilities.uploads`. Screens branch on that flag and only call this when a
     * real backend is present; reaching here means something skipped the flag, which is a bug worth
     * hearing about loudly.
     */
    async uploadProductImage(
      _file: File,
      _options?: UploadOptions,
    ): Promise<MutationResult<ProductImage>> {
      throw new NotImplementedInDemoError(
        'Uploading a product image',
        'Images are kept in this browser as previews.',
      )
    },

    async uploadTryOnAsset(
      _file: File,
      _options?: UploadOptions,
    ): Promise<MutationResult<StoredTryOnAsset>> {
      throw new NotImplementedInDemoError(
        'Uploading a try-on asset',
        'Try-on assets are described here but their bytes are never stored.',
      )
    },

    async uploadStoreLogo(
      _file: File,
      _options?: UploadOptions,
    ): Promise<MutationResult<StoredAsset>> {
      throw new NotImplementedInDemoError(
        'Uploading a store logo',
        'A logo is kept in this browser as a preview.',
      )
    },

    /** Nothing was ever uploaded, so there is nothing to remove. Not an error — just nothing. */
    async deleteUploadedAsset(_url: string): Promise<void> {},

    /* ── Activity and analytics ──────────────────────────────────────────── */

    async listActivity(limit = 8): Promise<ServiceResult<ActivityEvent[]>> {
      await delay()
      const db = loadDatabase()
      return demo(clone(db.activity.slice(0, limit)))
    },

    async getAnalytics(range: AnalyticsRange): Promise<ServiceResult<AnalyticsSummary>> {
      await delay()
      const db = loadDatabase()
      return demo(buildDemoAnalytics(range, db.products))
    },

    /* ── Public storefront ───────────────────────────────────────────────── */

    async getStorefront(
      storeSlug: string,
      options: { includeDrafts?: boolean } = {},
    ): Promise<ServiceResult<StorefrontView | null>> {
      await delay()
      const db = loadDatabase()

      if (storeSlug !== db.store.slug) {
        return demo<StorefrontView | null>(null)
      }

      // Drafts are owner-only. Serving them to a visitor would leak unpublished catalogue.
      const includeDrafts = Boolean(options.includeDrafts) && db.signedIn

      return demo<StorefrontView | null>(clone(toStorefront(db, includeDrafts)))
    },

    async getPublicProduct(
      storeSlug: string,
      productId: string,
    ): Promise<ServiceResult<ProductView | null>> {
      await delay()
      const db = loadDatabase()

      if (storeSlug !== db.store.slug) return demo<ProductView | null>(null)

      const product = findProduct(db, productId)
      if (!product || product.status !== 'published') {
        // A draft is treated as not found for the public, even though the owner can see it.
        return demo<ProductView | null>(null)
      }

      return demo<ProductView | null>({ store: clone(db.store), product: clone(product) })
    },

    async resolveProduct(productId: string): Promise<ServiceResult<ProductView | null>> {
      await delay()
      const db = loadDatabase()
      const product = findProduct(db, productId)

      if (!product) return demo<ProductView | null>(null)

      return demo<ProductView | null>({ store: clone(db.store), product: clone(product) })
    },

    /* ── Demo-only helpers ───────────────────────────────────────────────── */

    /** Wipes local demo state. Exposed for the Settings screen only. */
    async resetDemoData(): Promise<void> {
      await delay()
      resetDatabase()
    },

    /** Reported by the Settings screen so the storage caveat is visible, not implied. */
    describePersistence(): { mode: 'browser-local'; detail: string } {
      const db = loadDatabase()
      const withAssets = db.products.filter(hasUsableTryOnAsset).length

      return {
        mode: 'browser-local',
        detail: `${db.products.length} products in this browser's local storage (${withAssets} with a try-on asset). Nothing has been written to a database.`,
      }
    },
  }
}

export type MockSellerService = ReturnType<typeof createMockSellerService>
