import { useMemo } from 'react'
import type { AssetUploader, StoredAsset, UploadOptions } from '../types/seller'
import { useSeller } from '../context/SellerContext'

/**
 * The uploaders a picker can be handed, or none.
 *
 * A picker has two honest behaviours and cannot choose between them on its own: put the bytes in
 * object storage, or hold them in this browser as a preview. Only the backend knows which is
 * possible — that is what `capabilities.uploads` is — so the decision is made once, here, and every
 * picker in the app receives the answer rather than re-deriving it.
 *
 * Keeping this in a hook rather than branching inside each picker also means a screen with no
 * storage wired up degrades to the preview path instead of offering a button that throws.
 */

export interface UploadKit {
  /** Product photographs. */
  image?: AssetUploader
  /** A 2D try-on overlay image. Lands in `tryon-assets`, never in `product-images`. */
  tryOnImage?: AssetUploader
  /** An authored `.glb` or `.usdz`. */
  tryOnModel?: AssetUploader
  /** The store's logo, which outlives any product and so lives in its own bucket. */
  storeLogo?: AssetUploader
}

export interface UseUploadKitOptions {
  /**
   * Ids the storage folder, so a product's objects sit together and a delete can find them.
   * Omitted on the create screen, where the product does not exist yet — the auth user id still
   * scopes the path, so nothing is shared with another seller.
   */
  productId?: string
}

export function useUploadKit(options?: UseUploadKitOptions): UploadKit {
  const { service, capabilities } = useSeller()
  const productId = options?.productId

  return useMemo<UploadKit>(() => {
    // No storage, or no service at all, means no uploaders — which is what tells a picker to keep a
    // preview instead of promising something that would throw.
    if (!service || !capabilities.uploads) return {}

    /**
     * Adapts a `SellerService` upload method to the shape a picker wants: it returns just the stored
     * facts, and throws on failure rather than returning a result object the picker would have to
     * unwrap. The per-asset extras — an image's id, a try-on asset's kind — are deliberately dropped
     * here and re-applied by the picker, which is the only party that knows what it asked for.
     */
    const bind = (
      run: (file: File, uploadOptions: UploadOptions) => Promise<{ data: StoredAsset }>,
    ): AssetUploader => {
      return async (file, onProgress) => {
        const { data } = await run(file, { productId, onProgress })
        return data
      }
    }

    return {
      image: bind((file, uploadOptions) => service.uploadProductImage(file, uploadOptions)),
      tryOnImage: bind((file, uploadOptions) => service.uploadTryOnAsset(file, uploadOptions)),
      tryOnModel: bind((file, uploadOptions) => service.uploadTryOnAsset(file, uploadOptions)),
      storeLogo: bind((file, uploadOptions) => service.uploadStoreLogo(file, uploadOptions)),
    }
  }, [service, capabilities.uploads, productId])
}
