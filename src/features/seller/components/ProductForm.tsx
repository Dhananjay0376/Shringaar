import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardFooter } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import {
  CATEGORIES,
  CATEGORY_DEFAULT_ANCHOR,
  CATEGORY_OPTIONS,
  CURRENCY_OPTIONS,
  currencySymbol,
} from '@/lib/catalog'
import type { CategoryKey, CurrencyKey } from '@/lib/catalog'
import type { Product, ProductInput, Store } from '../types/seller'
import type { UploadKit } from '../hooks/useUploadKit'
import { ProductField, validateProduct, type FieldErrors } from '../utils/validation'
import { ImageUploadField } from './ImageUploadField'
import { TryOnAssetField, createEmptyTryOnAsset } from './TryOnAssetField'

/**
 * Add and edit product — one form, two routes.
 *
 * Keeping a single component means the two screens cannot drift: a rule added here applies whether a
 * seller is creating or editing. See arch.md §3.
 *
 * The form itself never touches the service. It is handed `uploads` — built by the screen from
 * `useUploadKit` — and passes the same kit to both pickers, so there is one answer to "can this
 * backend store bytes?" rather than one per field.
 */

export interface ProductFormProps {
  mode: 'create' | 'edit'
  initial?: Product | null
  store: Store
  submitting: boolean
  /** Where the pickers put their bytes. Empty when this backend has no object storage. */
  uploads?: UploadKit
  serverError?: string | null
  onSubmit: (input: ProductInput) => void
  onCancel: () => void
}

interface FormState {
  name: string
  description: string
  price: string
  currency: CurrencyKey
  category: CategoryKey
  status: ProductInput['status']
  image: ProductInput['image']
  tryOnAsset: ProductInput['tryOnAsset']
  externalProductUrl: string
  whatsappNumber: string
}

function initialState(initial: Product | null | undefined, store: Store): FormState {
  return {
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    price: initial ? String(initial.price) : '',
    currency: initial?.currency ?? store.currency,
    category: initial?.category ?? 'rings',
    status: initial?.status ?? 'draft',
    image: initial?.image ?? null,
    tryOnAsset: initial?.tryOnAsset ?? createEmptyTryOnAsset(CATEGORY_DEFAULT_ANCHOR.rings),
    externalProductUrl: initial?.externalProductUrl ?? '',
    // Empty means "use the store's number", which is the common case and avoids duplicating it.
    whatsappNumber: initial?.whatsappNumber ?? '',
  }
}

export function ProductForm({
  mode,
  initial,
  store,
  submitting,
  uploads,
  serverError,
  onSubmit,
  onCancel,
}: ProductFormProps) {
  const [form, setForm] = useState<FormState>(() => initialState(initial, store))
  const [errors, setErrors] = useState<FieldErrors<ProductField>>({})
  const [attempted, setAttempted] = useState(false)

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))

    // Clear the field's error as soon as the seller starts fixing it, so the form stops shouting
    // while they type.
    if (attempted && key in errors) {
      setErrors((current) => {
        const next = { ...current }
        delete next[key as ProductField]
        return next
      })
    }
  }

  function buildInput(): ProductInput {
    const parsedPrice = Number.parseFloat(form.price)

    return {
      name: form.name,
      description: form.description,
      price: Number.isFinite(parsedPrice) ? parsedPrice : Number.NaN,
      currency: form.currency,
      category: form.category,
      status: form.status,
      image: form.image,
      tryOnAsset: form.tryOnAsset,
      externalProductUrl: form.externalProductUrl.trim() || null,
      whatsappNumber: form.whatsappNumber.trim() || null,
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setAttempted(true)

    const input = buildInput()
    const nextErrors = validateProduct(input)
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      // Move focus to the first control the seller needs to fix, so a keyboard user is not left
      // guessing which of eleven fields is the problem. React has not re-rendered the invalid
      // attributes yet when this runs, so the lookup is deferred by one frame.
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }

    onSubmit(input)
  }

  const symbol = currencySymbol(form.currency)
  const isPublishing = form.status === 'published'
  const assetDeclaredButUnstored =
    Boolean(form.tryOnAsset && form.tryOnAsset.kind !== 'none' && !form.tryOnAsset.url)

  /**
   * The one line of small print next to the save button.
   *
   * `assetDeclaredButUnstored` means two different things depending on the backend, and saying the
   * wrong one would be a lie in one of the two cases: without storage the asset genuinely cannot be
   * stored, and the seller should know that before they save; with storage the only thing missing is
   * that they have not chosen the file yet, which is theirs to fix.
   */
  const footerNote = assetDeclaredButUnstored
    ? uploads?.tryOnModel
      ? 'The try-on file still needs choosing.'
      : 'Try-on asset will be recorded but not uploaded.'
    : isPublishing
      ? 'Visible on your storefront after saving.'
      : 'Saved privately as a draft.'

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="stack" style={{ gap: 'var(--sp-5)' }}>
        {serverError ? (
          <div className="banner banner--error" role="alert">
            <span className="banner__icon">
              <Icon name="alert" size={16} />
            </span>
            <span className="banner__body">{serverError}</span>
          </div>
        ) : null}

        <Card>
          <CardHeader
            title="Product details"
            subtitle="What the piece is and what it costs. This is what customers read on your storefront."
          />
          <CardBody>
            <div className="form-grid">
              <div className="form-grid__full">
                <Field
                  label="Product name"
                  required
                  error={errors.name}
                  hint="Shown as the heading on the product page and in your product list."
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={form.name}
                      maxLength={90}
                      autoComplete="off"
                      placeholder="Kundan Choker Necklace"
                      onChange={(event) => update('name', event.target.value)}
                    />
                  )}
                </Field>
              </div>

              <div className="form-grid__full">
                <Field
                  label="Description"
                  required
                  error={errors.description}
                  hint="Materials, dimensions, care, and anything a buyer would ask before ordering."
                >
                  {({ id, describedBy, invalid }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={form.description}
                      maxLength={2000}
                      placeholder="Hand-set kundan stones on a gold-plated base. 16-inch choker with adjustable dori."
                      onChange={(event) => update('description', event.target.value)}
                    />
                  )}
                </Field>
              </div>

              <Field label="Price" required error={errors.price}>
                {({ id, describedBy, invalid }) => (
                  <div className="field-row-2">
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      prefix={symbol}
                      value={form.price}
                      placeholder="0.00"
                      onChange={(event) => update('price', event.target.value)}
                    />
                    <Select
                      aria-label="Currency"
                      value={form.currency}
                      onChange={(event) => update('currency', event.target.value as CurrencyKey)}
                      options={CURRENCY_OPTIONS}
                    />
                  </div>
                )}
              </Field>

              <Field label="Category" required error={errors.category}>
                {({ id, describedBy, invalid }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={form.category}
                    onChange={(event) => {
                      const category = event.target.value as CategoryKey
                      setForm((current) => ({
                        ...current,
                        category,
                        // Only re-point the anchor while the asset is still empty, so a deliberate
                        // choice is never overwritten.
                        tryOnAsset:
                          current.tryOnAsset && current.tryOnAsset.kind === 'none'
                            ? { ...current.tryOnAsset, anchor: CATEGORY_DEFAULT_ANCHOR[category] }
                            : current.tryOnAsset,
                      }))
                    }}
                    options={CATEGORY_OPTIONS}
                  />
                )}
              </Field>

              <div className="form-grid__full">
                <Field
                  label="Publication status"
                  required
                  hint={
                    isPublishing
                      ? 'Published products appear on your public storefront immediately.'
                      : 'Drafts stay private. Only you can see them.'
                  }
                >
                  {() => (
                    <div className="radio-cards">
                      <label
                        className={[
                          'radio-card',
                          form.status === 'draft' ? 'radio-card--active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <input
                          type="radio"
                          name="status"
                          value="draft"
                          checked={form.status === 'draft'}
                          onChange={() => update('status', 'draft')}
                        />
                        <span>
                          <span className="radio-card__title">Draft</span>
                          <span className="radio-card__desc">
                            Save now, publish when the photography and pricing are final.
                          </span>
                        </span>
                      </label>

                      <label
                        className={[
                          'radio-card',
                          form.status === 'published' ? 'radio-card--active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <input
                          type="radio"
                          name="status"
                          value="published"
                          checked={form.status === 'published'}
                          onChange={() => update('status', 'published')}
                        />
                        <span>
                          <span className="radio-card__title">Published</span>
                          <span className="radio-card__desc">
                            Visible on your storefront. Requires a product image.
                          </span>
                        </span>
                      </label>
                    </div>
                  )}
                </Field>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Product image"
            subtitle="The photograph customers see on your storefront."
          />
          <CardBody>
            <ImageUploadField
              noun="product image"
              title="Product photograph"
              hint={`JPEG, PNG, WebP or AVIF, up to 5 MB. Square images look best in the catalogue — ${CATEGORIES[form.category]} are usually shot straight on.`}
              value={form.image}
              onChange={(next) => update('image', next)}
              upload={uploads?.image}
              error={errors.image}
            />

            {isPublishing && !form.image ? (
              <p className="field__hint" style={{ marginTop: 'var(--sp-3)' }}>
                A published product needs an image, otherwise it appears as an empty tile.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Try-on asset"
            subtitle="What the AR try-on experience uses. Kept separate from the product photo."
          />
          <CardBody>
            <TryOnAssetField
              value={form.tryOnAsset}
              onChange={(next) => update('tryOnAsset', next)}
              suggestedAnchor={CATEGORY_DEFAULT_ANCHOR[form.category]}
              uploads={uploads}
              error={errors.tryOnAsset}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Sharing and contact"
            subtitle="Where a customer goes when they are ready to buy."
          />
          <CardBody>
            <div className="form-grid">
              <div className="form-grid__full">
                <Field
                  label="Product page on your own website"
                  optional
                  error={errors.externalProductUrl}
                  hint="If you already sell this piece elsewhere, link to it. The storefront will offer it as “View on website”."
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      type="url"
                      inputMode="url"
                      value={form.externalProductUrl}
                      placeholder="https://your-shop.com/products/kundan-choker"
                      onChange={(event) => update('externalProductUrl', event.target.value)}
                    />
                  )}
                </Field>
              </div>

              <div className="form-grid__full">
                <Field
                  label="WhatsApp number for this product"
                  optional
                  error={errors.whatsappNumber}
                  hint={
                    store.whatsappNumber
                      ? `Leave blank to use your store number, ${store.whatsappNumber}.`
                      : 'Leave blank to use your store number once you set one in My Store.'
                  }
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      type="tel"
                      inputMode="tel"
                      value={form.whatsappNumber}
                      placeholder="+91 98200 00000"
                      onChange={(event) => update('whatsappNumber', event.target.value)}
                    />
                  )}
                </Field>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardFooter>
            <Button variant="primary" type="submit" loading={submitting}>
              {mode === 'create'
                ? isPublishing
                  ? 'Save and publish'
                  : 'Save as draft'
                : isPublishing
                  ? 'Save and publish'
                  : 'Save changes'}
            </Button>

            <Button variant="ghost" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>

            <span className="spacer" />

            <span className="text-xs text-muted">{footerNote}</span>
          </CardFooter>
        </Card>
      </div>
    </form>
  )
}
