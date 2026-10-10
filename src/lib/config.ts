/**
 * Runtime configuration.
 *
 * Only `VITE_`-prefixed variables are readable here, and everything prefixed `VITE_` is inlined
 * into the shipped bundle — so nothing secret may ever be added to this file. The Supabase anon
 * key is public by design and is safe *only* because Row Level Security protects the rows; a
 * service-role key must never appear in a `VITE_` variable. See arch.md §7.1.
 */

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export interface AppConfig {
  /** Absolute origin used when building shareable storefront and product links. */
  publicSiteUrl: string
  /** Base URL of the customer AR try-on client, or null when it is not deployed yet. */
  tryOnBaseUrl: string | null
  /** Present only when both Supabase variables are set. */
  supabase: SupabaseConfig | null
}

function readEnv(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function resolvePublicSiteUrl(): string {
  const configured = readEnv(import.meta.env.VITE_PUBLIC_SITE_URL)
  if (configured) return configured.replace(/\/+$/, '')

  // Fall back to whatever origin the dashboard is being served from. This keeps links and QR
  // codes correct in local development without requiring an .env file.
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }

  return 'http://localhost:5173'
}

function resolveSupabase(): SupabaseConfig | null {
  const url = readEnv(import.meta.env.VITE_SUPABASE_URL)
  const anonKey = readEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)

  // A half-configured project is treated as unconfigured rather than failing at call time.
  if (!url || !anonKey) return null

  return { url, anonKey }
}

export const config: AppConfig = {
  publicSiteUrl: resolvePublicSiteUrl(),
  tryOnBaseUrl: readEnv(import.meta.env.VITE_TRYON_BASE_URL),
  supabase: resolveSupabase(),
}

/** True when a real backend is available and the Supabase adapter should be used. */
export const isSupabaseConfigured = config.supabase !== null
