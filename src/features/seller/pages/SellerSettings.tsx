import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button, btnClass } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { config, isSupabaseConfigured } from '@/lib/config'
import { formatDate, formatInitials } from '@/lib/format'
import { paths } from '@/routes/paths'
import { isDemoService, type DemoMaintenance } from '../services/sellerService'
import { useSeller } from '../context/SellerContext'
import { storeUrl } from '../utils/product'

/**
 * Settings.
 *
 * The rule on this screen is that nothing may claim to be connected when it is not. Every row is
 * either wired to something real or marked "Not connected" with the reason — an account page full of
 * switches that do nothing is worse than an honest list of gaps, because a seller will build on top
 * of it and only find out later. See arch.md §7 and design.md §7.
 */

interface IntegrationRow {
  icon: IconName
  label: string
  description: string
  /** What is actually true right now. */
  status: string
  connected: boolean
}

export function SellerSettings() {
  const { seller, store, isDemo, signOut, service } = useSeller()
  const navigate = useNavigate()
  const toast = useToast()

  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [working, setWorking] = useState(false)

  const demo = service && isDemoService(service) ? (service as DemoMaintenance) : null
  const persistence = demo ? demo.describePersistence() : null

  if (!seller || !store) return null

  async function handleSignOut() {
    setWorking(true)
    try {
      await signOut()
      navigate(paths.seller.signIn, { replace: true })
    } finally {
      setWorking(false)
      setConfirmSignOut(false)
    }
  }

  async function handleReset() {
    if (!demo) return
    setWorking(true)
    try {
      await demo.resetDemoData()
      toast.success('Demo data was reset. Reloading…')
      // A full reload is the honest way to clear every hook holding the old data.
      window.setTimeout(() => window.location.reload(), 600)
    } catch {
      toast.error('The demo data could not be reset.')
      setWorking(false)
      setConfirmReset(false)
    }
  }

  const integrations: IntegrationRow[] = [
    {
      icon: 'shield',
      label: 'Authentication',
      description:
        'Sign-in, session handling and the seller identity that store ownership is checked against.',
      status: isDemo
        ? 'Not connected — this dashboard runs as a fixed demo seller with no sign-in'
        : 'Connected',
      connected: !isDemo,
    },
    {
      icon: 'image',
      label: 'Media storage',
      description: 'Where product photos, store logos and try-on assets are uploaded and served from.',
      status: isDemo
        ? 'Not connected — images are held in this browser as data URLs'
        : 'Connected',
      connected: !isDemo,
    },
    {
      icon: 'chart',
      label: 'Analytics collection',
      description: 'Recording storefront visits, product views, try-on starts and outbound clicks.',
      status: isDemo
        ? 'Not connected — analytics figures are generated sample data'
        : 'Connected',
      connected: !isDemo,
    },
    {
      icon: 'sparkle',
      label: 'AR try-on engine',
      description:
        'Rendering the try-on experience from a product’s try-on asset, for customers on your storefront.',
      status: config.tryOnBaseUrl
        ? `Pointed at ${config.tryOnBaseUrl}`
        : 'Not connected — no try-on host is configured, so try-on is unavailable to customers',
      connected: Boolean(config.tryOnBaseUrl),
    },
    {
      icon: 'whatsapp',
      label: 'WhatsApp and contact destinations',
      description:
        'Turning your saved number into a wa.me link on every product page that has no number of its own.',
      status: store.whatsappNumber
        ? `Active for ${store.whatsappNumber}`
        : 'No number saved — add one in My Store to enable contact buttons',
      connected: Boolean(store.whatsappNumber),
    },
  ]

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Your account, which integrations are live, and what is still missing."
      />

      {/* ── Account ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Account" subtitle="Who is signed in and what they own." />
        <CardBody>
          <div className="settings-row">
            <span className="avatar" aria-hidden="true">
              {formatInitials(seller.displayName)}
            </span>
            <div className="settings-row__main">
              <p className="settings-row__label">{seller.displayName}</p>
              <p className="settings-row__desc">{seller.email}</p>
            </div>
            {isDemo ? <Badge tone="warning">Demo seller</Badge> : <Badge tone="success">Signed in</Badge>}
          </div>

          <div className="settings-row">
            <div className="settings-row__main">
              <p className="settings-row__label">Store</p>
              <p className="settings-row__desc">
                {store.name} · /s/{store.slug}
              </p>
            </div>
            <Link className="btn btn--secondary btn--sm" to={paths.seller.store}>
              Manage store
            </Link>
          </div>

          <div className="settings-row">
            <div className="settings-row__main">
              <p className="settings-row__label">Seller ID</p>
              <p className="settings-row__desc mono">{seller.id}</p>
            </div>
            <span className="settings-row__value text-xs text-muted">
              Since {formatDate(seller.createdAt)}
            </span>
          </div>

          <div className="settings-row">
            <div className="settings-row__main">
              <p className="settings-row__label">Public storefront</p>
              <p className="settings-row__desc mono truncate">{storeUrl(store)}</p>
            </div>
            <a
              className="btn btn--secondary btn--sm"
              href={storeUrl(store)}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Icon name="external" size={14} />
              Open
            </a>
          </div>
        </CardBody>
      </Card>

      {/* ── Integrations ─────────────────────────────────────────────────── */}
      <Card style={{ marginTop: 'var(--sp-5)' }}>
        <CardHeader
          title="Integrations"
          subtitle="What this dashboard is actually connected to. Nothing here is simulated."
        />
        <CardBody>
          {integrations.map((row) => (
            <div className="settings-row" key={row.label}>
              <span
                className={`activity__icon ${row.connected ? 'activity__icon--green' : ''}`}
                aria-hidden="true"
              >
                <Icon name={row.icon} size={14} />
              </span>
              <div className="settings-row__main">
                <p className="settings-row__label">{row.label}</p>
                <p className="settings-row__desc">{row.description}</p>
                <p className="settings-row__desc" style={{ marginTop: 2 }}>
                  {row.status}
                </p>
              </div>
              <Badge tone={row.connected ? 'success' : 'neutral'} dot>
                {row.connected ? 'Connected' : 'Not connected'}
              </Badge>
            </div>
          ))}
        </CardBody>
      </Card>

      {/* ── Contact preferences ──────────────────────────────────────────── */}
      <Card style={{ marginTop: 'var(--sp-5)' }}>
        <CardHeader
          title="Contact preferences"
          subtitle="Where customers are sent from your storefront. These are set per store."
        />
        <CardBody>
          <div className="settings-row">
            <div className="settings-row__main">
              <p className="settings-row__label">WhatsApp number</p>
              <p className="settings-row__desc">
                {store.whatsappNumber ?? 'Not set. Products without their own number have no contact button.'}
              </p>
            </div>
            <Link className="btn btn--secondary btn--sm" to={paths.seller.store}>
              Change
            </Link>
          </div>

          <div className="settings-row">
            <div className="settings-row__main">
              <p className="settings-row__label">Contact email</p>
              <p className="settings-row__desc">{store.contactEmail ?? 'Not set'}</p>
            </div>
            <Link className="btn btn--secondary btn--sm" to={paths.seller.store}>
              Change
            </Link>
          </div>

          <div className="settings-row">
            <div className="settings-row__main">
              <p className="settings-row__label">Contact phone</p>
              <p className="settings-row__desc">{store.contactPhone ?? 'Not set'}</p>
            </div>
            <Link className="btn btn--secondary btn--sm" to={paths.seller.store}>
              Change
            </Link>
          </div>

          <p className="text-xs text-muted" style={{ marginTop: 'var(--sp-4)' }}>
            Contact destinations are stored against your store and travel to your storefront and every
            product page through this seller’s own record — a customer can only ever reach the number
            belonging to the product they are looking at.
          </p>
        </CardBody>
      </Card>

      {/* ── Data and session ─────────────────────────────────────────────── */}
      <Card style={{ marginTop: 'var(--sp-5)' }}>
        <CardHeader
          title="Data and session"
          subtitle={
            persistence
              ? persistence.detail
              : 'Where your store data lives and how to end this session.'
          }
        />

        <CardBody>
          <div className="settings-row">
            <div className="settings-row__main">
              <p className="settings-row__label">Backend</p>
              <p className="settings-row__desc">
                {isSupabaseConfigured
                  ? 'Supabase is configured but no adapter has been implemented in this repository, so the dashboard will refuse to start rather than serve sample data.'
                  : 'No backend is configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY once the Supabase adapter and schema exist — see arch.md §7.'}
              </p>
            </div>
            <Badge tone={isSupabaseConfigured ? 'warning' : 'neutral'} dot>
              {isSupabaseConfigured ? 'Configured, not implemented' : 'None configured'}
            </Badge>
          </div>

          {demo ? (
            <div className="settings-row">
              <div className="settings-row__main">
                <p className="settings-row__label">Reset demo data</p>
                <p className="settings-row__desc">
                  Restores the six sample products, the sample store and the generated analytics. Any
                  product you added or edited in this browser is discarded.
                </p>
              </div>
              <Button variant="secondary" size="sm" icon="refresh" onClick={() => setConfirmReset(true)}>
                Reset
              </Button>
            </div>
          ) : null}

          <div className="settings-row">
            <div className="settings-row__main">
              <p className="settings-row__label">Sign out</p>
              <p className="settings-row__desc">
                Ends this session on this device. {isDemo ? 'In demo mode this returns you to the sign-in screen and is reversible.' : ''}
              </p>
            </div>
            <Button variant="danger" size="sm" icon="logout" onClick={() => setConfirmSignOut(true)}>
              Sign out
            </Button>
          </div>
        </CardBody>
      </Card>

      <p className="text-xs text-muted" style={{ marginTop: 'var(--sp-5)' }}>
        Billing, payouts, checkout and delivery are deliberately absent — this dashboard manages a
        catalogue and a storefront, not transactions.{' '}
        <Link className={btnClass({ variant: 'link', size: 'sm' })} to={paths.seller.dashboard}>
          Back to overview
        </Link>
      </p>

      <Modal
        open={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        title="Sign out?"
        description="You will need to sign in again to manage this store."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSignOut(false)} disabled={working}>
              Stay signed in
            </Button>
            <Button variant="danger" icon="logout" loading={working} onClick={handleSignOut}>
              Sign out
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Nothing is deleted. Your products and store details are exactly where you left them.
        </p>
      </Modal>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset demo data?"
        description="Everything you changed in this browser will be discarded."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)} disabled={working}>
              Cancel
            </Button>
            <Button variant="danger" icon="refresh" loading={working} onClick={handleReset}>
              Reset demo data
            </Button>
          </>
        }
      >
        <div className="callout callout--warning">
          <span className="callout__icon">
            <Icon name="alert" size={15} />
          </span>
          <span>
            The six sample products, the sample store settings and all generated analytics are
            restored. Any product you created or edited here is lost. This only affects this browser —
            no database is involved.
          </span>
        </div>
      </Modal>
    </>
  )
}
