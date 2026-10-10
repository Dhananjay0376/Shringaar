# Testing and deployment

**Last updated:** 2026-10-11

---

## Commands

From `package.json`:

| Command | Runs |
| --- | --- |
| `npm run dev` | `vite` — dev server on **port 5173** |
| `npm run build` | `tsc --noEmit && vite build` — **typecheck runs first**, so a type error fails the build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | `vitest run` |
| `npm run test:watch` | `vitest` |
| `npm run check` | `npm run typecheck && npm run test` |
| `npm run preview` | `vite preview` |

---

## Last verified run — 2026-10-11

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** |
| `npx vitest run` | **15 files, 229 tests, all passed** (1.06 s) |
| `npx vite build` | **clean**, 4.34 s, 273 modules |

```
index.html                     1.49 kB │ gzip:   0.82 kB
assets/index-*.css            78.53 kB │ gzip:  13.94 kB
assets/index-*.js            671.22 kB │ gzip: 194.60 kB   ← entry
assets/three-*.js            791.23 kB │ gzip: 205.16 kB   ← lazy
assets/vision_bundle-*.js    145.13 kB │ gzip:  44.01 kB   ← lazy
assets/useTryOnSession-*.js   28.87 kB │ gzip:  11.02 kB
assets/TryOnLab-*.js           9.05 kB
assets/TryOnProduct-*.js       7.32 kB
```

The `>500 kB` chunk warning is **expected** — `three` is the cause and the lazy split is deliberate.
`three` and `vision_bundle` are separate chunks; the entry chunk has **no static import** of either,
and `index.html` preloads neither.

---

## Test configuration — two facts that bite

Both live in `vite.config.ts`. **There is no `vitest.config.ts`** — Vitest reads *only* that file when
it exists and would then ignore `vite.config.ts` entirely, forcing the `@` alias to be duplicated or
merged back in.

```ts
test: {
  environment: 'node',          // the tested surface is deliberately DOM-free
  include: ['src/**/*.test.ts'],
  globals: false,               // load-bearing — see below
  restoreMocks: true,
}
```

1. **`globals: false` is not a preference.** `tsconfig.json` sets `"types": ["vite/client", "node"]`,
   which is an **allowlist** — `describe`/`it`/`expect` are not ambient. **Every test file must
   `import { describe, it, expect } from 'vitest'`.** Turning globals on would let the tests run while
   `tsc --noEmit` (the first half of `npm run build`) failed with *"Cannot find name 'describe'"*.
2. **`"include": ["src", "vite.config.ts"]` means test files are typechecked by `tsc --noEmit`.**
   Tests are held to `strict` + `noUnusedLocals` + `noUnusedParameters` + `noUncheckedIndexedAccess`.

**There is no jsdom.** No React render tests are possible — the tested surface is pure functions over
plain data. Adding a component test means adding the environment first.

---

## Test layout

15 files, all under `src/**/tests/`:

| Feature | Files |
| --- | --- |
| `try-on/tests/` | `coordinates` · `framing` · `geometry` · `smoothing` · `targetSmoother` · `trackingState` · `calibration` · `earring` · `anchors` · `glb` · `rendererSelect` · `modelTransform` · `canvas2d` · `landmarkOverlay` (14) |
| `seller/tests/` | `oauth` (1) |

Fixture: `try-on/tests/helpers/syntheticFace.ts` — the only synthetic face in the repository.

### What is NOT covered

- **`utils/` and `services/` have no tests of their own.** This is a known, carried gap (`task.md`).
- No component/render tests (no jsdom).
- No integration test against a live Supabase project.

### A test that passes on broken code is worse than no test
Several tests exist specifically to catch an invisible regression — e.g. `oauthRedirectUrl` is asserted
against a **foreign** origin, because during local development `config.publicSiteUrl` and a hardcoded
`localhost` are the same string and a default-only assertion would pass either way. When adding a
test, check that reverting the logic makes it fail.

---

## Environment requirements

`.env.local` (gitignored). Template in `.env.example`.

| Variable | Effect when set | Effect when absent |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | — | with the key, **activates the live Supabase adapter** |
| `VITE_SUPABASE_ANON_KEY` | — | as above — **both are required**; a half-configured project counts as unconfigured |
| `VITE_PUBLIC_SITE_URL` | used to build shareable links and the OAuth redirect | falls back to `window.location.origin` |
| `VITE_TRYON_BASE_URL` | the product page links try-on **out** to this host | try-on resolves **in-app** at `/tryon/:productId` |

**Current local state:** both Supabase variables are set in `.env.local`, so `npm run dev` selects the
**live** adapter, not demo. To run demo mode, start the server with them blanked:

```bash
VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --port 5199 --strictPort
```

(The try-on engine needs no backend at all, so `/tryon/lab` works in either mode. Note the OAuth button
is correctly **absent** in demo mode, since `capabilities.oauth` is `false` there.)

**Camera permissions:** `getUserMedia` requires a **secure context**. `http://localhost` counts;
a plain `http://` LAN address does not.

---

## Deployment

**Status: not configured. There is no deployment.**

- `dist/` is gitignored and is a build artifact only.
- **No CI.** There is no `.github/`, no `vercel.json`, no `netlify.toml`, no `Dockerfile`.
- **No hosting target is recorded anywhere in the repository.**

`vite build` produces a static `dist/` that any static host can serve. It is an SPA, so a host must
rewrite unknown paths to `index.html` — otherwise `/tryon/:id` and every storefront URL 404 on
refresh. There is **no SSR and no prerender**.

**Branches:** local `main`; the remote PR base is **`dash`** (`origin/HEAD → origin/dash`). Git history
is one commit (`7ace935 intial main commit`); essentially all current work is uncommitted or untracked.

---

## Known issues

| Issue | Status |
| --- | --- |
| React Router `v7_startTransition` future-flag warning in the console | **Accepted deliberately.** Silencing it means opting into a behaviour change, which is not a fix. |
| Chunk-size warning from Vite | Expected — `three` is 791 kB and deliberately lazy. |
| Vitest is `^3.2.4`, not 4.x/5.x | Deliberate: vitest 5.x needs vite ^6.4\|\|^7\|\|^8, and the repo is on vite 5.4.11. |
| MediaPipe posts telemetry to `odml.pa.googleapis.com` | Documented, not suppressed. Protobuf, a few dozen bytes, no image data, rate-limited. See `ar-engine.md`. |
| `requestAnimationFrame` throttling | An occluded/hidden window throttles rAF to ~1.5 Hz while `document.visibilityState` still reports `visible`. An fps readout of `1.1` is the environment, not a bug — verified in `task.md` stage 13. |
