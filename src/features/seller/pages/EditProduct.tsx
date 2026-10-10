import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Card, CardBody } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { PageHeader } from '@/components/ui/PageHeader'
import { LoadingAnnouncement } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { paths } from '@/routes/paths'
import { EmptyState } from '../components/EmptyState'
import { ProductForm } from '../components/ProductForm'
import { QrDialog } from '../components/QrDialog'
import { RowMenu } from '../components/RowMenu'
import { useSeller } from '../context/SellerContext'
import { useAction, useProduct } from '../hooks/useProducts'
import { useUploadKit } from '../hooks/useUploadKit'
import type { ProductInput } from '../types/seller'
import { hasUsableTryOnAsset, productUrl } from '../utils/product'

/**
 * Edit product.
 *
 * A real route rather than a dialog, so the URL can be linked, bookmarked and reloaded — and so the
 * back button does what a seller expects after abandoning an edit.
 *
 * This screen is also where a seller actually sees the product's public link and QR code, next to
 * the fields that feed them.
 */

export function EditProduct() {
  const { productId } = useParams<{ productId: string }>()
  const { service, store } = useSeller()
  const navigate = useNavigate()
  const toast = useToast()

  const product = useProduct(productId)
  const { state, run } = useAction()

  // This product exists, so its new images are filed under it — which is what lets deleting the
  // product find and remove them. `useUploadKit` handles the case where the id is not in the URL.
  const uploads = useUploadKit({ productId })

  const [serverError, setServerError] = useState<string | null>(null)
  const [qrOpen, setQrOpen] = useState(false)

  async function handleSubmit(input: ProductInput) {
    if (!productId || !service) return
    setServerError(null)

    const result = await run(() => service.updateProduct(productId, input))
    if (!result) {
      setServerError('The changes could not be saved. Check the fields and try again.')
      return
    }

    product.setData(result.data)
    toast.success(`"${result.data.name}" was updated.`)
    if (result.warning) toast.info(result.warning)

    navigate(paths.seller.products)
  }

  if (product.loading) {
    return (
      <>
        <LoadingAnnouncement label="Loading product" />
        <div className="skeleton skeleton--title" />
        <div className="skeleton skeleton--card" style={{ marginTop: 'var(--sp-5)' }} />
        <div className="skeleton skeleton--card" style={{ marginTop: 'var(--sp-4)' }} />
      </>
    )
  }

  if (product.error) {
    return (
      <>
        <PageHeader title="Edit product" />
        <Card>
          <CardBody>
            <div className="callout callout--warning" role="alert">
              <span className="callout__icon">
                <Icon name="alert" size={15} />
              </span>
              <span>
                {product.error}{' '}
                <button type="button" className="btn btn--link btn--sm" onClick={product.reload}>
                  Try again
                </button>
              </span>
            </div>
          </CardBody>
        </Card>
      </>
    )
  }

  if (!product.data || !store) {
    return (
      <>
        <PageHeader title="Edit product" />
        <Card>
          <CardBody>
            <EmptyState
              icon="search"
              title="That product no longer exists"
              description="It may have been deleted. Nothing is being edited right now."
              action={
                <Link className="btn btn--primary" to={paths.seller.products}>
                  Back to products
                </Link>
              }
            />
          </CardBody>
        </Card>
      </>
    )
  }

  const current = product.data
  const publicUrl = productUrl(current, store)
  const tryOnReady = hasUsableTryOnAsset(current)

  return (
    <>
      <PageHeader
        title="Edit product"
        subtitle={
          <>
            Editing <strong>{current.name}</strong>. Changes to a published product appear on your
            storefront as soon as you save.
          </>
        }
        actions={
          <RowMenu
            label={`Actions for ${current.name}`}
            bordered
            items={[
              { label: 'Open public page', icon: 'external', href: publicUrl },
              { label: 'Show QR code', icon: 'qr', onSelect: () => setQrOpen(true) },
              {
                label: 'Back to products',
                icon: 'box',
                separated: true,
                onSelect: () => navigate(paths.seller.products),
              },
            ]}
          />
        }
      />

      <div className="grid-2" style={{ marginBottom: 'var(--sp-5)' }}>
        <Card>
          <CardBody>
            <p className="text-xs text-muted" style={{ marginBottom: 'var(--sp-2)' }}>
              Public link
            </p>
            <p className="mono truncate" title={publicUrl}>
              {publicUrl}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <p className="text-xs text-muted" style={{ marginBottom: 'var(--sp-2)' }}>
              Try-on
            </p>
            {tryOnReady ? (
              <p className="row" style={{ gap: 'var(--sp-2)' }}>
                <Icon name="check" size={15} />
                A try-on asset is attached and usable.
              </p>
            ) : (
              <p className="row text-muted" style={{ gap: 'var(--sp-2)' }}>
                <Icon name="sparkle" size={15} />
                {current.tryOnAsset && current.tryOnAsset.kind !== 'none'
                  ? 'A try-on asset is described but not stored, so try-on is unavailable.'
                  : 'No try-on asset. The product is browsable, with no AR experience.'}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <ProductForm
        mode="edit"
        initial={current}
        store={store}
        submitting={state.busy}
        uploads={uploads}
        serverError={serverError}
        onSubmit={handleSubmit}
        onCancel={() => navigate(paths.seller.products)}
      />

      <QrDialog
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title="Product QR code"
        description="Scanning this opens the public page for this exact product."
        url={publicUrl}
        fileName={`shringaar-${store.slug}-${current.slug}`}
        extraRows={[
          { label: 'Product', value: current.name },
          { label: 'Store', value: store.name },
        ]}
      />
    </>
  )
}
