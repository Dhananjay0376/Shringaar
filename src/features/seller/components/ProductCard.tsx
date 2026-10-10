import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/ui/Icon'
import { STATUS_LABELS, STATUS_TONES } from '@/lib/catalog'
import type { Product, Store } from '../types/seller'
import { hasUsableTryOnAsset, priceLabel, productCategoryLabel, productUrl } from '../utils/product'
import { RowMenu } from './RowMenu'

/**
 * Product card — the image-forward view of the catalogue.
 *
 * Dialogues (delete confirmation, QR) are owned by the page, not the card, so one dialog serves the
 * whole grid instead of one per card.
 */

export interface ProductCardProps {
  product: Product
  store: Store
  onEdit: () => void
  onDelete: () => void
  onCopyLink: () => void
  onShowQr: () => void
}

export function ProductCard({
  product,
  store,
  onEdit,
  onDelete,
  onCopyLink,
  onShowQr,
}: ProductCardProps) {
  const publicUrl = productUrl(product, store)
  const hasTryOn = hasUsableTryOnAsset(product)

  return (
    <article className="product-card">
      <div className="product-card__media">
        {product.image ? (
          <img
            className="product-card__img"
            src={product.image.url}
            alt={product.name}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="product-card__placeholder">
            <Icon name="image" size={26} />
            <span className="sr-only">No product image uploaded</span>
          </div>
        )}

        <span className="product-card__status">
          <Badge tone={STATUS_TONES[product.status]} dot>
            {STATUS_LABELS[product.status]}
          </Badge>
        </span>
      </div>

      <div className="product-card__body">
        <h3 className="product-card__name">{product.name}</h3>
        <p className="product-card__price tabular">{priceLabel(product)}</p>

        <div className="product-card__meta">
          <span>{productCategoryLabel(product)}</span>
          <span aria-hidden="true">·</span>
          {hasTryOn ? (
            <span className="product-card__tryon-flag">
              <Icon name="sparkle" size={12} />
              Try-on ready
            </span>
          ) : (
            <span title="No try-on asset uploaded for this product yet">No try-on asset</span>
          )}
        </div>
      </div>

      <div className="product-card__actions">
        <button type="button" className="btn btn--secondary btn--sm" onClick={onEdit}>
          <Icon name="pencil" size={14} />
          Edit
        </button>

        <span className="spacer" />

        <button
          type="button"
          className="icon-btn"
          style={{ width: 30, height: 30 }}
          onClick={onCopyLink}
          aria-label={`Copy the public link for ${product.name}`}
          title="Copy product link"
        >
          <Icon name="link" size={15} />
        </button>

        <button
          type="button"
          className="icon-btn"
          style={{ width: 30, height: 30 }}
          onClick={onShowQr}
          aria-label={`Show the QR code for ${product.name}`}
          title="QR code"
        >
          <Icon name="qr" size={15} />
        </button>

        <RowMenu
          label={`More actions for ${product.name}`}
          items={[
            { label: 'View public page', icon: 'external', href: publicUrl },
            { label: 'Copy product link', icon: 'link', onSelect: onCopyLink },
            { label: 'Show QR code', icon: 'qr', onSelect: onShowQr },
            { label: 'Delete product', icon: 'trash', danger: true, separated: true, onSelect: onDelete },
          ]}
        />
      </div>
    </article>
  )
}
