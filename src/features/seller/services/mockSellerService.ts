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
import type {
  ActivityEvent,
  ActivityType,
  AnalyticsRange,
  AnalyticsSummary,
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

    /* ── Session ─────────────────────────────────────────────────────────── */

    async getSession(): Promise<ServiceResult<Seller | null>> {
      await delay()
      const db = loadDatabase()
      return demo(db.signedIn ? clone(db.seller) : null)
    },

    async signIn(): Promise<ServiceResult<Seller>> {
      await delay()
      commit((db) => {
        db.signedIn = true
      })
      return demo(clone(loadDatabase().seller))
    },

    async signOut(): Promise<void> {
      await delay()
      commit((db) => {
        db.signedIn = false
      })
    },

    /* ── Store ───────────────────────────────────────────────────────────── */

    async getStore(): Promise<ServiceResult<Store>> {
      await delay()
      return demo(clone(loadDatabase().store))
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
