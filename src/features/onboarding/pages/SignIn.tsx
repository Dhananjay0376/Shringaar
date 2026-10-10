import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { LoadingAnnouncement } from '@/components/ui/Skeleton'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useProducts } from '@/features/seller/hooks/useProducts'
import { useSeller } from '@/features/seller/context/SellerContext'
import { landingPathFor } from '@/features/seller/utils/landing'
import { readOAuthError, type OAuthError } from '@/features/seller/utils/oauth'
import { isValidEmail } from '@/features/seller/utils/validation'
import { MarketingShell } from '@/features/marketing/components/MarketingShell'
import { GoogleMark } from '../components/GoogleMark'
import { type AuthRequest } from '../components/SessionGate'
import { paths } from '@/routes/paths'

/**
 * Sign in, or create the account that comes before a store.
 *
 * There are two shapes of this screen and which one renders is decided by
 * `capabilities.auth` — never by a build flag or a guess. When the backend verifies a credential
 * there is an email and a password and two modes; when it does not (the browser-local demo store)
 * there is an email and nothing to verify, so asking for a password would teach the seller that the
 * box is decorative, which is a habit that outlives the demo.
 *
 * The demo branch below is the two-step flow this screen has always had: name the email, then see
 * what that email is attached to — store name, city, how many pieces — so that "open my dashboard"
 * is a decision made with the facts on show rather than a leap. It is kept as it was.
 *
 * The credential branch is new, and its one non-obvious rule is that it does not navigate from its
 * own submit handler. After a successful sign-in the context has the seller and the store, but the
 * handler's closure does not, and reading a stale `store` to pick a destination is how a seller with
 * a half-finished shop gets sent to a dashboard that will bounce them straight back. So the handler
 * stops at "this worked" and the render guard below chooses the destination from state that has
 * actually updated. See `landingPathFor`.
 */

type AuthMode = 'signIn' | 'signUp'

/** The one way into this screen, so the two branches cannot render two different doors. */
function BrandMark() {
  return (
    <Link className="mk-logo" to={paths.root}>
      <span className="mk-logo__mark" aria-hidden="true">
        श
      </span>
      Shringaar
    </Link>
  )
}

export function SellerSignIn() {
  const { capabilities } = useSeller()

  return capabilities.auth ? <CredentialSignIn /> : <DemoSignIn />
}

/* ── Connected backend: a real credential ────────────────────────────────── */

function CredentialSignIn() {
  const { capabilities, seller, store, loading, signIn, signUp, signInWithGoogle } = useSeller()
  const location = useLocation()

  const state = (location.state as AuthRequest | null) ?? null
  const from = state?.from ?? null

  const [mode, setMode] = useState<AuthMode>(state?.mode ?? 'signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Errors stay hidden until the seller has actually tried to submit — see design.md §7. */
  const [submitted, setSubmitted] = useState(false)
  /** Set when a sign-up was accepted but the project still wants the email confirmed. */
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)

  /**
   * A failed provider sign-in lands here as a fresh page with the reason in the URL, because there
   * is nothing to catch: the redirect replaced the document. Read once, into state, so the message
   * survives the URL being tidied up below.
   */
  const [oauthError, setOauthError] = useState<OAuthError | null>(() =>
    readOAuthError(window.location.search, window.location.hash),
  )

  /**
   * Clears a failed return out of the address bar.
   *
   * Only ever runs when there was an error, which is what makes it safe: a *successful* return also
   * carries parameters, and those are the authorization code supabase-js is still exchanging. Left
   * alone, a seller who reloads would be told about a failure they had already read and moved past.
   */
  useEffect(() => {
    if (!oauthError) return

    const url = new URL(window.location.href)
    for (const key of ['error', 'error_code', 'error_description']) {
      url.searchParams.delete(key)
    }
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [oauthError])

  useDocumentTitle(mode === 'signUp' ? 'Create your account — Shringaar' : 'Sign in — Shringaar')

  const emailError = useMemo(() => {
    if (!email.trim()) return 'Enter your email address.'
    if (!isValidEmail(email)) return 'That does not look like an email address. Check it and try again.'
    return undefined
  }, [email])

  const passwordError = useMemo(() => {
    if (!password) return 'Enter your password.'
    // Six is the floor Supabase projects ship with; the database refuses shorter ones anyway, and
    // saying so here is kinder than a round trip that reports the same thing.
    if (mode === 'signUp' && password.length < 6) return 'Use at least 6 characters.'
    return undefined
  }, [password, mode])

  /**
   * Where a signed-in seller belongs. A `from` is only honoured once the store is actually finished:
   * a seller who was turned away from a deep link and has since signed in to a half-built store
   * needs the next setup step, not the URL they once asked for. `landingPathFor` decides that, and
   * this only lets a completed store override it with the more specific destination.
   */
  const destination = from && store?.onboardingCompleted ? from : landingPathFor(seller, store)

  function switchMode(next: AuthMode) {
    setMode(next)
    // The password belongs to the mode: carrying a new-account password over into a sign-in attempt
    // would submit it against an account that may not have it.
    setPassword('')
    setSubmitted(false)
    setError(null)
    setPendingEmail(null)
    // A failure from the provider has nothing to do with the mode being switched to, and leaving it
    // on screen would read as though the new form had already rejected something.
    setOauthError(null)
  }

  /**
   * Starts the provider sign-in. This function normally does not finish.
   *
   * On success the browser is already navigating to Google, so the `finally` below runs at best
   * momentarily and the catch is only for the case where the redirect never happened — a provider
   * left disabled on the project, or a request that could not be made.
   */
  async function handleGoogle() {
    setGoogleBusy(true)
    setError(null)
    setOauthError(null)

    try {
      await signInWithGoogle()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work. Try again.')
    } finally {
      setGoogleBusy(false)
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitted(true)

    if (emailError || passwordError) return

    setBusy(true)
    setError(null)

    const address = email.trim()

    try {
      if (mode === 'signUp') {
        const outcome = await signUp({ email: address, password })

        // The account exists but has no session until the emailed link is followed. Nothing failed —
        // it is a different next step, so it gets a screen rather than a red message.
        if (outcome.status === 'confirmation-required') {
          setPendingEmail(address)
          return
        }
      } else {
        await signIn({ email: address, password })
      }

      // Deliberately no `navigate` here — see the note at the top of this file. The guard below
      // redirects on the re-render that follows, once the context holds the real store.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  // Deciding where to send a seller requires knowing whether they have a session at all, and the
  // context starts empty. Rendering the form first would flash a sign-in at someone already signed
  // in, then yank it away.
  if (loading) {
    return (
      <MarketingShell footer={false}>
        <div className="mk-step">
          <div className="mk-step__card mk-step__card--centre">
            <LoadingAnnouncement label="Checking your session" />
          </div>
        </div>
      </MarketingShell>
    )
  }

  // Also the post-submit path, and the path taken when a confirmation link opened in this tab turns
  // into a session: both are simply "there is a seller now", which is the condition to act on.
  if (seller && !busy) {
    return <Navigate to={destination} replace />
  }

  if (pendingEmail) {
    return (
      <MarketingShell footer={false}>
        <div className="mk-step">
          <div className="mk-step__card mk-step__card--centre">
            <span className="mk-ready" aria-hidden="true">
              <Icon name="mail" size={26} />
            </span>

            <h1 className="mk-step__title">
              Check your email.<span className="mk-mute"> One link and you are in.</span>
            </h1>

            <p className="mk-step__sub">
              We sent a confirmation link to <strong>{pendingEmail}</strong>. Open it and your store
              setup carries on from where it was.
            </p>

            <div className="mk-step__actions mk-step__actions--centre">
              <Button variant="secondary" size="lg" onClick={() => switchMode('signIn')}>
                Back to sign in
              </Button>
            </div>

            <p className="mk-step__alt">
              Wrong address?{' '}
              <button type="button" className="mk-linkbtn" onClick={() => switchMode('signUp')}>
                Use a different one
              </button>
            </p>
          </div>
        </div>
      </MarketingShell>
    )
  }

  const shownEmailError = submitted ? emailError : undefined
  const shownPasswordError = submitted ? passwordError : undefined
  /* A credential error is the more recent of the two when both are set, so it wins. */
  const problem = error ?? oauthError?.message ?? null

  return (
    <MarketingShell footer={false}>
      <div className="mk-step">
        <div className="mk-step__card">
          <div className="mk-step__head">
            <BrandMark />
          </div>

          <form onSubmit={(event) => void handleSubmit(event)}>
            <h1 className="mk-step__title">
              {mode === 'signUp' ? (
                <>
                  Open your shop.
                  <span className="mk-mute"> It starts with an account.</span>
                </>
              ) : (
                <>
                  Welcome back.
                  <span className="mk-mute"> Sign in to your store.</span>
                </>
              )}
            </h1>

            <p className="mk-step__sub">
              {mode === 'signUp'
                ? 'Naming your store and adding your first pieces comes next — this is just the door.'
                : 'Use the email address you signed up with.'}
            </p>

            {/* Offered before the form rather than after it: for a seller who already has a Google
                account this is the whole sign-in, and putting it below two fields would ask them to
                read past the longer path to find the shorter one. It creates the account when there
                is not one, which is why one label covers both modes. */}
            {capabilities.oauth ? (
              <>
                <div className="mk-step__body">
                  <button
                    type="button"
                    className="mk-oauth"
                    onClick={() => void handleGoogle()}
                    disabled={googleBusy || busy}
                  >
                    <GoogleMark size={18} />
                    {googleBusy ? 'Opening Google…' : 'Continue with Google'}
                  </button>
                </div>

                <p className="mk-or" role="presentation">
                  or
                </p>
              </>
            ) : null}

            <div className="mk-step__body">
              <Field label="Email address" required error={shownEmailError}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    type="email"
                    value={email}
                    autoComplete="email"
                    inputMode="email"
                    autoFocus
                    placeholder="you@example.com"
                    aria-describedby={describedBy}
                    invalid={invalid || Boolean(shownEmailError)}
                    onChange={(event) => {
                      setEmail(event.target.value)
                      setError(null)
                    }}
                  />
                )}
              </Field>

              <Field
                label="Password"
                required
                error={shownPasswordError}
                hint={mode === 'signUp' ? 'At least 6 characters.' : undefined}
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    type="password"
                    value={password}
                    // Tells the browser's password manager which of the two it is looking at, so it
                    // offers a saved credential on sign-in and a generated one on sign-up.
                    autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                    placeholder="••••••••"
                    aria-describedby={describedBy}
                    invalid={invalid || Boolean(shownPasswordError)}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setError(null)
                    }}
                  />
                )}
              </Field>
            </div>

            {problem ? (
              <div className="mk-note mk-note--error" role="alert">
                <Icon name="alert" size={15} />
                <span>{problem}</span>
              </div>
            ) : null}

            <div className="mk-step__actions">
              <Button type="submit" variant="primary" size="lg" loading={busy}>
                {mode === 'signUp' ? 'Create account' : 'Sign in'}
                {!busy ? <Icon name="chevronRight" size={15} /> : null}
              </Button>
            </div>
          </form>

          <p className="mk-step__alt">
            {mode === 'signUp' ? (
              <>
                Already have a store?{' '}
                <button type="button" className="mk-linkbtn" onClick={() => switchMode('signIn')}>
                  Sign in
                </button>
              </>
            ) : (
              <>
                New here?{' '}
                <button type="button" className="mk-linkbtn" onClick={() => switchMode('signUp')}>
                  Create your store
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </MarketingShell>
  )
}

/* ── Browser-local demo: no credential exists to check ───────────────────── */

function DemoSignIn() {
  const { seller, store, isDemo, signIn } = useSeller()
  const navigate = useNavigate()
  const location = useLocation()
  const products = useProducts()

  const [step, setStep] = useState<'email' | 'details'>('email')
  const [email, setEmail] = useState(seller?.email ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useDocumentTitle('Sign in — Shringaar')

  const from = (location.state as AuthRequest | null)?.from ?? null
  const productCount = products.data?.length ?? 0

  const emailError = useMemo(() => {
    if (!email.trim()) return 'Enter your email address.'
    if (!isValidEmail(email)) return 'That does not look like an email address. Check it and try again.'
    return undefined
  }, [email])

  // Already signed in and past the email step: nothing to sign in to.
  if (seller && step === 'email' && !busy) {
    return <Navigate to={from ?? landingPathFor(seller, store)} replace />
  }

  async function handleContinue() {
    setSubmitted(true)

    if (emailError) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      await signIn({ email: email.trim() })
      setStep('details')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const shownError = (submitted ? (error ?? emailError) : error) ?? undefined

  return (
    <MarketingShell footer={false}>
      <div className="mk-step">
        <div className="mk-step__card">
          {step === 'email' ? (
            <>
              <div className="mk-step__head">
                <BrandMark />
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleContinue()
                }}
              >
                <h1 className="mk-step__title">
                  Welcome back. <span className="mk-mute">Which email is your store under?</span>
                </h1>

                <p className="mk-step__sub">
                  We use it to find your store. No password to remember — this build has no
                  authentication service connected to it.
                </p>

                <div className="mk-step__body">
                  <Field
                    label="Email address"
                    required
                    error={shownError}
                    hint={isDemo ? 'Any address works in demo mode.' : undefined}
                  >
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        type="email"
                        value={email}
                        autoComplete="email"
                        inputMode="email"
                        autoFocus
                        placeholder="you@example.com"
                        aria-describedby={describedBy}
                        invalid={invalid || Boolean(shownError)}
                        onChange={(event) => {
                          setEmail(event.target.value)
                          setError(null)
                        }}
                      />
                    )}
                  </Field>
                </div>

                <div className="mk-step__actions">
                  <Button type="submit" variant="primary" size="lg" loading={busy}>
                    Continue
                    {!busy ? <Icon name="chevronRight" size={15} /> : null}
                  </Button>
                </div>
              </form>

              <p className="mk-step__alt">
                New here? <Link to={paths.marketing.getStarted}>Create your store</Link>
              </p>
            </>
          ) : (
            <>
              <div className="mk-step__head">
                <span className="mk-eyebrow mk-eyebrow--plain">
                  <Icon name="check" size={12} />
                  Account found
                </span>
              </div>

              <h1 className="mk-step__title">
                {store ? store.name : 'Your store'}
                <span className="mk-mute"> is ready when you are.</span>
              </h1>

              <p className="mk-step__sub">
                This is what we found under <strong>{email}</strong>. If it is the right store,
                carry on.
              </p>

              <dl className="mk-facts">
                <div className="mk-fact">
                  <dt>Store name</dt>
                  <dd>{store?.name ?? '—'}</dd>
                </div>
                <div className="mk-fact">
                  <dt>Signed in as</dt>
                  <dd>{email}</dd>
                </div>
                <div className="mk-fact">
                  <dt>City</dt>
                  <dd>{store?.city || 'Not set'}</dd>
                </div>
                <div className="mk-fact">
                  <dt>Pieces in your collection</dt>
                  <dd className="tabular">{products.loading ? '…' : productCount}</dd>
                </div>
                <div className="mk-fact">
                  <dt>Store link</dt>
                  <dd className="mk-fact__mono">{store ? `/s/${store.slug}` : '—'}</dd>
                </div>
              </dl>

              {isDemo ? (
                <div className="mk-note">
                  <Icon name="info" size={15} />
                  <span>
                    Demo mode. This store lives in this browser only — nothing has been read from or
                    written to a database. See <code>arch.md</code> §7.
                  </span>
                </div>
              ) : null}

              <div className="mk-step__actions">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => navigate(from ?? landingPathFor(seller, store), { replace: true })}
                >
                  Open my dashboard
                  <Icon name="chevronRight" size={15} />
                </Button>
                <Button variant="ghost" size="lg" onClick={() => setStep('email')}>
                  Use a different email
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </MarketingShell>
  )
}
