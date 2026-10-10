/**
 * The browser Supabase client.
 *
 * One instance for the app. `createClient` is cheap to call but each call starts its own auth
 * listener and token-refresh timer, so a second one would fight the first over the stored session.
 *
 * The key used here is the publishable (or legacy anon) key. It is a *public* identifier — it ships
 * inside the JavaScript bundle and anyone can read it out. It is safe only because every table has
 * Row Level Security enabled and the policies key on `auth.uid()`. A service-role key would bypass
 * all of that and must never reach this file. See arch.md §7.1.
 */

import { AuthSessionMissingError, createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from '@/lib/config'

let client: SupabaseClient | null = null

/**
 * Throws rather than returning null. Callers reach this only through `isSupabaseConfigured`, which
 * already gates adapter selection, so a null here would mean the app asked for live data while
 * configured for demo — a wiring bug that should be loud.
 *
 * A plain `Error`, not the feature layer's `ServiceError`: `lib/` must not depend on `features/`
 * (arch.md §9 rule 1). The adapter wraps this at the boundary if a caller needs a typed error.
 */
export function supabase(): SupabaseClient {
  if (!config.supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or run without them to use the browser-local demo store.',
    )
  }

  client ??= createClient(config.supabase.url, config.supabase.anonKey, {
    auth: {
      // Survives a reload: the session is kept in localStorage and refreshed in the background, so
      // a seller who closes the tab comes back signed in.
      persistSession: true,
      autoRefreshToken: true,
      // Reads a session out of the URL hash on load. This is what makes an email-confirmation or
      // magic-link redirect land as a signed-in session rather than a dead link.
      detectSessionInUrl: true,
      storageKey: 'shringaar.auth.v1',
      flowType: 'pkce',
    },
  })

  return client
}

/**
 * Whether an error from the auth client means "this visitor has no session".
 *
 * `auth.getUser()` reports the absence of a session as an error — `AuthSessionMissingError` — and
 * gives it HTTP status **400**. Read as a status it looks like a request fault, and a 400 is exactly
 * what a genuinely malformed request returns too, so there is no way to tell them apart from the
 * status alone. This predicate is the one place that knows the difference, so callers can treat the
 * answer as the ordinary signed-out state it is rather than as a failure.
 */
export function isMissingSession(error: unknown): boolean {
  return error instanceof AuthSessionMissingError
}
