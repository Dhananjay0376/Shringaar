/**
 * The two pieces of routing knowledge a redirect-based sign-in needs.
 *
 * Both are pure so they can be tested without a browser, and both live here rather than in the
 * Supabase adapter because they are not Supabase's business: where the app sends a visitor back to,
 * and how it reads a failure the provider put in the URL, are properties of this app's routes.
 *
 * ### Why the redirect target is the sign-in screen
 *
 * The provider returns the browser to a URL with a code on it. Something has to be there to turn
 * that code into a session, and the sign-in screen already is: it waits on `loading`, then redirects
 * to wherever the seller actually belongs — a finished store, or the next setup step. Landing on a
 * dashboard would skip that decision and drop a brand-new Google seller on a page their half-built
 * store bounces them back from.
 */

import { config } from '@/lib/config'
import { paths } from '@/routes/paths'

/**
 * Where the identity provider sends the browser back to.
 *
 * Built from `config.publicSiteUrl`, which falls back to the running origin — so in development this
 * follows whatever port the dev server is on, and in a deployed build it is the configured public
 * origin. That is deliberate: a hardcoded `localhost` here works in exactly one environment, and a
 * hardcoded production host silently breaks local work.
 *
 * **This exact URL must be listed in the Supabase project's allowed redirect URLs**, together with
 * any other origin the app is served from. A URL that is not on the list is refused by the provider
 * before the browser ever comes back, and the app cannot see that it happened.
 *
 * The origin is a parameter with a default rather than a closed-over constant so it can be tested
 * against an origin that is *not* the running one. Tested only through the default, this function
 * passes just as happily when the origin is hardcoded — `config.publicSiteUrl` and a hardcoded
 * `localhost` are the same string during local development, which is exactly where the test runs.
 * Naming the dependency is what makes the assertion mean anything.
 */
export function oauthRedirectUrl(origin: string = config.publicSiteUrl): string {
  return `${origin}${paths.marketing.signIn}`
}

/** The failure shapes a provider can hand back, in the query string or in the fragment. */
export interface OAuthError {
  /** The provider's short code — `access_denied` when the visitor closed the consent screen. */
  code: string
  /** A sentence to show. The provider's own wording when it gave one, ours when it did not. */
  message: string
}

/**
 * Reads a failed OAuth return out of the URL.
 *
 * Supabase reports the failure by appending to the URL it redirects to, not by throwing anywhere the
 * app can catch — the page it lands on was loaded fresh. So the landing screen has to look. Which
 * half of the URL carries it depends on the flow (query for PKCE, fragment for implicit), so both
 * are checked rather than assuming.
 *
 * Returns `null` for the ordinary case of a URL with nothing wrong in it. That is the common path:
 * this runs on every load of the sign-in screen, including every load that has nothing to do with a
 * provider.
 */
export function readOAuthError(search: string, hash: string): OAuthError | null {
  for (const raw of [search, hash]) {
    if (!raw) continue

    const params = new URLSearchParams(raw.startsWith('#') || raw.startsWith('?') ? raw.slice(1) : raw)
    const code = params.get('error') ?? params.get('error_code')
    if (!code) continue

    const described = params.get('error_description')?.trim()

    return {
      code,
      // The provider's `error_description` is written for a developer — "Unable to exchange external
      // code for token", "invalid_grant" — and showing it to a seller explains nothing they can act
      // on. The one failure they cause themselves gets a sentence written for them; anything else
      // says what to try, without repeating jargon.
      message:
        code === 'access_denied'
          ? 'You closed the sign-in window before finishing, so nothing changed. Try again when you are ready.'
          : described || 'That sign-in could not be completed. Try again, or use your email and password.',
    }
  }

  return null
}
