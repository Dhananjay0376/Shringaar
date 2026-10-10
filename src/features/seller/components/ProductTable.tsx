import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/ui/Icon'
import { STATUS_LABELS, STATUS_TONES } from '@/lib/catalog'
import { formatRelativeTime } from '@/lib/format'
import type { Product, Store } from '../types/seller'
import { hasUsableTryOnAsset, priceLabel, productCategoryLabel, productUrl } from '../utils/product'
import { RowMenu } from './RowMenu'

/**
 * Product table — the dense view, for checking status across a large catalogue.
 *
 * Prices and dates are right-aligned with tabular figures so columns can be compared by scanning
 * down them (design.md D12).
 */

export interface ProductTableProps {
  products: Product[]
  store: Store
  onEdit: (product: Product) => void
  onDelete: (product: Product) => void
  onCopyLink: (product: Product) => void
  onShowQr: (product: Product) => void
}

export function ProductTable({
  products,
  store,
  onEdit,
  onDelete,
  onCopyLink,
  onShowQr,
}: ProductTableProps) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">
          Your products, with price, category, publication status and try-on availability.
        </caption>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">Category</th>
            <th scope="col">Try-on</th>
            <th scope="col">Status</th>
            <th scope="col" className="table__num">
              Price
            </th>
            <th scope="col" className="table__num">
              Updated
            </th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const publicUrl = productUrl(product, store)

            return (
              <tr key={product.id}>
                <td>
                  <div className="table__product">
                    {product.image ? (
                      <img
                        className="table__thumb"
                        src={product.image.url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="table__thumb table__thumb--empty" aria-hidden="true">
                        <Icon name="image" size={16} />
                      </span>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div className="table__name">{product.name}</div>
                      <div className="table__sub truncate">{product.slug}</div>
                    </div>
                  </div>
                </td>

                <td>{productCategoryLabel(product)}</td>

                <td>
                  {hasUsableTryOnAsset(product) ? (
                    <span className="product-card__tryon-flag">
                      <Icon name="sparkle" size={12} />
                      Ready
                    </span>
                  ) : (
                    <span className="text-muted text-xs">None</span>
                  )}
                </td>

                <td>
                  <Badge tone={STATUS_TONES[product.status]} dot>
                    {STATUS_LABELS[product.status]}
                  </Badge>
                </td>

                <td className="table__num">{priceLabel(product)}</td>

                <td className="table__num text-muted text-xs">
                  {formatRelativeTime(product.updatedAt)}
                </td>

                <td>
                  <div className="table__actions">
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: 30, height: 30 }}
                      onClick={() => onEdit(product)}
                      aria-label={`Edit ${product.name}`}
                      title="Edit"
                    >
                      <Icon name="pencil" size={15} />
                    </button>

                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: 30, height: 30 }}
                      onClick={() => onCopyLink(product)}
                      aria-label={`Copy the public link for ${product.name}`}
                      title="Copy link"
                    >
                      <Icon name="link" size={15} />
                    </button>

                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: 30, height: 30 }}
                      onClick={() => onShowQr(product)}
                      aria-label={`Show the QR code for ${product.name}`}
                      title="QR code"
                    >
                      <Icon name="qr" size={15} />
                    </button>

                    <RowMenu
                      label={`More actions for ${product.name}`}
                      items={[
                        { label: 'View public page', icon: 'external', href: publicUrl },
                        { label: 'Copy product link', icon: 'link', onSelect: () => onCopyLink(product) },
                        { label: 'Show QR code', icon: 'qr', onSelect: () => onShowQr(product) },
                        {
                          label: 'Delete product',
                          icon: 'trash',
                          danger: true,
                          separated: true,
                          onSelect: () => onDelete(product),
                        },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
