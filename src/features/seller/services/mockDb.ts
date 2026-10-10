/**
 * ╔══════════════════════════════════════════════════════════════════════════════════════════╗
 * ║  DEMO DATA — browser-local, NOT a database.                                              ║
 * ║                                                                                          ║
 * ║  This module backs the dashboard while no backend is connected. It seeds a fictional     ║
 * ║  store, keeps the working copy in memory, and mirrors it into `localStorage` so a reload ║
 * ║  does not lose the session.                                                              ║
 * ║                                                                                          ║
 * ║  It is not a persistence layer and must never be described as one. Every read through    ║
 * ║  it returns `dataSource: 'demo'`; every write reports `persistence: 'browser-local'`.    ║
 * ║  Replace it with the Supabase adapter (arch.md §7) — do not grow it into a real one.     ║
 * ╚══════════════════════════════════════════════════════════════════════════════════════════╝
 */

import { createId, ID_PREFIXES } from '@/lib/id'
import { placeholderImageDataUrl } from '@/lib/placeholder'
import type {
  ActivityEvent,
  Product,
  ProductImage,
  Seller,
  Store,
  TryOnAsset,
} from '../types/seller'

const STORAGE_KEY = 'shringaar.demo.v1'
/** Bumped when the seed changes shape. The loader discards a payload from a different version. */
const SCHEMA_VERSION = 2

export interface DemoDatabase {
  version: number
  /** Whether the fictional seller has "signed in". Kept so a reload preserves the session. */
  signedIn: boolean
  seller: Seller
  store: Store
  products: Product[]
  activity: ActivityEvent[]
}

export interface PersistOutcome {
  persisted: boolean
  warning?: string
}

/* ── Seed ────────────────────────────────────────────────────────────────── */

const SELLER_ID = 'slr_demo_meena'
const STORE_ID = 'str_demo_meena'

function daysAgo(days: number, hourOffset = 0): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(date.getHours() - hourOffset)
  return date.toISOString()
}

function image(label: string, seed: number): ProductImage {
  return {
    id: createId('img'),
    url: placeholderImageDataUrl(label, seed),
    fileName: null,
    mimeType: 'image/svg+xml',
    sizeBytes: null,
    width: 800,
    height: 800,
    // Generated placeholder artwork, not a seller upload.
    origin: 'demo-seed',
    uploadedAt: null,
  }
}

/**
 * A seeded try-on asset.
 *
 * `url` is deliberately null for every seed. Nothing in this build can store a binary, so a seeded
 * asset is a *description* — "this product needs a .glb" — and the file name and MIME type are
 * cleared to match. Filling them in would dress an empty record up as something a customer could
 * try on, which is exactly the claim arch.md §8 forbids.
 */
function tryOn(kind: TryOnAsset['kind'], anchor: TryOnAsset['anchor']): TryOnAsset {
  return {
    kind,
    url: null,
    fileName: null,
    mimeType: null,
    sizeBytes: null,
    anchor,
    origin: 'demo-seed',
    uploadedAt: null,
  }
}

interface SeedSpec {
  id: string
  name: string
  slug: string
  description: string
  price: number
  category: Product['category']
  status: Product['status']
  daysOld: number
  tryOnKind: TryOnAsset['kind']
  anchor: TryOnAsset['anchor']
}

const SEED_PRODUCTS: SeedSpec[] = [
  {
    id: 'prd_demo_001',
    name: 'Meenakari Enamel Ring',
    slug: 'meenakari-enamel-ring',
    description:
      'Hand-painted meenakari enamel set in a gold-plated silver band. Each piece is fired twice, so the colour varies slightly between rings — that variation is the work, not a defect.',
    price: 4850,
    category: 'rings',
    status: 'published',
    daysOld: 42,
    tryOnKind: 'glb',
    anchor: 'finger',
  },
  {
    id: 'prd_demo_002',
    name: 'Kundan Choker Necklace',
    slug: 'kundan-choker-necklace',
    description:
      'Uncut kundan stones in a traditional choker setting with a soft cotton dori. Sits high on the neck. Comes with matching earrings in the same parcel.',
    price: 24900,
    category: 'necklaces',
    status: 'published',
    daysOld: 31,
    tryOnKind: 'image',
    anchor: 'neck',
  },
  {
    id: 'prd_demo_003',
    name: 'Polki Drop Earrings',
    slug: 'polki-drop-earrings',
    description:
      'Polki drops with a pearl finish at the base. Light enough for a full day, structured enough to hold their shape in photographs.',
    price: 13750,
    category: 'earrings',
    status: 'published',
    daysOld: 24,
    tryOnKind: 'glb',
    anchor: 'ear',
  },
  {
    id: 'prd_demo_004',
    name: 'Temple Bangle Pair',
    slug: 'temple-bangle-pair',
    description:
      'A pair of temple-work bangles with antique gold finish. Available in 2.4 and 2.6 inner diameter — confirm the size before ordering, as these are made to order.',
    price: 9200,
    category: 'bangles',
    status: 'published',
    daysOld: 12,
    tryOnKind: 'none',
    anchor: 'wrist',
  },
  {
    id: 'prd_demo_005',
    name: 'Silver Anklet with Ghungroo',
    slug: 'silver-anklet-ghungroo',
    description:
      'Sterling silver anklet with a single row of ghungroo bells. Designed to be worn as a pair — the price shown is for one.',
    price: 3400,
    category: 'anklets',
    status: 'draft',
    daysOld: 4,
    tryOnKind: 'image',
    anchor: 'ankle',
  },
  {
    id: 'prd_demo_006',
    name: 'Emerald Pendant, Uncut',
    slug: 'emerald-pendant-uncut',
    description:
      'A single uncut emerald in a plain gold bezel on an 18-inch chain. The stone is untreated; inclusions are visible under direct light.',
    price: 31500,
    category: 'pendants',
    status: 'draft',
    daysOld: 1,
    tryOnKind: 'none',
    anchor: 'neck',
  },
]

function seedProducts(): Product[] {
  return SEED_PRODUCTS.map((spec, index) => ({
    id: spec.id,
    sellerId: SELLER_ID,
    storeId: STORE_ID,
    name: spec.name,
    slug: spec.slug,
    description: spec.description,
    price: spec.price,
    currency: 'INR',
    category: spec.category,
    status: spec.status,
    image: image(spec.name, index),
    tryOnAsset: tryOn(spec.tryOnKind, spec.anchor),
    externalProductUrl: index === 1 ? 'https://example-shop.test/products/kundan-choker' : null,
    whatsappNumber: null,
    createdAt: daysAgo(spec.daysOld),
    updatedAt: daysAgo(Math.max(0, spec.daysOld - 3), 5),
    publishedAt: spec.status === 'published' ? daysAgo(Math.max(0, spec.daysOld - 1)) : null,
  }))
}

/**
 * The store's history, derived from the products it refers to.
 *
 * Names and timestamps are read off the seeded products rather than restated here, so a change to the
 * catalogue cannot leave the feed announcing a draft for a product that is published, or an edit that
 * the product's own `updatedAt` contradicts.
 */
function seedActivity(products: Product[]): ActivityEvent[] {
  const byId = new Map(products.map((product) => [product.id, product]))

  function productEvent(
    type: ActivityEvent['type'],
    productId: string,
    describe: (name: string) => string,
    when: 'created' | 'updated',
  ): ActivityEvent {
    const product = byId.get(productId)
    // The ids below name seeds that always exist. A missing one is a bug in this module, not a state
    // worth rendering, so it fails loudly at seed time.
    if (!product) throw new Error(`seedActivity: no seeded product with id ${productId}`)

    return {
      id: createId(ID_PREFIXES.activity),
      type,
      message: describe(product.name),
      productId: product.id,
      productName: product.name,
      at: when === 'created' ? product.createdAt : product.updatedAt,
    }
  }

  return [
    productEvent('product_created', 'prd_demo_006', (name) => `Created draft “${name}”`, 'created'),
    productEvent('product_created', 'prd_demo_005', (name) => `Created draft “${name}”`, 'created'),
    productEvent('product_published', 'prd_demo_004', (name) => `Published “${name}”`, 'updated'),
    productEvent(
      'product_updated',
      'prd_demo_001',
      // The seeds' assets are descriptions with no stored file (see `tryOn` above), so this says what
      // actually happened rather than claiming an upload that never took place.
      (name) => `Marked “${name}” as needing a 3D try-on asset`,
      'updated',
    ),
    {
      id: createId(ID_PREFIXES.activity),
      type: 'store_updated',
      message: 'Updated store contact details',
      productId: null,
      productName: null,
      // Matches the store's own `updatedAt` in `createSeedDatabase`.
      at: daysAgo(27, 4),
    },
  ]
}

export function createSeedDatabase(): DemoDatabase {
  const products = seedProducts()

  return {
    version: SCHEMA_VERSION,
    signedIn: false,
    seller: {
      id: SELLER_ID,
      email: 'meena@example.test',
      displayName: 'Meena Jewels',
      createdAt: daysAgo(180),
    },
    store: {
      id: STORE_ID,
      sellerId: SELLER_ID,
      name: 'Meena Jewels',
      slug: 'meena-jewels',
      description:
        'Hand-finished kundan, polki and meenakari pieces made in Jaipur. Small batches, made to order, shipped across India.',
      logoUrl: null,
      contactEmail: 'hello@example.test',
      contactPhone: '+91 98200 00000',
      whatsappNumber: '+91 98200 00000',
      currency: 'INR',
      createdAt: daysAgo(180),
      updatedAt: daysAgo(27, 4),
    },
    products,
    activity: seedActivity(products),
  }
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

let memory: DemoDatabase | null = null

function isDemoDatabase(value: unknown): value is DemoDatabase {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Partial<DemoDatabase>
  return (
    candidate.version === SCHEMA_VERSION &&
    typeof candidate.signedIn === 'boolean' &&
    typeof candidate.seller === 'object' &&
    candidate.seller !== null &&
    typeof candidate.store === 'object' &&
    candidate.store !== null &&
    Array.isArray(candidate.products) &&
    Array.isArray(candidate.activity)
  )
}

export function loadDatabase(): DemoDatabase {
  if (memory) return memory

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isDemoDatabase(parsed)) {
        memory = parsed
        return memory
      }
      // Stored data is from an older or corrupted shape: discard it rather than half-read it.
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Storage unavailable (private mode, disabled, quota). Fall through to a fresh seed.
  }

  memory = createSeedDatabase()
  return memory
}

export function saveDatabase(): PersistOutcome {
  if (!memory) return { persisted: false, warning: 'Nothing to save.' }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
    return { persisted: true }
  } catch (error) {
    const isQuota =
      error instanceof DOMException &&
      (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')

    return {
      persisted: false,
      warning: isQuota
        ? 'Demo storage is full, so this change is kept for the current session only. Large images are usually the cause — a connected backend would store them in file storage instead.'
        : 'This browser blocked local storage, so changes are kept for the current session only.',
    }
  }
}

/** Mutates the in-memory database and mirrors it to storage, reporting whether that worked. */
export function commit(mutate: (db: DemoDatabase) => void): PersistOutcome {
  const db = loadDatabase()
  mutate(db)
  return saveDatabase()
}

/** Wipes local demo state and returns a freshly seeded database. */
export function resetDatabase(): DemoDatabase {
  memory = createSeedDatabase()

  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clean up.
  }

  return memory
}

export const DEMO_STORAGE_KEY = STORAGE_KEY
