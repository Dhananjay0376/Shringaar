import { useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { createId } from '@/lib/id'
import { readImageFile, validateImageFile } from '@/lib/files'
import { CATEGORIES, currencySymbol, GUIDED_CATEGORY_OPTIONS, type CategoryKey } from '@/lib/catalog'
import { formatCurrency } from '@/lib/format'
import { useAction } from '@/features/seller/hooks/useProducts'
import { useUploadKit } from '@/features/seller/hooks/useUploadKit'
import { LIMITS } from '@/features/seller/utils/validation'
import type { Product, ProductImage, ProductInput } from '@/features/seller/types/seller'
import { isServiceError } from '@/features/seller/types/seller'
import { MarketingShell, OnboardingHeader } from '@/features/marketing/components/MarketingShell'
import { SessionLoading, useOnboardingSession } from '../components/SessionGate'
import { paths } from '@/routes/paths'

/**
 * Add your jewellery — the guided bulk uploader.
 *
 * This screen exists because of how the work actually happens. A seller does not add one product;
 * they tip out a tray of earrings and photograph thirty of them in a row. So the flow is built
 * around a *category batch*: pick a category, photograph everything in it, then move to the next
 * category. Every piece is saved the moment the seller says they are done with it, so a phone that
 * dies at piece twenty-eight has still kept twenty-seven.
 *
 * Three decisions worth knowing about:
 *
 *  · price appears only once there is a photograph. Asking for a price next to an empty frame is
 *    asking the seller to hold two things in their head at once, and the piece in front of them is
 *    what the price belongs to.
 *  · description is optional here. In a bulk flow a required description is the field that makes a
 *    seller give up; a piece with a name, a photo and a price is already sellable, and the name
 *    stands in until they have time to write something better.
 *  · pieces are published, not drafted. They have everything a storefront tile needs, and a seller
 *    who has just photographed thirty earrings does not want to be told they are invisible.
 */

type Phase = 'details' | 'categories' | 'done'

const PHASE_STEP: Record<Phase, number> = { details: 1, categories: 2, done: 3 }

export function BatchProducts() {
  const { store, loading, landing, service } = useOnboardingSession()
  const navigate = useNavigate()
  const { state: action, run, reset } = useAction()

  const uploadInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)

  const [phase, setPhase] = useState<Phase>('details')
  // Earrings first: they are the most common tray a seller photographs, and the flow should open on
  // the likeliest answer rather than an empty chooser.
  const [category, setCategory] = useState<CategoryKey>('earrings')

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [image, setImage] = useState<ProductImage | null>(null)
  const [price, setPrice] = useState('')

  /** Everything added in this sitting, so the seller can see the tray emptying into the store. */
  const [added, setAdded] = useState<Product[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  // The piece does not exist until it is saved, so the photo is scoped by the auth user id alone.
  // Without storage the kit is empty and a photo stays a browser preview, which is what the demo
  // screen says under the frame.
  const uploads = useUploadKit()

  useDocumentTitle('Add your jewellery — Shringaar')

  const countsByCategory = useMemo(() => {
    const counts = new Map<CategoryKey, number>()
    for (const product of added) {
      counts.set(product.category, (counts.get(product.category) ?? 0) + 1)
    }
    return counts
  }, [added])

  const currency = store?.currency ?? 'INR'

  if (loading) {
    return <SessionLoading />
  }

  // Nothing can be saved without a store — a product's owner *is* its store's owner, and Row Level
  // Security resolves that from the session. `landing` names where the seller is actually up to:
  // sign-in with no session, the store form with no store.
  if (!store) {
    return <Navigate to={landing} replace />
  }

  /* ── Validation ────────────────────────────────────────────────────────── */

  const nameError =
    name.trim().length < LIMITS.productName.min
      ? 'Give the piece a name — even "Gold jhumka" is enough.'
      : name.trim().length > LIMITS.productName.max
        ? `Keep the name under ${LIMITS.productName.max} characters.`
        : undefined

  const priceValue = Number(price)
  const priceError = !price.trim()
    ? 'Enter a price.'
    : !Number.isFinite(priceValue) || priceValue <= 0
      ? 'Enter a price greater than 0.'
      : priceValue > LIMITS.priceMax
        ? 'That price looks too high. Check it.'
        : undefined

  const imageError = image ? undefined : 'Add a photo of the piece.'
  const canSave = !nameError && !priceError && !imageError

  /* ── Photo capture ─────────────────────────────────────────────────────── */

  async function handlePhoto(file: File | undefined) {
    if (!file) return

    const invalid = validateImageFile(file)
    if (invalid) {
      setPhotoError(invalid)
      return
    }

    setReading(true)
    setPhotoError(null)

    try {
      // With storage the bytes go to a bucket straight away; without it they stay in this browser
      // tab. `origin` records which, so nothing downstream can mistake a local preview for a stored
      // object (arch.md §7.4).
      if (uploads.image) {
        const stored = await uploads.image(file, () => {})
        setImage({ id: createId('img'), width: null, height: null, ...stored })
      } else {
        const read = await readImageFile(file)
        setImage({
          id: createId('img'),
          url: read.dataUrl,
          fileName: read.fileName,
          mimeType: read.mimeType,
          sizeBytes: read.sizeBytes,
          width: read.width,
          height: read.height,
          origin: 'local-preview',
          uploadedAt: new Date().toISOString(),
        })
      }

      setSubmitted(false)
    } catch (cause) {
      setPhotoError(
        isServiceError(cause)
          ? cause.message
          : 'That image could not be read. Try taking the photo again.',
      )
    } finally {
      setReading(false)
      // Reset both inputs so choosing the same file twice still fires a change event.
      if (uploadInput.current) uploadInput.current.value = ''
      if (cameraInput.current) cameraInput.current.value = ''
    }
  }

  function clearPhoto() {
    setImage(null)
    setPrice('')
  }

  /* ── Saving one piece ──────────────────────────────────────────────────── */

  async function savePiece(): Promise<boolean> {
    setSubmitted(true)
    if (!canSave || !image) return false

    const input: ProductInput = {
      name: name.trim(),
      // A blank description falls back to the piece name rather than an empty string, so the
      // storefront and the collection grid never render a heading with nothing under it.
      description: description.trim() || name.trim(),
      price: priceValue,
      currency,
      category,
      status: 'published',
      image,
      // Photographing a piece does not create a 3D model, and this flow must not imply it does.
      // Try-on assets are added later, from the product screen, by uploading a real .glb or .usdz.
      tryOnAsset: null,
      externalProductUrl: null,
      whatsappNumber: null,
    }

    const created = await run(() => service!.createProduct(input))
    if (!created) return false

    setAdded((previous) => [created.data, ...previous])
    return true
  }

  function resetDraft() {
    setName('')
    setDescription('')
    setImage(null)
    setPrice('')
    setSubmitted(false)
    setPhotoError(null)
    reset()
  }

  async function handleContinueClicking() {
    const saved = await savePiece()
    if (!saved) return

    resetDraft()
    setName('')
    // The camera is the whole point of this button; open it straight away so the seller's next
    // action after "continue clicking pictures" is literally clicking a picture.
    cameraInput.current?.click()
  }

  async function handleFinishCategory() {
    const saved = await savePiece()
    if (!saved) return

    resetDraft()
    setPhase('categories')
  }

  function chooseCategory(next: CategoryKey) {
    setCategory(next)
    resetDraft()
    setPhase('details')
  }

  const step = PHASE_STEP[phase]
  const stepLabels: Record<Phase, string> = {
    details: 'Step 1 of 3 · Product details',
    categories: 'Step 2 of 3 · Choose the next category',
    done: 'Step 3 of 3 · Ready to open',
  }

  const queue = added.filter((product) => product.category === category)

  return (
    <MarketingShell footer={false} nav={false}>
      <div className="mk-step mk-step--wide">
        <div className="mk-step__card">
          <OnboardingHeader
            label={stepLabels[phase]}
            backTo={phase === 'details' ? paths.onboarding.ready : undefined}
          />

          <ol className="mk-progress" aria-label={`Step ${step} of 3`}>
            {[1, 2, 3].map((n) => (
              <li
                key={n}
                className={`mk-progress__seg${n <= step ? ' mk-progress__seg--done' : ''}`}
                aria-current={n === step ? 'step' : undefined}
              />
            ))}
            <li className="mk-progress__label">
              {added.length} added
            </li>
          </ol>

          {/* ── Phase 1: the piece in hand ──────────────────────────────────── */}
          {phase === 'details' ? (
            <>
              <h1 className="mk-step__title">
                Add your jewellery
                <span className="mk-mute"> — one piece at a time.</span>
              </h1>

              <p className="mk-step__sub">
                You are adding to <strong>{CATEGORIES[category]}</strong>. Keep going until the tray
                is empty, then move to the next category.
              </p>

              <div className="mk-catpick" role="group" aria-label="Category">
                {GUIDED_CATEGORY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`mk-catchip${option.value === category ? ' mk-catchip--on' : ''}`}
                    aria-pressed={option.value === category}
                    onClick={() => setCategory(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="mk-step__body">
                <Field
                  label="Product name"
                  required
                  error={submitted ? nameError : undefined}
                  hint="What you would call it to a customer."
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      value={name}
                      maxLength={LIMITS.productName.max}
                      placeholder="e.g. Traditional gold-tone jhumka"
                      aria-describedby={describedBy}
                      invalid={invalid || Boolean(submitted && nameError)}
                      onChange={(event) => setName(event.target.value)}
                    />
                  )}
                </Field>

                <Field
                  label="Description"
                  optional
                  hint="Skip it if you are in a hurry — we will use the name until you add one."
                >
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      value={description}
                      rows={3}
                      maxLength={LIMITS.productDescription.max}
                      placeholder="e.g. Traditional gold-tone jhumka with pearl detailing."
                      aria-describedby={describedBy}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  )}
                </Field>

                {/* Photo, then price. The order is the point: the seller is looking at the piece,
                    and the price belongs to the thing in front of them, not to an empty frame. */}
                <div className="mk-subhead">
                  <h2>Photograph of the piece</h2>
                  <p>Clear image recommended — plain background, even light, the piece filling most of the frame.</p>
                </div>

                <input
                  ref={uploadInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  className="sr-only"
                  onChange={(event) => void handlePhoto(event.target.files?.[0])}
                />
                <input
                  ref={cameraInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(event) => void handlePhoto(event.target.files?.[0])}
                />

                {image ? (
                  <figure className="mk-shot">
                    <img className="mk-shot__img" src={image.url} alt={`Photograph of ${name || 'the piece'}`} />
                    <figcaption className="mk-shot__side">
                      <span className="mk-shot__name">{image.fileName ?? 'Photo'}</span>
                      <span className="mk-hint">
                        {image.width && image.height ? `${image.width} × ${image.height}px` : 'Image ready'}
                        {image.sizeBytes ? ` · ${Math.round(image.sizeBytes / 1024)} KB` : ''}
                      </span>
                      <div className="mk-shot__actions">
                        <Button size="sm" icon="camera" onClick={() => cameraInput.current?.click()}>
                          Retake
                        </Button>
                        <Button size="sm" icon="upload" onClick={() => uploadInput.current?.click()}>
                          Replace
                        </Button>
                        <button type="button" className="mk-linkbtn" onClick={clearPhoto}>
                          Remove
                        </button>
                      </div>
                    </figcaption>
                  </figure>
                ) : (
                  <div className="mk-dropgroup">
                    <button
                      type="button"
                      className="mk-drop"
                      disabled={reading}
                      onClick={() => cameraInput.current?.click()}
                    >
                      <span className="mk-drop__icon" aria-hidden="true">
                        <Icon name="camera" size={22} />
                      </span>
                      <span className="mk-drop__title">
                        {reading ? (uploads.image ? 'Uploading the photo…' : 'Reading the photo…') : 'Take a photo'}
                      </span>
                      <span className="mk-drop__note">Clear image recommended</span>
                    </button>

                    <button
                      type="button"
                      className="mk-drop"
                      disabled={reading}
                      onClick={() => uploadInput.current?.click()}
                    >
                      <span className="mk-drop__icon" aria-hidden="true">
                        <Icon name="upload" size={22} />
                      </span>
                      <span className="mk-drop__title">Upload jewellery photo</span>
                      <span className="mk-drop__note">Clear image recommended</span>
                    </button>
                  </div>
                )}

                {photoError ? (
                  <p className="field__error" role="alert">
                    <Icon name="alert" size={13} />
                    <span>{photoError}</span>
                  </p>
                ) : submitted && imageError ? (
                  <p className="field__error" role="alert">
                    <Icon name="alert" size={13} />
                    <span>{imageError}</span>
                  </p>
                ) : null}

                {image ? (
                  <Field label={`Price (${currency})`} required error={submitted ? priceError : undefined}>
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        type="number"
                        value={price}
                        min={1}
                        step="1"
                        inputMode="decimal"
                        autoFocus
                        placeholder="e.g. 2450"
                        prefix={currencySymbol(currency)}
                        aria-describedby={describedBy}
                        invalid={invalid || Boolean(submitted && priceError)}
                        onChange={(event) => setPrice(event.target.value)}
                      />
                    )}
                  </Field>
                ) : (
                  <p className="mk-hint mk-hint--block">
                    The price comes next — it is easier to set once you can see the piece.
                  </p>
                )}

                {action.error ? (
                  <p className="field__error" role="alert">
                    <Icon name="alert" size={13} />
                    <span>{action.error}</span>
                  </p>
                ) : null}
              </div>

              {queue.length > 0 ? (
                <div className="mk-queue">
                  <p className="mk-queue__head">
                    {queue.length} {CATEGORIES[category].toLowerCase()} added so far
                  </p>
                  <div className="mk-tiles">
                    {queue.map((product) => (
                      <div className="mk-tile" key={product.id}>
                        {product.image ? (
                          <img className="mk-tile__img" src={product.image.url} alt="" />
                        ) : null}
                        <div className="mk-tile__body">
                          <p className="mk-tile__name">{product.name}</p>
                          <p className="mk-tile__price">
                            {formatCurrency(product.price, product.currency)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mk-step__actions">
                <Button
                  variant="primary"
                  size="lg"
                  loading={action.busy}
                  onClick={() => void handleContinueClicking()}
                >
                  Continue clicking pictures
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  disabled={action.busy}
                  onClick={() => void handleFinishCategory()}
                >
                  Finish up this category
                </Button>
              </div>

              {submitted && !canSave ? (
                <p className="mk-hint mk-hint--block">
                  A piece needs a name, a photo and a price before it can be saved.
                </p>
              ) : null}
            </>
          ) : null}

          {/* ── Phase 2: the next category ──────────────────────────────────── */}
          {phase === 'categories' ? (
            <>
              <h1 className="mk-step__title">
                That is {CATEGORIES[category].toLowerCase()} done.
                <span className="mk-mute"> What is next on the tray?</span>
              </h1>

              <p className="mk-step__sub">
                Pick the next category and keep going, or finish here — everything you have added is
                already saved.
              </p>

              <div className="mk-step__body">
                <div className="mk-cats">
                  {GUIDED_CATEGORY_OPTIONS.map((option) => {
                    const count = countsByCategory.get(option.value) ?? 0
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`mk-cat${count > 0 ? ' mk-cat--done' : ''}`}
                        onClick={() => chooseCategory(option.value)}
                      >
                        <span className="mk-cat__top">
                          <span className="mk-cat__name">{option.label}</span>
                          {count > 0 ? <Icon name="check" size={15} /> : null}
                        </span>
                        <span className="mk-cat__meta">
                          {count === 0
                            ? 'Nothing added yet'
                            : `${count} ${count === 1 ? 'piece' : 'pieces'} added`}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <p className="mk-hint mk-hint--block">
                  Selling something that is not listed here?{' '}
                  <Link to={paths.seller.addProduct}>Use the full product form</Link> — it has every
                  category, including rings, bangles and sets.
                </p>
              </div>

              <div className="mk-step__actions">
                <Button variant="primary" size="lg" onClick={() => setPhase('done')}>
                  I have finished adding jewellery
                </Button>
                <Button variant="ghost" size="lg" onClick={() => chooseCategory(category)}>
                  Add another to {CATEGORIES[category].toLowerCase()}
                </Button>
              </div>
            </>
          ) : null}

          {/* ── Phase 3: what was added ─────────────────────────────────────── */}
          {phase === 'done' ? (
            <>
              <span className="mk-ready" aria-hidden="true">
                <Icon name="check" size={26} />
              </span>

              <h1 className="mk-step__title">
                {added.length === 0
                  ? 'Nothing added yet.'
                  : `${added.length} ${added.length === 1 ? 'piece is' : 'pieces are'} in your store.`}
                <span className="mk-mute">
                  {added.length === 0
                    ? ' You can start whenever you are ready.'
                    : ' Your dashboard is ready.'}
                </span>
              </h1>

              <p className="mk-step__sub">
                Each one has its own page and its own QR code. You can add more at any time — the
                uploader picks up exactly where this left off.
              </p>

              {added.length > 0 ? (
                <ul className="mk-summary">
                  {[...countsByCategory.entries()].map(([key, count]) => (
                    <li key={key}>
                      <span>{CATEGORIES[key]}</span>
                      <span className="tabular">{count}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mk-step__actions">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => navigate(paths.seller.dashboard, { replace: true })}
                >
                  Go to my dashboard
                </Button>
                <Button variant="ghost" size="lg" onClick={() => setPhase('details')}>
                  Add more jewellery
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </MarketingShell>
  )
}
