/**
 * Which renderer draws a given asset — decided purely, from facts about the asset.
 *
 * The client spec forbids switching to 3D merely because a product has a 3D URL. So this function
 * takes two separate arguments on purpose: the asset (what the seller declared) and the validation
 * (what the client measured). A `.glb` reaches the 3D renderer only when both agree, and the
 * `unchecked` case does not count as agreement.
 */

import {
  AR_CATEGORIES,
  anchorIsCompatible,
  arCategoryFor,
  type ArAsset,
  type AssetValidation,
  type RendererChoice,
} from '../types/asset'
import { CATEGORY_DEFAULT_ANCHOR, TRYON_ANCHOR_LABELS, TRYON_READY_CATEGORIES } from '@/lib/catalog'

/**
 * The categories with a working anchor solver.
 *
 * **Derived, not restated.** `lib/catalog` names the product categories a shopper can try on, because
 * the storefront has to know the same thing before it offers a button; this projects that list into
 * the AR module's own vocabulary. A second hand-written list here would be a second thing to update
 * when a solver lands, and the failure mode is the storefront offering a try-on the engine then
 * declines.
 *
 * Deliberately a separate list from `AR_CATEGORIES`, which names what the *contract* supports. A
 * category belongs in the derived list only once its solver is written and tested; everything else
 * reaches the user as "not available yet", which is a different and more honest message than a broken
 * overlay.
 */
export const IMPLEMENTED_AR_CATEGORIES: readonly (typeof AR_CATEGORIES)[number][] = AR_CATEGORIES.filter(
  (arCategory) => TRYON_READY_CATEGORIES.some((category) => arCategoryFor(category) === arCategory),
)

export function isImplemented(asset: ArAsset): boolean {
  return IMPLEMENTED_AR_CATEGORIES.includes(asset.arCategory)
}

/** The one reason string for the category case, so the UI and the tests cannot drift apart. */
export const UNSUPPORTED_CATEGORY_REASON = 'Try-on is not available for this category yet.'

export function chooseRenderer(asset: ArAsset, validation: AssetValidation): RendererChoice {
  /* Category first. If there is no solver, the asset's kind never gets a chance to matter — and
     reporting "this .glb is invalid" for a category that could not be drawn anyway would send the
     seller to fix the wrong thing. */
  if (!isImplemented(asset)) {
    return { renderer: 'none', reason: UNSUPPORTED_CATEGORY_REASON }
  }

  /* Then the anchor. A stated anchor that contradicts the category is a seller-side mistake, and it
     is worth saying so plainly rather than drawing the piece in a place the seller did not ask for. */
  if (!anchorIsCompatible(asset)) {
    const required = TRYON_ANCHOR_LABELS[CATEGORY_DEFAULT_ANCHOR[asset.category]].toLowerCase()
    const stated = TRYON_ANCHOR_LABELS[asset.declaredAnchor].toLowerCase()
    return {
      renderer: 'none',
      reason: `This piece is marked as a ${stated} placement, but ${asset.arCategory} try-on places it at the ${required}. Update the anchor on the product to enable try-on.`,
    }
  }

  switch (asset.kind) {
    case 'image':
      /* A 2D overlay needs no validation: there is no format to be wrong, and a broken image URL
         fails at load with its own error rather than silently rendering something else. */
      return { renderer: 'canvas2d', reason: null }

    case 'glb':
      switch (validation.status) {
        case 'valid':
          return { renderer: 'three', reason: null }
        case 'invalid':
          /* `none`, not `canvas2d`. The plan's rule is "fall back to a flat overlay *if a 2D fallback
             exists", and it never does here: an `ArAsset` carries exactly one URL and for a `.glb` it
             points at a model. `drawImage` cannot draw a model, so a "flat overlay" would fail at load
             and surface as "The try-on image could not be loaded" — a renderer named in the choice that
             can never render the asset it was chosen for. The product's own photograph is not a
             substitute either: it is a composed catalogue shot, not a cut-out, and the client spec keeps
             ordinary product images separate from AR assets. Declining with the measurement is the
             honest answer. */
          return {
            renderer: 'none',
            reason: `This piece's 3D model could not be used (${validation.reason}).`,
          }
        case 'unchecked':
          /* Not `valid`. Treating "we have not looked" as "it works" is precisely the assumption the
             spec rules out, and it would put a broken model in front of a customer. Also not
             `canvas2d`, for the reason above. */
          return {
            renderer: 'none',
            reason: "This piece's 3D model has not been verified yet, so it cannot be shown.",
          }
      }
      break

    case 'usdz':
      return {
        renderer: 'none',
        reason: 'USDZ models are not supported by this viewer yet.',
      }
  }

  /* Unreachable while the switch covers every `RenderableAssetKind`. Present because a new kind added
     to the union would otherwise fall out of this function returning `undefined` — and returning
     `undefined` where a `RendererChoice` is expected is how a try-on page goes blank. */
  return { renderer: 'none', reason: 'This asset kind is not supported by this viewer.' }
}
