/**
 * Getting an asset's bytes into a usable state — an image for the 2D renderer, a model for the gate.
 *
 * **`crossOrigin` is deliberately not set, and that is a decision rather than an omission.** The
 * reflex is to set `crossOrigin = 'anonymous'` on anything drawn from another origin, because a
 * cross-origin image taints the canvas and tainting blocks `getImageData`/`toBlob`. But this renderer
 * only ever *draws*. Nothing reads pixels back — there is no snapshot, no export, no colour sampling
 * — so a tainted canvas costs exactly nothing. Meanwhile `crossOrigin = 'anonymous'` is not free: it
 * makes the load fail *outright* unless the response carries an `Access-Control-Allow-Origin` that
 * covers this origin. Setting it would convert a harmless canvas taint into an image that never loads
 * for anyone on a bucket whose CORS policy does not list the deployed origin.
 *
 * If a "save this look" feature is ever added, the readback needs BOTH `crossOrigin` here AND a
 * bucket policy allowing `GET` from the deployed origin. That is the moment to revisit this comment,
 * and both halves have to land together — one without the other is a broken try-on or a broken export.
 */

import type { AssetValidation } from '../types/asset'
import type { DrawableAsset } from '../renderers/types'
import { inspectGlbBytes } from './validate'

/**
 * Loads an image and resolves once its pixels are usable.
 *
 * Rejects rather than resolving with a broken image: `drawImage` with an undecoded image is a silent
 * no-op in every browser, so a failure that resolved would surface as "the earring does not appear"
 * with nothing anywhere saying why.
 */
export function loadImageAsset(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    /* Hints the decode off the main thread where supported. Purely an optimisation — the `onload`
       below is what actually gates readiness. */
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The try-on image could not be loaded.'))
    image.src = url
  })
}

/**
 * Wraps a loaded image as a drawable, or returns `null` if it has no intrinsic size.
 *
 * An SVG without `width`/`height` on its root, or an image that has not decoded, reports 0. Returning
 * `null` for that keeps the size check in one place: the renderer derives the drawn height as
 * `drawnWidth * (asset.height / asset.width)`, and a zero width makes that a division by zero whose
 * result is silently invisible on some engines and `Infinity` — which throws — on others. The caller
 * shows nothing, which is the honest outcome for an asset with no size.
 */
export function drawableFromImage(image: HTMLImageElement): DrawableAsset | null {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return null
  return { source: image, width: image.naturalWidth, height: image.naturalHeight }
}

/**
 * Fetches a `.glb` and reports what its bytes actually are.
 *
 * This is the impure half of validation — the fetch, which cannot be tested without a server, kept
 * apart from `inspectGlbBytes`, which is pure and is where every interesting branch lives. The result
 * is an `AssetValidation` ready for `chooseRenderer`, and a network failure is deliberately reported
 * as `invalid` rather than thrown: from the customer's point of view "we could not fetch the model"
 * and "the model is broken" call for the same outcome, and a rejected promise here would surface as a
 * page-level error instead of the quieter, more accurate "this piece cannot be shown in 3D".
 */
export async function validateGlbUrl(url: string): Promise<AssetValidation> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return { status: 'invalid', reason: `the file could not be downloaded (HTTP ${response.status})` }
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    return inspectGlbBytes(bytes)
  } catch {
    return { status: 'invalid', reason: 'the file could not be downloaded' }
  }
}

/** The bytes of a model, or the reason they could not be read. */
export type ModelBytes =
  | { readonly ok: true; readonly bytes: ArrayBuffer }
  | { readonly ok: false; readonly reason: string }

/**
 * Reads a model's bytes, from a URL or from a `File` the customer picked.
 *
 * One function for both because the two differ only in where the bytes come from and every interesting
 * decision is the same either way — most importantly that a failure is *returned*, never thrown. The
 * caller has already validated the container by the time it gets here, so a failure at this stage is a
 * delivery problem rather than a bad asset, and saying so is more useful than an exception that
 * surfaces as a page-level error.
 *
 * `Blob` covers `File`, which is why the lab's local picker and a product's stored URL land in the same
 * function: a picked file never leaves the browser, and a URL is fetched. Neither case needs a
 * different code path above this line.
 */
export async function loadModelBytes(source: string | Blob): Promise<ModelBytes> {
  if (typeof source !== 'string') {
    try {
      return { ok: true, bytes: await source.arrayBuffer() }
    } catch {
      return { ok: false, reason: 'the file could not be read from this device' }
    }
  }

  try {
    const response = await fetch(source)
    if (!response.ok) {
      return { ok: false, reason: `the file could not be downloaded (HTTP ${response.status})` }
    }
    return { ok: true, bytes: await response.arrayBuffer() }
  } catch {
    return { ok: false, reason: 'the file could not be downloaded' }
  }
}

/**
 * Validates bytes that are already in hand, without a second fetch.
 *
 * `validateGlbUrl` fetches and inspects in one go, which is right when all the caller has is a URL. The
 * lab has the bytes as well, and fetching a `blob:` URL a second time to re-learn what it already knows
 * would be work whose only effect is to introduce a failure mode — the object URL being revoked between
 * the two calls.
 */
export function inspectGlb(data: ArrayBuffer): AssetValidation {
  return inspectGlbBytes(new Uint8Array(data))
}

