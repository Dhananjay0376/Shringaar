import { LoadingAnnouncement } from '@/components/ui/Skeleton'
import { useSeller } from '@/features/seller/context/SellerContext'
import { landingPathFor } from '@/features/seller/utils/landing'
import { MarketingShell } from '@/features/marketing/components/MarketingShell'

/**
 * The gate the three onboarding screens share.
 *
 * They are the only screens in the app that render *between* "signed out" and the dashboard shell
 * that guards everything else, and each needs the same two things: something to show while the
 * session is being read, and a redirect when the session says this is not the screen the seller
 * should be on.
 *
 * The waiting state is not decoration. With a real backend the session is a network round trip that
 * reports `null` until it lands, so a signed-in seller reloading `/onboarding/store` would be judged
 * signed-out for a frame and bounced to sign-in — and then bounced straight back once the session
 * arrived. Deriving that answer once, here, is what stops it being derived slightly differently on
 * each of the three screens.
 */

/**
 * How a screen asks for credentials: where to return the seller afterwards, and whether they are
 * arriving to create an account or to use one they already have.
 *
 * It travels as router location state rather than a query string so the intent is not in a URL that
 * can be shared, bookmarked or bookmarked-into-a-different-meaning.
 */
export interface AuthRequest {
  /** Where the seller was headed when a guard turned them away. */
  from?: string
  mode?: 'signIn' | 'signUp'
}

export function SessionLoading() {
  return (
    <MarketingShell footer={false} nav={false}>
      <div className="mk-step">
        <div className="mk-step__card mk-step__card--centre">
          <LoadingAnnouncement label="Checking your session" />
        </div>
      </div>
    </MarketingShell>
  )
}

/**
 * The session, plus where it says the seller belongs.
 *
 * Returns the whole context rather than a hand-picked subset, so a screen that needs `createStore`
 * or the service does not have to reach for a second hook and end up with two copies of the same
 * question in one component.
 */
export function useOnboardingSession() {
  const context = useSeller()

  return {
    ...context,
    /**
     * Recomputed on every render from the live context, which matters: a `createStore` that just
     * succeeded changes `store`, and the guard below re-evaluates against the new value rather than
     * a captured one.
     */
    landing: landingPathFor(context.seller, context.store),
  }
}
