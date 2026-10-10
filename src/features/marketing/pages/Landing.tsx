import { Link } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useSeller } from '@/features/seller/context/SellerContext'
import { paths } from '@/routes/paths'
import { MarketingShell } from '../components/MarketingShell'
import { AiShowcase, HowItWorks, SellerToolkit } from '../components/FeatureShowcase'

/**
 * The landing page — the first thing anyone sees.
 *
 * Its whole job is to route two different people correctly: a seller who already has a store, and
 * one who does not. Everything else on the page is there to make both of them believe the next
 * screen is worth the fifteen minutes.
 *
 * The numbers in the stat row are properties of the product, not measurements of it. A figure like
 * "12,000 sellers" would be invented, and an invented number is the first thing a seller
 * discovers is false.
 */

const STATS = [
  { value: '15 min', label: 'From naming your store to your first product' },
  { value: '1 QR', label: 'For every piece, print-ready' },
  { value: '0%', label: 'Commission — we never touch your payments' },
]

export function Landing() {
  const { seller } = useSeller()

  useDocumentTitle('Shringaar — your jewellery store, online')

  return (
    <MarketingShell>
      <section className="mk-hero">
        <div className="mk-traces" aria-hidden="true" />
        <span className="mk-chip mk-chip--a" aria-hidden="true">
          ₹
        </span>
        <span className="mk-chip mk-chip--b" aria-hidden="true">
          ✦
        </span>
        <span className="mk-chip mk-chip--c" aria-hidden="true">
          QR
        </span>
        <span className="mk-chip mk-chip--d" aria-hidden="true">
          ✦
        </span>

        <div className="mk-hero__inner">
          <span className="mk-eyebrow">
            <Icon name="sparkle" size={12} />
            For local jewellery sellers
          </span>

          <h1 className="mk-display">
            <span className="mk-display__line">Everything on your tray,</span>
            <span className="mk-display__line mk-mute">online before the shop closes.</span>
          </h1>

          <p className="mk-hero__sub">
            A storefront, a QR code for every piece, and an AR try-on your customer opens on their
            own phone. No website builder to learn, and no checkout to set up.
          </p>

          <div className="mk-hero__actions">
            {seller ? (
              <Link className="mk-btn mk-btn--brand" to={paths.seller.dashboard}>
                Open your dashboard
                <Icon name="chevronRight" size={15} />
              </Link>
            ) : (
              <>
                <Link className="mk-btn mk-btn--brand" to={paths.marketing.getStarted}>
                  Create your store
                  <Icon name="chevronRight" size={15} />
                </Link>
                <Link className="mk-btn mk-btn--white" to={paths.marketing.signIn}>
                  I already have a store
                </Link>
              </>
            )}
          </div>

          <p className="mk-hero__trust">
            <Icon name="check" size={14} />
            <b>Free to start.</b> No card, no commission, no payment gateway.
          </p>
        </div>

        <div className="mk-stat-row">
          {STATS.map((stat) => (
            <div className="mk-statnum" key={stat.value}>
              <div className="mk-statnum__v">{stat.value}</div>
              <div className="mk-statnum__l">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      <AiShowcase />
      <SellerToolkit />
      <HowItWorks />

      <section className="mk-cta" aria-labelledby="mk-cta-title">
        <span className="mk-cta__mark" aria-hidden="true">
          <Icon name="sparkle" size={24} />
        </span>

        <h2 className="mk-h2" id="mk-cta-title" style={{ marginTop: 'var(--sp-6)' }}>
          Ready to open?
        </h2>

        <div className="mk-hero__actions">
          <Link className="mk-btn mk-btn--brand" to={paths.marketing.getStarted}>
            Create your store
            <Icon name="chevronRight" size={15} />
          </Link>
          <Link className="mk-btn mk-btn--white" to={paths.marketing.signIn}>
            Sign in
          </Link>
        </div>

        <p className="mk-cta__sub">
          You can stop halfway and come back — your store keeps whatever you have added.
        </p>
      </section>
    </MarketingShell>
  )
}
