import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { paths } from '@/routes/paths'
import { ProductForm } from '../components/ProductForm'
import { useSeller } from '../context/SellerContext'
import { useAction } from '../hooks/useProducts'
import { useUploadKit } from '../hooks/useUploadKit'
import type { ProductInput } from '../types/seller'

/**
 * Add product.
 *
 * The form does the validating; this page owns the submit, the failure message and what happens on
 * success. After creating a product the seller lands on Products rather than an edit screen — the
 * common next step is "put the QR code on the tag", and that lives in the list.
 */

export function AddProduct() {
  const { service, store } = useSeller()
  const navigate = useNavigate()
  const toast = useToast()
  const { state, run } = useAction()

  // No `productId`: the product does not exist until this form is submitted, so its images are
  // scoped by the auth user id alone until a later edit moves them under a folder of their own.
  const uploads = useUploadKit()

  const [serverError, setServerError] = useState<string | null>(null)

  async function handleSubmit(input: ProductInput) {
    if (!service) return
    setServerError(null)

    const result = await run(() => service.createProduct(input))
    if (!result) {
      setServerError('The product could not be saved. Check the fields and try again.')
      return
    }

    const created = result.data

    toast.success(
      created.status === 'published'
        ? `"${created.name}" is published and live on your storefront.`
        : `"${created.name}" was saved as a draft.`,
    )

    // A declared-but-unstored try-on asset is metadata only. Say so rather than letting the seller
    // believe a 3D model is now serving try-on.
    if (result.warning) {
      toast.info(result.warning)
    }

    if (result.persistence === 'browser-local') {
      toast.info('Saved in this browser only — no backend is connected.')
    }

    navigate(paths.seller.products)
  }

  if (!store) return null

  return (
    <>
      <PageHeader
        title="Add product"
        subtitle="A product needs a name, a description, a price, a category and a photo. The try-on asset is separate and optional."
      />

      <div className="callout callout--info" style={{ marginBottom: 'var(--sp-5)' }}>
        <span className="callout__icon">
          <Icon name="info" size={15} />
        </span>
        <span>
          A product photo is <strong>not</strong> converted into a 3D model. Uploading a photo gives
          customers a 2D try-on overlay at best; real 3D try-on needs a modelled <code>.glb</code> or{' '}
          <code>.usdz</code> file. Leaving the try-on asset empty is fine — the product still sells.
        </span>
      </div>

      <ProductForm
        mode="create"
        store={store}
        submitting={state.busy}
        uploads={uploads}
        serverError={serverError}
        onSubmit={handleSubmit}
        onCancel={() => navigate(paths.seller.products)}
      />
    </>
  )
}
