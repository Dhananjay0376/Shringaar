import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { storePath } from '@/lib/catalog'
import { MarketingShell, OnboardingHeader } from '@/features/marketing/components/MarketingShell'
import { SessionLoading, useOnboardingSession } from '../components/SessionGate'
import { paths } from '@/routes/paths'

/**
 * Store created.
 *
 * One sentence, and the ways forward. The store exists but is empty, and the only useful thing to do
 * next is put something in it — so that is the first thing offered. The store link is shown
 * underneath because a seller will want to look at it, and finding it here saves a trip through
 * settings.
 *
 * This screen is also the end of the guided run, and leaving it is what marks the run finished. That
 * is a deliberate choice of moment: the flag it sets is what publishes the shop to the public
 * storefront, and a store named thirty seconds ago with nothing in it is not ready for customers.
 * It is what makes "resume an unfinished setup" real, too — a seller who closes the tab here comes
 * back to this screen rather than to a dashboard for a shop that does not exist yet, because the
 * store row exists and the flag does not.
 *
 * Every exit goes through the same call, so there is no way off this screen that leaves the seller
 * locked out of their own dashboard by their own half-finished setup.
 */
export function StoreReady() {
  const { store, loading, landing, completeOnboarding } = useOnboardingSession()
  const navigate = useNavigate()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useDocumentTitle('Your store is ready — Shringaar')

  // A signed-out client cannot read a store at all — Row Level Security sees to that — so this screen
  // has nothing to say until the session is known. Once it is, `landing` names the step the seller is
  // actually on: the store form if they have no store, sign-in if they have no session.
  if (loading) {
    return <SessionLoading />
  }

  if (!store) {
    return <Navigate to={landing} replace />
  }

  async function leave(to: string) {
    setBusy(true)
    setError(null)

    try {
      await completeOnboarding()
      // Deliberately no `setBusy(false)`: this unmounts on the way out, and clearing it first would
      // flash an idle button at a seller who has already left.
      navigate(to, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be saved. Try again.')
      setBusy(false)
    }
  }

  return (
    <MarketingShell footer={false} nav={false}>
      <div className="mk-step">
        <div className="mk-step__card mk-step__card--centre">
          <OnboardingHeader label="Your store is ready" />

          <span className="mk-ready" aria-hidden="true">
            <Icon name="check" size={26} />
          </span>

          <h1 className="mk-step__title">
            Your <span className="mk-ready__name">“{store.name}”</span> store is ready.
            <span className="mk-mute"> Let’s add your first jewellery product.</span>
          </h1>

          <p className="mk-step__sub">
            It has its own address already, and a QR code for every piece you add.
          </p>

          <p className="mk-ready__link">
            <Icon name="link" size={14} />
            <span className="mk-fact__mono">{storePath(store.slug)}</span>
          </p>

          {error ? (
            <div className="mk-note mk-note--error" role="alert">
              <Icon name="alert" size={15} />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="mk-step__actions mk-step__actions--centre">
            <Button
              variant="primary"
              size="lg"
              loading={busy}
              iconRight="chevronRight"
              onClick={() => void leave(paths.onboarding.products)}
            >
              Add Your First Product
            </Button>
            <Button
              variant="ghost"
              size="lg"
              disabled={busy}
              onClick={() => void leave(paths.seller.dashboard)}
            >
              I will add pieces later
            </Button>
          </div>

          <p className="mk-step__alt">
            Prefer the full form?{' '}
            <button
              type="button"
              className="mk-linkbtn"
              disabled={busy}
              onClick={() => void leave(paths.seller.addProduct)}
            >
              Add a product with all the details
            </button>
          </p>
        </div>
      </div>
    </MarketingShell>
  )
}
