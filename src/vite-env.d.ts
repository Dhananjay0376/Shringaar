/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRYON_BASE_URL?: string
  readonly VITE_PUBLIC_SITE_URL?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /**
   * Base URL of the asset-processing service (see `backend/`). Unset is a valid, supported state:
   * the dashboard simply offers no photo-to-asset processing.
   */
  readonly VITE_ASSET_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
