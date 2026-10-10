import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { paths } from '@/routes/paths'
import { LandingFooter } from './LandingFooter'
import { LandingNav } from './LandingNav'

/**
 * The chrome every pre-dashboard screen sits in.
 *
 * The reference's defining structural move is that the page is not the page: a dark frame wraps a
 * cream panel, and the panel is what scrolls. Reproducing it once here means the landing, the
 * sign-in and the three onboarding steps are visibly the same product without any of them
 * restating the layout.
 *
 * `footer` is off for the onboarding steps — a seller mid-setup who scrolls into a marketing footer
 * has been handed somewhere to leave.
 */
export interface MarketingShellProps {
  children: ReactNode
  /** Renders the marketing footer below the content. Off during onboarding. */
  footer?: boolean
  /** Renders the landing nav above the content. Off during onboarding, which has its own header. */
  nav?: boolean
}

export function MarketingShell({ children, footer = true, nav = true }: MarketingShellProps) {
  const { pathname } = useLocation()

  // A route change inside the shell must start at the top, or a seller who taps "Create your store"
  // from the bottom of the landing page arrives halfway down the next screen.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="mk-frame">
      <div className="mk-panel">
        {nav ? <LandingNav /> : null}
        {children}
        {footer ? <LandingFooter /> : null}
      </div>
    </div>
  )
}

/**
 * The compact header the onboarding steps carry.
 *
 * Deliberately not the landing nav: there are no marketing destinations to wander into while a
 * seller is three fields from finishing, only the way back. It links to the brandmark instead when
 * there is nowhere sensible to go back to — the first step of the flow.
 */
export function OnboardingHeader({ label, backTo }: { label: string; backTo?: string }) {
  return (
    <div className="mk-step__rail">
      {backTo ? (
        <Link className="mk-back" to={backTo}>
          <Icon name="chevronRight" size={14} className="mk-back__icon" />
          Back
        </Link>
      ) : (
        <Link className="mk-logo" to={paths.root}>
          <span className="mk-logo__mark" aria-hidden="true">
            श
          </span>
          Shringaar
        </Link>
      )}

      <span className="mk-eyebrow mk-eyebrow--plain">{label}</span>
    </div>
  )
}

/** The brandmark on its own, for screens with no navigation at all. */
export function MarketingLogo() {
  return (
    <Link className="mk-logo" to={paths.root}>
      <span className="mk-logo__mark" aria-hidden="true">
        श
      </span>
      Shringaar
    </Link>
  )
}
