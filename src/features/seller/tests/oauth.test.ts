import { describe, expect, it } from 'vitest'

import { config } from '@/lib/config'
import { isServiceError } from '@/lib/seller'
import { paths } from '@/routes/paths'
import { createMockSellerService } from '../services/mockSellerService'
import { oauthRedirectUrl, readOAuthError } from '../utils/oauth'

/**
 * The provider sign-in has two halves that can be tested without a browser: where the app sends the
 * browser back to, and how it reads a failure that came back in the URL. Both are pure, and both
 * have a failure mode that is invisible in development — a redirect URL that only works on
 * `localhost`, and an error reader that mistakes a successful return for a failed one.
 */
describe('oauthRedirectUrl', () => {
  it('sends the browser back to the sign-in screen, which is what picks the destination', () => {
    // Not the dashboard. A seller arriving from Google has an account and may have no store at all,
    // and the sign-in screen is the only place that decides which of those they are before routing.
    expect(oauthRedirectUrl().endsWith(paths.marketing.signIn)).toBe(true)
  })

  it('follows the origin it is given rather than a hardcoded host', () => {
    // The regression this catches: a `'http://localhost:5173/sign-in'` literal, which works on one
    // machine and quietly redirects a deployed build to a developer's laptop. Asserted against a
    // *foreign* origin on purpose — during local development `config.publicSiteUrl` is
    // `http://localhost:5173`, so testing the default would pass with the host hardcoded.
    expect(oauthRedirectUrl('https://shringaar.app')).toBe('https://shringaar.app/sign-in')
  })

  it('defaults to the running origin', () => {
    expect(oauthRedirectUrl().startsWith(config.publicSiteUrl)).toBe(true)
  })

  it('joins the origin and the path without doubling the separator', () => {
    // `publicSiteUrl` is stripped of trailing slashes in config, so `//sign-in` here would mean that
    // stripping was removed. Providers compare this string against an allowlist literally.
    expect(oauthRedirectUrl().replace(/^https?:\/\//, '')).not.toContain('//')
  })
})

describe('readOAuthError', () => {
  it('reports nothing for an ordinary URL', () => {
    // The common case: this runs on every load of the sign-in screen, most of which have nothing to
    // do with a provider.
    expect(readOAuthError('', '')).toBeNull()
    expect(readOAuthError('?from=/seller/products', '')).toBeNull()
  })

  it('reports nothing for a *successful* return', () => {
    // Load-bearing. The screen clears the failure parameters out of the address bar, and it only
    // does that when this returns non-null. Mistaking a code for an error would delete the
    // authorization code that supabase-js is still exchanging, and the sign-in would hang.
    expect(readOAuthError('?code=8a4f0c1e-2b3d-4a5e-9f60-1c2d3e4f5a6b', '')).toBeNull()
  })

  it('reads the query string, where PKCE puts it', () => {
    const found = readOAuthError('?error=server_error&error_description=Unable+to+exchange+code', '')
    expect(found?.code).toBe('server_error')
    // `+` is a space in a query string and the provider's own text is passed through unaltered.
    expect(found?.message).toBe('Unable to exchange code')
  })

  it('reads the fragment too, because which half carries it depends on the flow', () => {
    const found = readOAuthError('', '#error=server_error&error_description=Something+went+wrong')
    expect(found?.message).toBe('Something went wrong')
  })

  it('prefers the query string when both halves are present', () => {
    const found = readOAuthError('?error=access_denied', '#error=server_error')
    expect(found?.code).toBe('access_denied')
  })

  it('falls back to error_code when there is no `error`', () => {
    expect(readOAuthError('?error_code=otp_expired', '')?.code).toBe('otp_expired')
  })

  it('writes its own sentence when the seller cancelled', () => {
    // The one failure the seller causes themselves, and the one whose provider wording
    // ("access_denied") tells them nothing about whether anything happened to their account.
    const found = readOAuthError('?error=access_denied&error_description=User+denied+access', '')
    expect(found?.message).not.toContain('denied')
    expect(found?.message).toMatch(/nothing changed/i)
  })

  it('does not leave a seller with no message at all', () => {
    // A provider that reports a code and no description must still produce something readable —
    // an empty alert box reads as a broken page.
    const found = readOAuthError('?error=server_error', '')
    expect(found?.message.length).toBeGreaterThan(0)
  })
})

describe('the demo adapter', () => {
  it('reports that it cannot do a provider sign-in', () => {
    // What keeps the button off the screen in demo mode. `capabilities` is asked rather than
    // inferred from `mode` precisely so a screen does not have to guess.
    expect(createMockSellerService().capabilities.oauth).toBe(false)
  })

  it('refuses rather than opening the demo session behind the seller’s back', async () => {
    // Faking it would hand back a dashboard that looks signed in with Google and is not — and the
    // seller would have no way to tell. Failing loudly is the whole point of this adapter.
    const failure = await createMockSellerService()
      .signInWithOAuth('google')
      .then(() => null)
      .catch((cause: unknown) => cause)

    expect(isServiceError(failure)).toBe(true)
    expect(failure).toMatchObject({ code: 'not_implemented' })
    // Names the provider, which is what pins `OAUTH_PROVIDER_LABELS` to the `OAuthProvider` union.
    // A provider added to the union without a label would say "undefined" to the seller here.
    expect((failure as Error).message).toContain('Google')
  })
})
