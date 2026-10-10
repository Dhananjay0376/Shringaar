/**
 * The product-to-AR-asset contract.
 *
 * A product carries a `tryOnAsset` — a kind (`image | glb | usdz`) and a URL — plus a category and an
 * optional anchor hint. That is the *seller's* record. This module turns it into the shape the AR
 * client reasons about, and does so without inventing a second vocabulary: the kinds, the anchors and
 * the per-category default anchor all come from `lib/catalog`, which is where the seller's form reads
 * them from. If the two ever disagreed, a seller could pick one anchor and the client would look for
 * another.
 *
 * What this module deliberately does NOT do:
 *
 *   - It does not treat a picked-but-unstored `.glb` as usable. `hasUsableTryOnAsset` in `lib/catalog`
 *     already draws that line and this defers to it, because the seller recorded a *choice* and the
 *     bytes never arrived.
 *   - It does not assume a 3D URL means a working 3D model. `kind === 'glb'` is a claim by the seller;
 *     `AssetValidation` is what the client measured by fetching and inspecting the bytes. Those are
 *     different facts and the renderer choice depends on the second one.
 */

import {
  CATEGORY_DEFAULT_ANCHOR,
  hasUsableTryOnAsset,
  type CategoryKey,
  type TryOnAnchor,
  type TryOnAssetKind,
} from '@/lib/catalog'

/**
 * The categories the AR module attempts, named the way the client spec names them.
 *
 * A subset of `CategoryKey`, not a rival to it: `ArCategory` is the list of things the try-on engine
 * has an anchor strategy for, and today exactly one of them is implemented. `noserings`, `bangles`,
 * `sets` and the rest have no anchor strategy at all and are absent rather than mapped to a
 * placeholder, so a missing entry is a missing capability rather than a silent default.
 */
export const AR_CATEGORIES = ['earrings', 'necklace', 'pendant', 'ring', 'bracelet'] as const
export type ArCategory = (typeof AR_CATEGORIES)[number]

/**
 * The product categories that map onto the AR module, and how.
 *
 * Two product categories can share one AR strategy — `necklaces` and `pendants` are both worn at the
 * neck — so this is a mapping rather than an identity. Returns `null` when the AR module has no
 * strategy for a category, which the UI reports as "not available for this category yet" instead of
 * rendering something approximately right.
 */
export function arCategoryFor(category: CategoryKey): ArCategory | null {
  switch (category) {
    case 'earrings':
      return 'earrings'
    case 'necklaces':
    case 'pendants':
      return 'necklace'
    case 'rings':
      return 'ring'
    case 'bracelets':
      return 'bracelet'
    /* anklets, bangles, noserings, sets, other: no anchor strategy exists. Listed explicitly so that
       adding one to `AR_CATEGORIES` without adding it here is a visible omission, not a silent one. */
    default:
      return null
  }
}

/** The asset kinds that can be rendered. `none` means there is nothing to render. */
export type RenderableAssetKind = Exclude<TryOnAssetKind, 'none'>

/** A product's try-on asset, resolved into the shape the AR client consumes. */
export interface ArAsset {
  /** The product's own category, which is what the catalogue and the seller form use. */
  readonly category: CategoryKey
  /** The anchor strategy this asset should be placed with. */
  readonly arCategory: ArCategory
  readonly kind: RenderableAssetKind
  readonly url: string
  /**
   * The anchor as recorded on the product, before any defaulting. Kept raw so the conflict check in
   * `chooseRenderer` can tell "the seller said wrist" apart from "the seller said nothing".
   */
  readonly declaredAnchor: TryOnAnchor
  /** The anchor actually used: the declared one, or the category default when unspecified. */
  readonly anchor: TryOnAnchor
}

/** The minimum a product must expose for `arAssetFor` to build an `ArAsset`. */
export interface ArAssetSource {
  readonly category: CategoryKey
  readonly tryOnAsset: { readonly kind: TryOnAssetKind; readonly url: string | null; readonly anchor: TryOnAnchor } | null
}

/**
 * Builds the AR view of a product's asset, or `null` when there is nothing usable.
 *
 * Returns `null` — rather than an asset with a null URL — in three distinct cases, all of which mean
 * "the client has nothing to draw": no asset recorded, a kind of `none`, a declared asset whose bytes
 * were never stored, and any category with no AR strategy. The caller shows one honest message for
 * all of them; the *reason* differs but the action does not.
 */
export function arAssetFor(source: ArAssetSource | null | undefined): ArAsset | null {
  if (!hasUsableTryOnAsset(source)) return null

  const asset = source?.tryOnAsset
  if (!source || !asset || !asset.url) return null

  const arCategory = arCategoryFor(source.category)
  if (arCategory === null) return null

  return {
    category: source.category,
    arCategory,
    kind: asset.kind as RenderableAssetKind,
    url: asset.url,
    declaredAnchor: asset.anchor,
    anchor: asset.anchor === 'unspecified' ? CATEGORY_DEFAULT_ANCHOR[source.category] : asset.anchor,
  }
}

/**
 * What the client measured about a `.glb`, as opposed to what the seller declared.
 *
 * `unchecked` exists because a 2D image has nothing to validate and a `.glb` has not been fetched
 * yet. It is not a synonym for success — collapsing it into `ok: true` would let an unvalidated model
 * reach the 3D renderer, which is exactly the assumption the client spec forbids.
 */
export type AssetValidation =
  | { readonly status: 'unchecked' }
  | { readonly status: 'valid' }
  | { readonly status: 'invalid'; readonly reason: string }

export const UNCHECKED_ASSET: AssetValidation = { status: 'unchecked' }

/**
 * Whether the product's *stated* anchor agrees with the category's requirement.
 *
 * Reads `declaredAnchor`, not the resolved `anchor`, and the difference is the whole point: once
 * resolved, an unspecified anchor is indistinguishable from a matching one, so a resolved-value check
 * could never tell "the seller said nothing" from "the seller said exactly the right thing". Both are
 * compatible — but only one of them deserves a conflict warning, and only the raw value can say which.
 *
 * An explicit anchor that conflicts does not pass: a `wrist` anchor on an earring means the seller and
 * the engine disagree about where the piece is worn, and drawing it on an ear anyway would be guessing
 * over the top of a stated answer.
 */
export function anchorIsCompatible(asset: ArAsset): boolean {
  return (
    asset.declaredAnchor === 'unspecified' ||
    asset.declaredAnchor === CATEGORY_DEFAULT_ANCHOR[asset.category]
  )
}

/** Which renderer will draw this asset. `none` means it cannot be drawn, and `reason` says why. */
export type RendererKind = 'canvas2d' | 'three' | 'none'

export interface RendererChoice {
  readonly renderer: RendererKind
  /**
   * A user-facing explanation, or `null` when there is nothing to explain.
   *
   * `null` covers both working paths — a 2D image and a validated model — because an apology printed
   * under a piece that renders perfectly is its own kind of wrong. Every `none` carries a reason;
   * there is no such thing as an unexplained refusal.
   */
  readonly reason: string | null
}
