import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { btnClass } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { LoadingAnnouncement } from '@/components/ui/Skeleton'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { CATEGORIES, categoryLabel, type CategoryKey } from '@/lib/catalog'
import { formatCurrency } from '@/lib/format'
import { useProducts } from '../hooks/useProducts'
import { useSeller } from '../context/SellerContext'
import { storeUrl } from '../utils/product'
import { paths } from '@/routes/paths'
import type { Product } from '../types/seller'

/**
 * Collection — everything the seller has photographed, grouped by category.
 *
 * The category grouping is not decoration. A seller looking at this page is checking whether the
 * tray they emptied this morning actually made it into the store, and they think in the same
 * categories they photographed in. A flat grid of forty pieces answers "did it save" slowly and
 * "did all of the earrings save" not at all.
 *
 * The selector narrows to one category. It only ever lists categories the store actually has
 * pieces in — an empty tab for "Anklets" is a tab that wastes a tap and teaches nothing.
 */
export function SellerCollection() {
  const { store } = useSeller()
  const products = useProducts()

  const [filter, setFilter] = useState<CategoryKey | 'all'>('all')

  useDocumentTitle('Collection — Shringaar')

  const all = products.data ?? []

  /** Categories present in the store, in the canonical catalogue order rather than by count. */
  const presentCategories = useMemo(() => {
    const present = new Set(all.map((product) => product.category))
    return (Object.keys(CATEGORIES) as CategoryKey[]).filter((key) => present.has(key))
  }, [all])

  const groups = useMemo(() => {
    const visible = filter === 'all' ? all : all.filter((product) => product.category === filter)
    const byCategory = new Map<CategoryKey, Product[]>()

    for (const product of visible) {
      const bucket = byCategory.get(product.category)
      if (bucket) bucket.push(product)
      else byCategory.set(product.category, [product])
    }

    // Ordered by the catalogue, so the page does not reshuffle between visits.
    return (Object.keys(CATEGORIES) as CategoryKey[])
      .map((key) => ({ key, products: byCategory.get(key) ?? [] }))
      .filter((group) => group.products.length > 0)
  }, [all, filter])

  if (products.loading) {
    return <LoadingAnnouncement label="Loading your collection" />
  }

  return (
    <div className="col">
      <header className="page-header">
        <div>
          <h1 className="page-title">Collection</h1>
          <p className="page-subtitle">
            {all.length === 0
              ? 'Nothing here yet.'
              : `${all.length} ${all.length === 1 ? 'piece' : 'pieces'} across ${presentCategories.length} ${presentCategories.length === 1 ? 'category' : 'categories'}.`}
          </p>
        </div>

        <div className="page-header__actions">
          {store ? (
            <Link className={btnClass({ variant: 'secondary', iconRight: 'external' })} to={storeUrl(store)}>
              View storefront
            </Link>
          ) : null}
          <Link className={btnClass({ variant: 'primary', icon: 'camera' })} to={paths.onboarding.products}>
            Add jewellery
          </Link>
        </div>
      </header>

      {all.length === 0 ? (
        <div className="col__empty">
          <span className="col__empty-icon" aria-hidden="true">
            <Icon name="gridView" size={24} />
          </span>
          <h2>Your collection is empty</h2>
          <p>
            Add your first piece and it appears here, grouped with others of its kind and priced the
            way customers will see it.
          </p>
          <Link className={btnClass({ variant: 'primary', icon: 'camera' })} to={paths.onboarding.products}>
            Add your first product
          </Link>
        </div>
      ) : (
        <>
          <div className="col__filter" role="group" aria-label="Filter by category">
            <button
              type="button"
              className={`col__chip${filter === 'all' ? ' col__chip--on' : ''}`}
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              All
              <span className="col__chip-n">{all.length}</span>
            </button>

            {presentCategories.map((key) => {
              const count = all.filter((product) => product.category === key).length
              return (
                <button
                  key={key}
                  type="button"
                  className={`col__chip${filter === key ? ' col__chip--on' : ''}`}
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                >
                  {CATEGORIES[key]}
                  <span className="col__chip-n">{count}</span>
                </button>
              )
            })}
          </div>

          {groups.map((group) => (
            <section className="col__group" key={group.key} aria-labelledby={`col-${group.key}`}>
              <div className="col__group-head">
                <h2 id={`col-${group.key}`}>{CATEGORIES[group.key]}</h2>
                <span className="col__group-n">
                  {group.products.length} {group.products.length === 1 ? 'piece' : 'pieces'}
                </span>
              </div>

              <ul className="col__grid">
                {group.products.map((product) => (
                  <li key={product.id}>
                    <CollectionCard product={product} storeSlug={store?.slug ?? ''} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  )
}

/**
 * One piece, as the seller sees it in their own collection.
 *
 * Deliberately close to how the storefront renders a product — same image crop, same price
 * position — because this page is how a seller checks their work. A card that looked materially
 * different from the customer's view would make this page a second, less useful product page.
 */
function CollectionCard({ product, storeSlug }: { product: Product; storeSlug: string }) {
  // Built from `paths` rather than from the `productUrl` helper: that helper needs the whole store
  // record to derive an absolute URL, and this card only needs the route.
  const href = storeSlug ? paths.public.product(storeSlug, product.id) : null

  return (
    <article className="col-card">
      <div className="col-card__media">
        {product.image ? (
          <img className="col-card__img" src={product.image.url} alt={product.name} loading="lazy" />
        ) : (
          <span className="col-card__none" aria-hidden="true">
            <Icon name="image" size={20} />
          </span>
        )}

        {product.status === 'draft' ? (
          <span className="col-card__draft">Draft</span>
        ) : null}
      </div>

      <div className="col-card__body">
        <h3 className="col-card__name">{product.name}</h3>

        {/* The guided uploader falls back to the piece name when no description is typed, so a
            description identical to the heading is that fallback showing through, not something the
            seller wrote. Printing it twice reads as a bug, so it is dropped here. */}
        {product.description && product.description !== product.name ? (
          <p className="col-card__desc">{product.description}</p>
        ) : (
          <p className="col-card__desc col-card__desc--none">No description yet.</p>
        )}

        <div className="col-card__foot">
          <span className="col-card__price tabular">
            {formatCurrency(product.price, product.currency)}
          </span>
          <span className="col-card__cat">{categoryLabel(product.category)}</span>
        </div>
      </div>

      <div className="col-card__actions">
        <Link className="col-card__link" to={paths.seller.editProduct(product.id)}>
          <Icon name="pencil" size={14} />
          Edit
        </Link>

        {href ? (
          <a
            className="col-card__link"
            href={href}
            target="_blank"
            rel="noreferrer noopener"
          >
            <Icon name="external" size={14} />
            Preview
          </a>
        ) : null}
      </div>
    </article>
  )
}
