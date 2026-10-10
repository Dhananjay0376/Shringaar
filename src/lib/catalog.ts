/**
 * Domain vocabulary and URL construction shared by the seller dashboard and the public
 * storefront.
 *
 * This module is the source of truth for the closed sets (categories, currencies, try-on anchors
 * and asset kinds). The seller types derive their unions from these constants, so there is one
 * place to add a category rather than two that can drift apart.
 *
 * It must not import from `features/` — the dependency runs the other way.
 */

/* ── Categories ──────────────────────────────────────────────────────────── */

export const CATEGORIES = {
  rings: 'Rings',
  necklaces: 'Necklaces',
  earrings: 'Earrings',
  noserings: 'Nose rings',
  bracelets: 'Bracelets',
  bangles: 'Bangles',
  pendants: 'Pendants',
  anklets: 'Anklets',
  sets: 'Jewellery sets',
  other: 'Other',
} as const

export type CategoryKey = keyof typeof CATEGORIES

export const CATEGORY_OPTIONS = (Object.keys(CATEGORIES) as CategoryKey[]).map((value) => ({
  value,
  label: CATEGORIES[value],
}))

/**
 * The short list the guided first-run uploader offers.
 *
 * A seller photographing a tray of stock thinks in four buckets, not ten. This is a *subset* of
 * `CATEGORIES`, not a second vocabulary: every key here is a real category, so a product added
 * through the guided flow is indistinguishable from one added through the full product form. The
 * remaining categories stay available on that form for the pieces this short list would flatten.
 */
export const GUIDED_CATEGORY_KEYS = ['earrings', 'noserings', 'necklaces', 'other'] as const

export const GUIDED_CATEGORY_OPTIONS = GUIDED_CATEGORY_KEYS.map((value) => ({
  value,
  label: CATEGORIES[value],
}))

export function categoryLabel(key: string): string {
  return CATEGORIES[key as CategoryKey] ?? 'Other'
}

/* ── Currencies ──────────────────────────────────────────────────────────── */

export const CURRENCIES = {
  INR: { label: 'INR — Indian Rupee', symbol: '₹', locale: 'en-IN' },
  USD: { label: 'USD — US Dollar', symbol: '$', locale: 'en-US' },
  EUR: { label: 'EUR — Euro', symbol: '€', locale: 'de-DE' },
  GBP: { label: 'GBP — British Pound', symbol: '£', locale: 'en-GB' },
  AED: { label: 'AED — UAE Dirham', symbol: 'د.إ', locale: 'en-AE' },
  SGD: { label: 'SGD — Singapore Dollar', symbol: 'S$', locale: 'en-SG' },
} as const

export type CurrencyKey = keyof typeof CURRENCIES

export const CURRENCY_OPTIONS = (Object.keys(CURRENCIES) as CurrencyKey[]).map((value) => ({
  value,
  label: CURRENCIES[value].label,
}))

export function currencySymbol(code: string): string {
  return CURRENCIES[code as CurrencyKey]?.symbol ?? code
}

/* ── Product status ──────────────────────────────────────────────────────── */

export const PRODUCT_STATUSES = ['draft', 'published'] as const
export type ProductStatusKey = (typeof PRODUCT_STATUSES)[number]

export const STATUS_LABELS: Record<ProductStatusKey, string> = {
  draft: 'Draft',
  published: 'Published',
}

export const STATUS_TONES: Record<ProductStatusKey, 'neutral' | 'success'> = {
  draft: 'neutral',
  published: 'success',
}

/* ── Try-on ──────────────────────────────────────────────────────────────── */

/**
 * What kind of asset drives the try-on. `none` means the product is browsable but has no AR
 * experience yet — which is an honest, valid state, not an error.
 *
 * An ordinary product photo is NOT converted into a 3D model anywhere in this system. A photo is
 * a 2D placement image; a `.glb`/`.usdz` file is required for full 3D try-on. See arch.md §8.
 */
export const TRYON_ASSET_KINDS = ['none', 'image', 'glb', 'usdz'] as const
export type TryOnAssetKind = (typeof TRYON_ASSET_KINDS)[number]

export const TRYON_ASSET_KIND_LABELS: Record<TryOnAssetKind, string> = {
  none: 'No try-on asset',
  image: 'Photo overlay (2D placement)',
  glb: '3D model — glTF (.glb)',
  usdz: '3D model — USDZ (.usdz)',
}

/** Where the AR client should attempt to place the piece. A hint, not a guarantee. */
export const TRYON_ANCHORS = ['unspecified', 'finger', 'wrist', 'neck', 'ear', 'nose', 'ankle'] as const
export type TryOnAnchor = (typeof TRYON_ANCHORS)[number]

export const TRYON_ANCHOR_LABELS: Record<TryOnAnchor, string> = {
  unspecified: 'Not specified',
  finger: 'Finger',
  wrist: 'Wrist',
  neck: 'Neck',
  ear: 'Ear',
  nose: 'Nose',
  ankle: 'Ankle',
}

/** Suggested anchor for a category, used to pre-fill the form. */
export const CATEGORY_DEFAULT_ANCHOR: Record<CategoryKey, TryOnAnchor> = {
  rings: 'finger',
  necklaces: 'neck',
  earrings: 'ear',
  noserings: 'nose',
  bracelets: 'wrist',
  bangles: 'wrist',
  pendants: 'neck',
  anklets: 'ankle',
  sets: 'unspecified',
  other: 'unspecified',
}

/**
 * The product categories a try-on experience actually exists for.
 *
 * Defined here, in the shared vocabulary, because two features ask this question and must not answer
 * it differently: the storefront decides whether to offer a "Try it on" button at all, and the AR
 * engine decides whether it has an anchor strategy. If they disagreed, a customer would be promised a
 * try-on that then refused to run — the worst of both, and the failure `renderers/select.ts` already
 * guards against internally by pinning its list to the solver registry.
 *
 * Only `earrings` is here. Every other category has an anchor constant above so the seller's form can
 * pre-fill something sensible, but a pre-filled anchor is not an implementation, and listing a
 * category here is a claim that a shopper can actually see the piece on themselves.
 */
export const TRYON_READY_CATEGORIES: readonly CategoryKey[] = ['earrings']

export function hasTryOnExperience(category: CategoryKey): boolean {
  return TRYON_READY_CATEGORIES.includes(category)
}

/**
 * Whether an asset can actually be rendered by a try-on client right now.
 *
 * A declared-but-unstored asset (a `.glb` chosen in the form before storage exists) is deliberately
 * NOT usable: the choice is recorded, the bytes are not. Takes the record that *owns* the asset —
 * both a seller `Product` and a storefront view expose `tryOnAsset`, and requiring the wrapper keeps
 * the check identical on both sides instead of each passing a different shape.
 */
export function hasUsableTryOnAsset(
  owner: { tryOnAsset: { kind: TryOnAssetKind; url: string | null } | null } | null | undefined,
): boolean {
  const asset = owner?.tryOnAsset
  return Boolean(asset && asset.kind !== 'none' && asset.url)
}

/**
 * Which WhatsApp number a product's contact button should open.
 *
 * A product may override the store's number; otherwise the store's applies. Defined here rather than
 * in either feature because the seller's dashboard and the customer's storefront must resolve it
 * identically — if they disagree, a customer is sent to the wrong seller. Typed structurally so both
 * callers can pass their own record shapes.
 */
export function resolveContactWhatsApp(
  product: { whatsappNumber: string | null } | null | undefined,
  store: { whatsappNumber: string | null } | null | undefined,
): string | null {
  return product?.whatsappNumber?.trim() || store?.whatsappNumber?.trim() || null
}

/* ── Slugs ───────────────────────────────────────────────────────────────── */

const SLUG_MAX = 48

/**
 * Lowercase, hyphenated, ASCII-safe slug. Diacritics are stripped so a store named "Rêve" gets a
 * URL that survives being printed on a label and typed by hand.
 */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')

  return base
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const RESERVED_SLUGS = new Set([
  'seller',
  'admin',
  'api',
  'app',
  'account',
  'settings',
  'store',
  'stores',
  'product',
  'products',
  'dashboard',
  'login',
  'signin',
  'sign-in',
  'signup',
  'sign-up',
  'help',
  'support',
  'about',
  'terms',
  'privacy',
  's',
  'p',
  'tryon',
  'try-on',
])

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug)
}

/* ── Public URLs ─────────────────────────────────────────────────────────── */

function join(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, '')}${path}`
}

/** Path of a store's public storefront. */
export function storePath(storeSlug: string): string {
  return `/s/${storeSlug}`
}

/**
 * Path of a product's public page. The store slug is included so the URL is self-describing and
 * one product cannot be confused with another store's product.
 */
export function productPath(storeSlug: string, productId: string): string {
  return `/s/${storeSlug}/p/${productId}`
}

export function storePublicUrl(origin: string, storeSlug: string): string {
  return join(origin, storePath(storeSlug))
}

export function productPublicUrl(origin: string, storeSlug: string, productId: string): string {
  return join(origin, productPath(storeSlug, productId))
}

/**
 * Link into the customer AR client for a specific product. Returns null when no try-on host is
 * configured, so callers must handle "AR not available yet" rather than rendering a broken link.
 */
export function tryOnUrl(baseUrl: string | null, productId: string): string | null {
  if (!baseUrl) return null
  return join(baseUrl, `/tryon/${productId}`)
}

/** Digits only, no `+`, suitable for a `wa.me` link. */
export function normaliseWhatsApp(input: string): string {
  return input.replace(/[^\d]/g, '')
}

/** `https://wa.me/<number>?text=<message>` — the only WhatsApp link shape we generate. */
export function whatsAppLink(number: string, message?: string): string | null {
  const digits = normaliseWhatsApp(number)
  if (digits.length < 8) return null

  const query = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${digits}${query}`
}
