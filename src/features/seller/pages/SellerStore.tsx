import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { PageHeader } from '@/components/ui/PageHeader'
import { LoadingAnnouncement, ProductCardSkeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { StorefrontCanvas } from '@/components/storefront/StorefrontCanvas'
import { CURRENCY_OPTIONS, slugify } from '@/lib/catalog'
import type { CurrencyKey } from '@/lib/catalog'
import { copyText } from '@/lib/clipboard'
import { pluralise } from '@/lib/format'
import { useSeller } from '../context/SellerContext'
import { useDebounced } from '../hooks/useDebounced'
import { useAction, useStorefront } from '../hooks/useProducts'
import type { ProductImage, StoreInput } from '../types/seller'
import { validateStore, type FieldErrors, type StoreField } from '../utils/validation'
import { storeUrl } from '../utils/product'
import { ImageUploadField } from '../components/ImageUploadField'
import { QrDialog } from '../components/QrDialog'

/**
 * My Store.
 *
 * Store identity on the left, the storefront it produces on the right. The preview is the real
 * `StorefrontCanvas` — the same component the public route renders — so what a seller approves here
 * is what a customer gets. It is the single most useful screen for catching a bad logo or an empty
 * description before it goes out on a QR code.
 *
 * The preview can include drafts, which is an owner-only view. A real backend must refuse that
 * unless `auth.uid() = store.seller_id` — see arch.md §7.2.
 */

type PreviewAudience = 'public' | 'owner'

interface StoreFormState {
  name: string
  slug: string
  description: string
  contactEmail: string
  contactPhone: string
  whatsappNumber: string
  currency: CurrencyKey
  logo: ProductImage | null
}

function toFormState(store: {
  name: string
  slug: string
  description: string
  contactEmail: string | null
  contactPhone: string | null
  whatsappNumber: string | null
  currency: CurrencyKey
  logoUrl: string | null
}): StoreFormState {
  return {
    name: store.name,
    slug: store.slug,
    description: store.description,
    contactEmail: store.contactEmail ?? '',
    contactPhone: store.contactPhone ?? '',
    whatsappNumber: store.whatsappNumber ?? '',
    currency: store.currency,
    logo: store.logoUrl
      ? {
          id: 'logo',
          url: store.logoUrl,
          fileName: null,
          mimeType: null,
          sizeBytes: null,
          width: null,
          height: null,
          origin: 'demo-seed',
          uploadedAt: new Date().toISOString(),
        }
      : null,
  }
}

export function SellerStore() {
  const { store, saveStore, service, isDemo } = useSeller()
  const toast = useToast()
  const { state: saving, run } = useAction()

  const [form, setForm] = useState<StoreFormState>(() => (store ? toFormState(store) : blankStore()))
  const [errors, setErrors] = useState<FieldErrors<StoreField>>({})
  const [attempted, setAttempted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [audience, setAudience] = useState<PreviewAudience>('public')

  // The live preview follows the form, not the saved store, so a seller sees the effect of a typed
  // name before committing it.
  const previewStore = useMemo(
    () => (store ? { ...store, ...form, logoUrl: form.logo?.url ?? null } : null),
    [store, form],
  )

  // Products are read from the address the store is actually saved at. The catalogue belongs to the
  // store, not to the URL being typed, and reading a half-typed slug would blank the preview — or,
  // worse, show another seller's products if that address is taken.
  const storefront = useStorefront(store?.slug, {
    includeDrafts: audience === 'owner',
  })

  const debouncedSlug = useDebounced(form.slug, 400)
  const [slugCheck, setSlugCheck] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')

  // Slug uniqueness is a database constraint; the demo adapter can only answer for the one store it
  // knows about, and says so rather than implying a platform-wide guarantee. See arch.md §7.
  useEffect(() => {
    if (!store || !service) return
    if (debouncedSlug === store.slug) {
      setSlugCheck('idle')
      return
    }
    if (!debouncedSlug) {
      setSlugCheck('idle')
      return
    }

    let active = true
    setSlugCheck('checking')
    service
      .isSlugAvailable(debouncedSlug)
      .then((available) => {
        if (active) setSlugCheck(available ? 'available' : 'taken')
      })
      .catch(() => {
        if (active) setSlugCheck('idle')
      })

    return () => {
      active = false
    }
  }, [debouncedSlug, service, store])

  if (!store || !previewStore) return null

  const publicUrl = storeUrl(previewStore)
  const dirty =
    form.name !== store.name ||
    form.slug !== store.slug ||
    form.description !== store.description ||
    form.contactEmail !== (store.contactEmail ?? '') ||
    form.contactPhone !== (store.contactPhone ?? '') ||
    form.whatsappNumber !== (store.whatsappNumber ?? '') ||
    form.currency !== store.currency ||
    (form.logo?.url ?? null) !== store.logoUrl

  function update<K extends keyof StoreFormState>(key: K, value: StoreFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    if (attempted && key in errors) {
      setErrors((current) => {
        const next = { ...current }
        delete next[key as StoreField]
        return next
      })
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setAttempted(true)
    setServerError(null)

    const input: StoreInput = {
      name: form.name,
      slug: form.slug,
      description: form.description,
      logoUrl: form.logo?.url ?? null,
      contactEmail: form.contactEmail.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
      whatsappNumber: form.whatsappNumber.trim() || null,
      currency: form.currency,
    }

    const nextErrors = validateStore(input)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      })
      return
    }

    const result = await run(() => saveStore(input))
    if (!result) {
      setServerError('Your store details could not be saved. Try again.')
      return
    }

    toast.success('Store details saved.')
    if (result.persistence === 'browser-local') {
      toast.info('Saved in this browser only — no backend is connected.')
    }
  }

  async function handleCopyLink() {
    const copied = await copyText(publicUrl)
    if (copied) {
      toast.success('Store link copied.')
    } else {
      toast.error('The browser blocked clipboard access. Open the QR dialog to copy it manually.')
    }
  }

  return (
    <>
      <PageHeader
        title="My Store"
        subtitle="How your store appears to customers, and the public link and QR code that lead to it."
        actions={
          <>
            <Button icon="copy" onClick={handleCopyLink}>
              Copy store link
            </Button>
            <Button icon="qr" onClick={() => setQrOpen(true)}>
              QR code
            </Button>
            <a
              className="btn btn--secondary"
              href={publicUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Icon name="external" size={16} />
              Open live store
            </a>
          </>
        }
      />

      <div className="grid-2">
        <div className="stack" style={{ gap: 'var(--sp-5)' }}>
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
                  title="Store profile"
                  subtitle="The name, logo and description customers see at the top of your storefront."
                />
                <CardBody>
                  <div className="form-grid">
                    <Field label="Store name" required error={errors.name}>
                      {({ id, describedBy, invalid }) => (
                        <Input
                          id={id}
                          aria-describedby={describedBy}
                          invalid={invalid}
                          value={form.name}
                          maxLength={60}
                          onChange={(event) => update('name', event.target.value)}
                        />
                      )}
                    </Field>

                    <Field
                      label="Store URL"
                      required
                      error={errors.slug}
                      hint={
                        slugCheck === 'checking'
                          ? 'Checking availability…'
                          : slugCheck === 'taken'
                            ? 'That address is already in use.'
                            : slugCheck === 'available'
                              ? 'That address is free.'
                              : 'Lowercase letters, numbers and single hyphens. Changing this breaks every link and QR code you have already shared.'
                      }
                    >
                      {({ id, describedBy, invalid }) => (
                        <div className="field-row-2">
                          <Input
                            id={id}
                            aria-describedby={describedBy}
                            invalid={invalid}
                            value={form.slug}
                            maxLength={48}
                            prefix="/s/"
                            onChange={(event) => update('slug', slugify(event.target.value))}
                          />
                          <Button
                            variant="secondary"
                            icon="refresh"
                            onClick={() => update('slug', slugify(form.name))}
                          >
                            From name
                          </Button>
                        </div>
                      )}
                    </Field>

                    <div className="form-grid__full">
                      <Field
                        label="Store description"
                        optional
                        error={errors.description}
                        hint="One or two sentences about what you make and where you ship."
                      >
                        {({ id, describedBy, invalid }) => (
                          <Textarea
                            id={id}
                            aria-describedby={describedBy}
                            invalid={invalid}
                            value={form.description}
                            maxLength={600}
                            onChange={(event) => update('description', event.target.value)}
                          />
                        )}
                      </Field>
                    </div>

                    <div className="form-grid__full">
                      <ImageUploadField
                        noun="store logo"
                        title="Store logo"
                        hint="PNG, JPEG, WebP or AVIF, up to 5 MB. Square images work best."
                        value={form.logo}
                        onChange={(next) => update('logo', next)}
                      />
                    </div>

                    <Field label="Default currency" required hint="Used for new products.">
                      {({ id, describedBy }) => (
                        <Select
                          id={id}
                          aria-describedby={describedBy}
                          value={form.currency}
                          options={CURRENCY_OPTIONS}
                          onChange={(event) => update('currency', event.target.value as CurrencyKey)}
                        />
                      )}
                    </Field>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Contact details"
                  subtitle="Where customers reach you when they are ready to buy."
                />
                <CardBody>
                  <div className="form-grid">
                    <Field
                      label="WhatsApp number"
                      optional
                      error={errors.whatsappNumber}
                      hint="Include the country code. Every product without its own number uses this one."
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

                    <Field label="Phone" optional error={errors.contactPhone}>
                      {({ id, describedBy, invalid }) => (
                        <Input
                          id={id}
                          aria-describedby={describedBy}
                          invalid={invalid}
                          type="tel"
                          inputMode="tel"
                          value={form.contactPhone}
                          placeholder="+91 22 4000 0000"
                          onChange={(event) => update('contactPhone', event.target.value)}
                        />
                      )}
                    </Field>

                    <div className="form-grid__full">
                      <Field
                        label="Contact email"
                        optional
                        error={errors.contactEmail}
                        hint="Shown on your storefront alongside the phone number."
                      >
                        {({ id, describedBy, invalid }) => (
                          <Input
                            id={id}
                            aria-describedby={describedBy}
                            invalid={invalid}
                            type="email"
                            inputMode="email"
                            value={form.contactEmail}
                            placeholder="hello@your-shop.com"
                            onChange={(event) => update('contactEmail', event.target.value)}
                          />
                        )}
                      </Field>
                    </div>
                  </div>
                </CardBody>
                <CardFooter>
                  <Button variant="primary" type="submit" loading={saving.busy} disabled={!dirty}>
                    Save store details
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!dirty || saving.busy}
                    onClick={() => {
                      setForm(toFormState(store))
                      setErrors({})
                      setAttempted(false)
                      setServerError(null)
                    }}
                  >
                    Discard changes
                  </Button>
                  <span className="spacer" />
                  <span className="text-xs text-muted">
                    {dirty ? 'Unsaved changes.' : 'All changes saved.'}
                  </span>
                </CardFooter>
              </Card>
            </div>
          </form>

          <Card>
            <CardHeader title="Public address" subtitle="What your QR code and links point at." />
            <CardBody>
              <div className="qr-url">
                <Icon name="link" size={14} />
                <span className="qr-url__text mono" title={publicUrl}>
                  {publicUrl}
                </span>
              </div>

              {form.slug !== store.slug ? (
                <div className="callout callout--warning" style={{ marginTop: 'var(--sp-4)' }}>
                  <span className="callout__icon">
                    <Icon name="alert" size={15} />
                  </span>
                  <span>
                    You are about to change your store address from <strong>/s/{store.slug}</strong> to{' '}
                    <strong>/s/{form.slug}</strong>. Links and QR codes you have already shared will
                    stop working.
                  </span>
                </div>
              ) : null}

              {isDemo ? (
                <p className="text-xs text-muted" style={{ marginTop: 'var(--sp-4)' }}>
                  In this demo the address is stored in your browser. A connected backend enforces
                  uniqueness across all stores.
                </p>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Live preview"
            subtitle="The storefront customers get from this address."
            actions={
              <div className="view-toggle" role="group" aria-label="Preview audience">
                <button
                  type="button"
                  className={`view-toggle__btn ${audience === 'public' ? 'view-toggle__btn--active' : ''}`}
                  aria-pressed={audience === 'public'}
                  onClick={() => setAudience('public')}
                >
                  <span>Public</span>
                </button>
                <button
                  type="button"
                  className={`view-toggle__btn ${audience === 'owner' ? 'view-toggle__btn--active' : ''}`}
                  aria-pressed={audience === 'owner'}
                  onClick={() => setAudience('owner')}
                >
                  <span>Include drafts</span>
                </button>
              </div>
            }
          />

          <CardBody>
            <div className="preview">
              <div className="preview__bar">
                <span className="preview__dots" aria-hidden="true">
                  <span className="preview__dot" />
                  <span className="preview__dot" />
                  <span className="preview__dot" />
                </span>
                <span className="preview__url truncate" title={publicUrl}>
                  /s/{previewStore.slug}
                </span>
                <span className="preview__live">Live preview</span>
              </div>

              <div className="preview__viewport">
                {storefront.loading ? (
                  <>
                    <LoadingAnnouncement label="Loading storefront preview" />
                    <div className="product-grid" style={{ padding: 'var(--sp-5)' }}>
                      {[0, 1, 2].map((key) => (
                        <ProductCardSkeleton key={key} />
                      ))}
                    </div>
                  </>
                ) : storefront.error ? (
                  <div className="callout callout--warning" role="alert">
                    <span className="callout__icon">
                      <Icon name="alert" size={15} />
                    </span>
                    <span>{storefront.error}</span>
                  </div>
                ) : (
                  <StorefrontCanvas
                    store={previewStore}
                    products={storefront.data?.products ?? []}
                    viewer="owner"
                    linkMode="external"
                  />
                )}
              </div>
            </div>

            <p className="text-xs text-muted" style={{ marginTop: 'var(--sp-4)' }}>
              {audience === 'owner'
                ? 'Owner view, including drafts. Customers never see drafts.'
                : 'Public view — exactly what a customer sees.'}
            </p>
          </CardBody>
        </Card>
      </div>

      <QrDialog
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title="Store QR code"
        description="Print this anywhere a customer can scan it. It opens your public storefront."
        url={publicUrl}
        fileName={`shringaar-${previewStore.slug}-store`}
        extraRows={[
          { label: 'Store', value: previewStore.name },
          {
            label: 'Products',
            value: `${pluralise(storefront.data?.products.length ?? 0, 'product')} in this preview`,
          },
        ]}
      />
    </>
  )
}

function blankStore(): StoreFormState {
  return {
    name: '',
    slug: '',
    description: '',
    contactEmail: '',
    contactPhone: '',
    whatsappNumber: '',
    currency: 'INR',
    logo: null,
  }
}
