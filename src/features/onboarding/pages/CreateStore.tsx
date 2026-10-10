import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { readImageFile, validateImageFile } from '@/lib/files'
import { normaliseWhatsApp } from '@/lib/catalog'
import { isServiceError } from '@/features/seller/types/seller'
import { useUploadKit } from '@/features/seller/hooks/useUploadKit'
import { LIMITS } from '@/features/seller/utils/validation'
import { MarketingShell, OnboardingHeader } from '@/features/marketing/components/MarketingShell'
import { SessionLoading, useOnboardingSession } from '../components/SessionGate'
import { paths } from '@/routes/paths'

/**
 * Create your store.
 *
 * Three of these four fields are optional, and they are grouped below the one that is not, under a
 * heading that says so. A seller setting up at a shop counter should be able to type a name, tap
 * Continue and start photographing stock — every extra required field is a reason to close the tab
 * and do this later, which means never.
 *
 * The store URL is derived from the name rather than asked for. It stays editable on the store
 * screen, where there is room to explain what a URL is; here it would be a fourth decision standing
 * between the seller and their first product.
 */

export function CreateStore() {
  const { seller, store, loading, landing, createStore } = useOnboardingSession()
  const navigate = useNavigate()
  const logoInput = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [logo, setLogo] = useState<string | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)

  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logoError, setLogoError] = useState<string | null>(null)

  // No `productId`: a logo belongs to the brand, not to any product, so it goes to its own bucket.
  const uploads = useUploadKit()

  useDocumentTitle('Create your store — Shringaar')

  // Nothing on this screen can be written without a session: the store row's owner is the caller's
  // own user id, and Row Level Security reads it from the session rather than from anything this
  // form sends. So a visitor arriving from the landing page's "create your store" is sent through
  // account creation first — carrying the intent with them, so they come back to this form rather
  // than to a generic sign-in.
  if (loading) {
    return <SessionLoading />
  }

  if (!seller) {
    return (
      <Navigate
        to={paths.marketing.signIn}
        replace
        state={{ from: paths.onboarding.store, mode: 'signUp' }}
      />
    )
  }

  // A store that already exists means this step is done, and `landingPathFor` says how far past it
  // the seller is: a finished shop goes to the dashboard, one that stopped halfway resumes where it
  // stopped. `busy` suppresses this during a submit, because the store appearing in state is this
  // screen's own success rather than a reason to leave it.
  if (store && !busy) {
    return <Navigate to={landing} replace />
  }

  const nameError =
    name.trim().length === 0
      ? 'Your store needs a name.'
      : name.trim().length < LIMITS.storeName.min
        ? `Use at least ${LIMITS.storeName.min} characters.`
        : name.trim().length > LIMITS.storeName.max
          ? `Keep it under ${LIMITS.storeName.max} characters.`
          : undefined

  const whatsappError =
    whatsapp.trim() && normaliseWhatsApp(whatsapp).length < LIMITS.whatsappMinDigits
      ? 'Enter the full number including the country code.'
      : undefined

  async function handleLogo(file: File | undefined) {
    if (!file) return

    const invalid = validateImageFile(file)
    if (invalid) {
      setLogoError(invalid)
      return
    }

    setLogoBusy(true)
    setLogoError(null)

    try {
      // With storage the logo is a file in a bucket and only its URL is saved. Without it the bytes
      // become a data URL held in this browser — which is fine for a demo, and would be a mistake to
      // write into `stores.logo_url` in a real one: it is read on every storefront and every store
      // read, and megabytes of base64 in a `text` column is the sort of thing that only hurts once
      // there are a few hundred stores.
      if (uploads.storeLogo) {
        const stored = await uploads.storeLogo(file, () => {})
        setLogo(stored.url)
      } else {
        const read = await readImageFile(file)
        setLogo(read.dataUrl)
      }
    } catch (cause) {
      setLogoError(
        isServiceError(cause)
          ? cause.message
          : 'That file could not be read. Try another image.',
      )
    } finally {
      setLogoBusy(false)
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitted(true)

    if (nameError || whatsappError) return

    setBusy(true)
    setError(null)

    try {
      await createStore({
        name,
        city: city.trim() || null,
        logoUrl: logo,
        whatsappNumber: whatsapp.trim() || null,
      })
      navigate(paths.onboarding.ready, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The store could not be created. Try again.')
      setBusy(false)
    }
  }

  return (
    <MarketingShell footer={false} nav={false}>
      <div className="mk-step">
        <div className="mk-step__card">
          <OnboardingHeader label="Set up your store" />

          <form onSubmit={(event) => void handleSubmit(event)}>
            <h1 className="mk-step__title">
              Set up your store
              <span className="mk-mute"> — it takes one field.</span>
            </h1>

            <p className="mk-step__sub">
              This is what customers see at the top of your storefront. You can change any of it
              later from Store settings.
            </p>

            <div className="mk-step__body">
              <Field
                label="Store name"
                required
                error={submitted ? nameError : undefined}
                hint="Your shop name, as your customers know it."
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    value={name}
                    autoFocus
                    maxLength={LIMITS.storeName.max}
                    placeholder="e.g. Meena Jewels"
                    aria-describedby={describedBy}
                    invalid={invalid || Boolean(submitted && nameError)}
                    onChange={(event) => setName(event.target.value)}
                  />
                )}
              </Field>

              <div className="mk-subhead">
                <h2>Optional</h2>
                <p>Skip anything you do not have to hand. None of it blocks you starting.</p>
              </div>

              <Field label="Store logo" optional error={logoError ?? undefined}>
                {({ id }) => (
                  <div className="mk-logo-upload">
                    <span className="mk-logo-upload__preview" aria-hidden="true">
                      {logo ? (
                        <img src={logo} alt="" />
                      ) : (
                        <Icon name="image" size={18} />
                      )}
                    </span>

                    <div className="mk-logo-upload__side">
                      <input
                        ref={logoInput}
                        id={id}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/avif"
                        className="sr-only"
                        onChange={(event) => void handleLogo(event.target.files?.[0])}
                      />
                      <Button
                        type="button"
                        size="sm"
                        loading={logoBusy}
                        icon="upload"
                        onClick={() => logoInput.current?.click()}
                      >
                        {logo ? 'Replace logo' : 'Choose a logo'}
                      </Button>

                      {logo ? (
                        <button
                          type="button"
                          className="mk-linkbtn"
                          onClick={() => {
                            setLogo(null)
                            if (logoInput.current) logoInput.current.value = ''
                          }}
                        >
                          Remove
                        </button>
                      ) : (
                        <span className="mk-hint">Square images work best.</span>
                      )}
                    </div>
                  </div>
                )}
              </Field>

              <Field label="City" optional hint="Where your shop trades from.">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    value={city}
                    maxLength={60}
                    placeholder="e.g. Jaipur"
                    aria-describedby={describedBy}
                    onChange={(event) => setCity(event.target.value)}
                  />
                )}
              </Field>

              <Field
                label="WhatsApp business number"
                optional
                error={submitted ? whatsappError : undefined}
                hint="Customers message you here. Include the country code."
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    type="tel"
                    value={whatsapp}
                    inputMode="tel"
                    placeholder="+91 98200 00000"
                    aria-describedby={describedBy}
                    invalid={invalid || Boolean(submitted && whatsappError)}
                    onChange={(event) => setWhatsapp(event.target.value)}
                  />
                )}
              </Field>
            </div>

            {error ? (
              <div className="mk-note mk-note--error" role="alert">
                <Icon name="alert" size={15} />
                <span>{error}</span>
              </div>
            ) : null}

            <div className="mk-step__actions">
              <Button type="submit" variant="primary" size="lg" loading={busy}>
                Continue
              </Button>
              <Link className="mk-linkbtn" to={paths.root}>
                Not now
              </Link>
            </div>
          </form>
        </div>
      </div>
    </MarketingShell>
  )
}
