import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

/**
 * Vite and Vitest share one config file.
 *
 * `defineConfig` is imported from `vitest/config`, not `vite` — the Vitest one is Vite's with the
 * `test` block added to the type, so `test:` below is a type error if imported from `'vite'`. A
 * separate `vitest.config.ts` would have been the alternative, but Vitest reads *only* that file
 * when it exists and would then ignore this one entirely, forcing the `@` alias below to be
 * duplicated or merged back in. One file cannot drift from itself.
 *
 * Nothing here is required to build the app: the `test` block is inert during `vite build`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * `three` is reached only through `await import()` in the try-on renderer, so it would
         * already be split out; naming it here makes the split explicit and catches a future stray
         * static import that would drag ~150 kB of WebGL into the entry bundle. See arch.md §8.
         */
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  test: {
    /**
     * The tested surface is deliberately DOM-free: geometry, coordinates, smoothing, tracking
     * state, calibration and GLB byte parsing are all pure functions over plain data. A jsdom
     * environment would be paying for tests that deliberately do not exist.
     */
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /**
     * `globals: false` is load-bearing, not a preference. `tsconfig.json` sets
     * `"types": ["vite/client", "node"]`, which is an *allowlist* — `describe`/`it`/`expect` are
     * not ambient, so every test must import them from `'vitest'` explicitly. Turning globals on
     * would let the tests run while `tsc --noEmit` (the first half of `npm run build`) failed with
     * "Cannot find name 'describe'".
     */
    globals: false,
    restoreMocks: true,
  },
})
