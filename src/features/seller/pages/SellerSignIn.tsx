import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useSeller } from '../context/SellerContext'
import { paths } from '@/routes/paths'

/**
 * Sign-in.
 *
 * There is no password field, because there is no auth service yet — and a password box that accepts
 * anything teaches a seller to distrust the whole product. This screen says exactly what it is: a
 * way into the demo session. When Supabase auth is wired up, this component is replaced, not
 * extended with a hidden bypass.
 */

interface LocationState {
  from?: string
}

export function SellerSignIn() {
  const { seller, isDemo, signIn } = useSeller()
  const navigate = useNavigate()
  const location = useLocation()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const from = (location.state as LocationState | null)?.from ?? paths.seller.dashboard

  useDocumentTitle('Sign in — Shringaar')

  if (seller) {
    return <Navigate to={from} replace />
  }

  async function handleSignIn() {
    setBusy(true)
    setError(null)

    try {
      await signIn()
      navigate(from, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <span className="brandmark brandmark--lg" aria-hidden="true">
            श
          </span>
          <span className="brandmark__text" style={{ textAlign: 'left' }}>
            <span className="brandmark__name">Shringaar</span>
            <span className="brandmark__sub">Seller dashboard</span>
          </span>
        </div>

        <h1 className="auth__title">Sign in to your store</h1>

        <p className="auth__desc">
          {isDemo ? (
            <>
              No authentication service is connected to this build, so there is no password to enter.
              Continue to open the demo seller account — <strong>Meena Jewels</strong> — and its sample
              catalogue.
            </>
          ) : (
            <>A backend is configured for this build. Continue to authenticate and open your store.</>
          )}
        </p>

        {error ? (
          <div className="banner banner--error" role="alert" style={{ marginBottom: 'var(--sp-5)' }}>
            <span className="banner__icon">
              <Icon name="alert" size={16} />
            </span>
            <span className="banner__body">{error}</span>
          </div>
        ) : null}

        <Button variant="primary" block loading={busy} onClick={handleSignIn}>
          {isDemo ? 'Continue as demo seller' : 'Sign in'}
        </Button>

        {isDemo ? (
          <div className="callout callout--info" style={{ marginTop: 'var(--sp-5)', textAlign: 'left' }}>
            <span className="callout__icon">
              <Icon name="info" size={15} />
            </span>
            <span>
              Demo mode. Products you add or edit are saved in this browser only — nothing is written
              to a database and no files are uploaded to storage. Row Level Security, real
              authentication and file storage are described in <code>arch.md</code> §7.
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
