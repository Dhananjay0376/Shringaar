# Decisions

**Last updated:** 2026-10-11

Format: **decision** → why → what was rejected. Only decisions that are load-bearing or
counter-intuitive are here; the rest are in `arch.md`.

---

## Architecture

### One SPA, many sellers — separated by data, not by route prefix
Every store carries `owner_id`; every product reaches its owner through `store_id → stores.owner_id`.
RLS enforces it.
**Rejected:** per-seller app instances or route prefixes. More instances, no simpler ownership.

### Feature-modular, not layer-modular
All seller code in `features/seller/`, storefront in `features/storefront/`, and a one-way dependency
between them.
**Rejected:** `src/services/`, `src/components/`, `src/pages/` splits. Those make the *one-way rule*
unenforceable by a grep.

### The dashboard never talks to a database directly
`pages → hooks → SellerService → adapter`. Three adapters, one interface, selected in exactly one
place (`createSellerService()`).
**Rejected:** direct Supabase calls in components; a "demo flag" scattered through pages. Both make
demo mode a per-screen claim instead of a single switch.

### `lib/seller.ts` is the shared contract, with an `export *` shim left behind
`arch.md` §9 rule 1 anticipated this move, triggered by the AR module becoming the third consumer.
The shim is `export *`, **not** `export type *`, because the module also exports the runtime values
`ServiceError`, `isServiceError` and `NotImplementedInDemoError`. 37 import sites unchanged.
**Rejected:** a third feature importing across features.

### Products carries no owner column
Ownership is `products.store_id → stores.owner_id`, enforced by an `EXISTS` predicate in RLS.
**Rejected:** a denormalised `products.seller_id` (the original `arch.md` §7.3 sketch). A
denormalised owner that disagrees with the store's is an ownership bug waiting to happen, and the
product spec forbids redundant ownership fields where a relationship determines ownership.

### `analytics_events` is append-only and written by the *public* storefront
The dashboard reads aggregates and **never writes** here.
**Rejected:** letting the dashboard record its own metrics — a seller who can insert their own rows
can inflate their own numbers.

### `slug_available()` is `SECURITY DEFINER`
Onboarding must answer "is this slug free?" *before* inserting, but `stores` is owner-only under RLS
and the row in question is a half-built store the asker cannot see. The function returns one boolean
and no row.
**Rejected:** a client-side uniqueness check (impossible for the above reason); a public read of
`stores` (leaks every seller's row).

---

## Authentication

### `oauth` is a capability of its own, not a flag on `auth`
`ServiceCapabilities` has **both** `auth` and `oauth`. They are different claims: a backend can verify
an email and password and have no third-party provider configured. A screen that read `auth` as "show
the Google button" would offer a door that does not open.
**Rejected:** overloading `auth`. The demo adapter reports `oauth: false`, so the button is *absent*
rather than present-and-failing.

### A provider sign-in redirects back to `/sign-in`, not the dashboard
The sign-in screen already decides where a seller belongs (`landingPathFor(seller, store)`). A brand-new
Google seller has an account and **no store**; landing on a dashboard would bounce them straight back.
**Rejected:** redirecting to `/seller/dashboard` — skips the only routing decision that matters here.

### `signInWithOAuth` returns `void`
On success the browser has already left for the provider; the function resolves only on the failure
path. It deliberately does **not** set `seller`/`store` — the session is picked up on return by
`getSession()` on mount plus the existing `onAuthStateChange` listener, which covers the race where the
first session read happens before supabase-js has exchanged the PKCE code.
**Rejected:** faking a session locally. `mockSellerService.signInWithOAuth` throws
`NotImplementedInDemoError` instead — a dashboard that looks signed in with Google and is not is worse
than a refusal.

### `prompt: 'select_account'` on Google
Prevents silent reuse of a browser's existing Google account on a shared machine.

---

## Try-on

### A product photo is never converted into a 3D model
`TryOnAsset` is a **separate first-class field** carrying its own kind (`image | glb | usdz | none`),
anchor and upload state. The upload UI states the rule beside the field.
**Rejected:** inferring asset kind from a file extension on read — a guess dressed as a mapping.

### `chooseRenderer` is pure and takes *two* arguments
`(asset, validation)`. A `.glb` reaches Three.js only when the declared asset and the measured
validation agree; `unchecked` does **not** count as agreement.
**Rejected:** switching to 3D because a URL looks like a model. Explicitly forbidden by the client spec.

### An invalid `.glb` yields `renderer: 'none'`, not a Canvas 2D fallback
An `ArAsset` carries exactly one URL, and for a `.glb` it points at a model. `drawImage` cannot draw a
model, so a "flat overlay" would fail at load and surface as a load error — a renderer named in the
choice that can never render the asset it was chosen for. The product's own photograph is not a
substitute: it is a composed catalogue shot, not a cut-out, and product images are kept separate from
AR assets.
**Rejected:** the plan's original "fall back to a 2D overlay if one exists" — one never exists.

### Only earrings have a solver
`anchors/registry.ts` returns a solver for `earrings` and `null` for every other category, rendered as
*"not available yet for this category"*.
**Rejected:** stubbing the other anchors to make the list look complete. An empty stage reads as a bug;
a stated absence reads as a missing feature.

### The synthetic face is confined to a test helper
`try-on/tests/helpers/syntheticFace.ts`. The customer route uses a real webcam.
**Rejected:** a synthetic-face demo on a customer route. The client spec forbids building "another fake
demonstration".

### `NEUTRAL_CALIBRATION` is `{ size: 1, outward: 0, drop: 0, tilt: 0 }`
The solver's anchor maths is unit-tested for *form* only. The calibration offsets start at zero.
**Rejected:** seeding the offsets with the ~35 px outward value observed on the **synthetic cartoon
head**. That is a property of a cartoon whose ears sit inboard of the landmarks 234/454 trace, and the
client spec forbids hardcoding it as a real-human default.

### MediaPipe: CDN, exact version pin, CPU delegate
- WASM from `cdn.jsdelivr.net`, model from `storage.googleapis.com`, both as two constants in
  `tracking/mediapipe.ts` so vendoring is a two-line change.
- The pin is exact (`1.1.0`) in **both** URLs: the JS loader and the wasm binary are a matched pair, and
  a mismatch surfaces as an opaque "failed to asynchronously prepare wasm".
- `delegate: 'CPU'` — the GPU delegate needs a WebGL context bound to a canvas and would compete with
  the Three.js renderer for it. At 640×480 CPU holds frame rate.
- `numFaces: 1` — MediaPipe applies its own temporal smoothing **only** when exactly one face is requested.
**Rejected:** vendoring the assets (larger bundle, not needed yet); a GPU delegate.

### `three` is reached only through `await import()`
Static imports of `three` and `@mediapipe/tasks-vision` are forbidden — measured: a static import of the
MediaPipe runtime took the entry chunk from 666 kB to 830 kB. Verified post-build: `three` lands in its
own lazy chunk and the entry chunk has no static import of either.

### `crossOrigin` is deliberately **not** set on try-on images
The renderer only draws — no `getImageData`, no `toBlob`, no snapshot export — so canvas tainting is
harmless. `crossOrigin = 'anonymous'` only helps if the storage response carries a matching
`Access-Control-Allow-Origin`; a bucket policy that omits the deployed origin would then fail to load
the image **at all**, converting a harmless taint into a broken try-on.
**Revisit only if** a "save this look" feature is added — that needs `crossOrigin` *and* a bucket CORS
`GET` policy.

---

## Presentation

### The theme was read off the reference page, not eyeballed
Palette, type and radii were extracted from the supplied landing page. Token *names* are the contract:
`--gold-*` was replaced by `--brand-*` of the same shape, so the brand can change back without touching
a component. One typeface (Inter Tight); display set at **weight 400** with `-0.045em` tracking — the
reference's signature move and the easiest thing to lose.

### No second theme, and no dark mode
Dark *bands* exist (feature band, footer). A dark variant of the app surfaces does not, and is a second
theme rather than a toggle. `arch.md` §9 and `design.md` §9 record this.

---

## Pending — decided later, not yet resolved

| Question | Where it stands |
| --- | --- |
| Keep or delete the seeded test accounts (`seller.one@shringaar.test`, `seller.two@shringaar.test`) | Open. Raised with the user; no answer yet. |
| Commit `.mcp.json` or gitignore it | Open. It is currently untracked. |
| Render `city` on the public storefront, or drop the field | Open. Captured at sign-up, stored, shown on the dashboard header — no customer surface shows it. The onboarding hint was softened so it stops promising a placement that does not exist. |
| A store *banner* image | No column and no UI exist. Would be a schema + form + storefront change. |
