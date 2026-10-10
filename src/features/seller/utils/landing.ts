import { paths } from '@/routes/paths'
import type { Seller, Store } from '../types/seller'

/**
 * Where a seller belongs right now, given what the session actually holds.
 *
 * Four screens need to answer this question — sign-in, the store form, the store-created screen and
 * the dashboard shell — and each of them asking it separately is how they end up disagreeing. A
 * seller who signs in on the tab that thinks they are finished and lands on the dashboard, while the
 * tab they left behind thinks they are half-onboarded, is a bug that only shows up in one of the two
 * places and is impossible to reproduce from the other.
 *
 * So the decision lives here, once, as a pure function of the two nullable objects the context
 * already holds. It takes them as arguments rather than reading the context itself so it can be
 * reasoned about — and tested — without React.
 *
 * The order of the questions is the point:
 *
 *   1. No session → sign in. Nothing else is knowable, because Row Level Security means an
 *      unauthenticated client cannot see a store even when one exists.
 *   2. Session but no store → the guided first run. A seller who signed up and closed the tab
 *      before naming their shop is not an error state; they are one screen in.
 *   3. Store, setup unfinished → back to the step they left. A store row is created on the first
 *      step, not the last, precisely so this is resumable — and the flag is also what keeps a
 *      half-built store off the public storefront, since the public views are gated on it.
 *   4. Otherwise → the dashboard.
 *
 * Note that a *store* being present is not the same as onboarding being finished. `CreateStore`
 * writes the row on its first step, so the second and third cases are genuinely different states and
 * collapsing them would strand the seller in a form they have already submitted.
 */
export function landingPathFor(seller: Seller | null, store: Store | null): string {
  if (!seller) return paths.marketing.signIn
  if (!store) return paths.onboarding.store
  if (!store.onboardingCompleted) return paths.onboarding.ready
  return paths.seller.dashboard
}
