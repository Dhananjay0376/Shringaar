# Current state

**Last updated:** 2026-10-11
**Method:** every claim below was checked against the working tree, or the command was actually run.
Anything not checked is marked **UNVERIFIED** rather than left to look true.

---

## Verified green, run on 2026-10-11

| Check | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | **clean** |
| Tests | `npx vitest run` | **17 files, 304 tests, all passed** (1.08 s) |
| Backend tests | `python -m pytest` (from `backend/`) | **158 passed** (5.6 s) |
| Build | `npx vite build` | **clean**, 5.26 s, 277 modules |

Build output (current):

```
index.html                     1.49 kB │ gzip:   0.82 kB
assets/index-*.css            83.94 kB │ gzip:  14.74 kB
assets/index-*.js            690.31 kB │ gzip: 199.90 kB   ← entry
assets/three-*.js            791.23 kB │ gzip: 205.16 kB   ← lazy
assets/vision_bundle-*.js    145.13 kB │ gzip:  44.01 kB   ← lazy
assets/useTryOnSession-*.js   28.87 kB │ gzip:  11.02 kB
assets/TryOnLab-*.js           9.05 kB
assets/TryOnProduct-*.js       7.32 kB
```

`three` and `vision_bundle` are separate lazy chunks; the entry chunk has no static import of either.
The >500 kB warning is expected — `three` is the cause and it is deliberate.

---

## What works — implemented and verified

### Seller dashboard
Stages 1–12 in `task.md`. Shell, Home, Collection, Products, Add/Edit product, Store, Analytics,
Settings. Works in **demo mode** (browser-local, seeded, labelled) and through the **Supabase
adapter** (code-complete; see UNVERIFIED below).

### Marketing + onboarding
Landing page, SignIn, CreateStore, StoreReady, BatchProducts, SessionGate — each its own URL.
Walked end to end in verification pass 2 (`task.md`).

### AR try-on — earrings, real camera
`src/features/try-on/`. Camera + MediaPipe Face Landmarker (VIDEO mode), a face-local frame, ear
anchors derived from face-oval points near the ear, calibration, Canvas 2D and gated Three.js
renderers. Detail in [`ar-engine.md`](./ar-engine.md).

Verified **live in a browser** (recorded in `task.md` stage 13):
- Landmark overlay off by default on the customer page (`arc: 0`, `fillText: 0`, `stroke: 0` over 3 s).
- Camera released on both Stop and navigate-away; exactly one overlay under `<StrictMode>`.
- Nothing uploaded — no Supabase request during a session.
- A validated 600-byte `.glb` renders: 7600 lit px for one ear, 15200 for two, 0 for an empty frame.
- The full flow driven end to end with `getUserMedia` replaced by `canvas.captureStream()` and a
  **synthetic cartoon head**: MediaPipe locked on with 478 landmarks, confidence 0.70.

### Google sign-in
Implemented 2026-10-11. `ServiceCapabilities.oauth`, `signInWithOAuth` on the interface, the Supabase
adapter, a `Continue with Google` button on `/sign-in`, `GoogleMark.tsx`, `utils/oauth.ts`, and 14
tests in `seller/tests/oauth.test.ts`. **Code and tests verified; the live flow is not** — see below.

### Supabase — the live project
8 migrations written in `supabase/migrations/`; **all 8 confirmed applied** to project
`bothonopxtznzviieoic` on 2026-10-11 (Supabase MCP `list_migrations`, timestamps `20261010142016` …
`20261010153530`). Schema, RLS, storage buckets, function hardening. See
[`database-and-auth.md`](./database-and-auth.md).

**The live adapter was exercised against real rows on 2026-10-11** (dev server on 5173, `dataSource:
'live'`):
- The account `krishnagtkr@gmail.com` owns one store, `seller-one-shringaar-test`, with published
  products whose `.glb` try-on assets sit in `tryon-assets`.
- A customer product page resolved by **bare id** (`/p/<id>`) redirects to the canonical
  `/{storeSlug}/p/{productId}` URL; the product page renders **Try-on: Available** and a
  *Launch virtual try-on* link.
- **Confirmed by the storage policy, not by assumption:** `anon` has no INSERT grant on
  `storage.objects` — only `authenticated`, keyed on `(storage.foldername(name))[1] = auth.uid()`.
  The frontend therefore **cannot** upload without a signed-in session, and no test asset was placed
  in a bucket from here. See the 2D-overlay note below for how the one test listing was served.

### Try-on, live, on a real product row (2D overlay path)
Verified **in a browser on 2026-10-11**, live adapter, against a product row that carries
`try_on_asset_kind = 'image'`:
- `/tryon/<productId>` reached the drawable `TryOnRun` branch (not the "no try-on for this piece"
  branch), status **TRACKING**, and the copy correctly switched to the flat-image wording.
- Both earrings drew on the tracked face; `getUserMedia` was replaced by a
  `canvas.captureStream()` synthetic cartoon head, as in stage 13.
- `browser_console_messages` shows the only try-on-page errors are MediaPipe's own
  `console.error` INFO line and WASM warnings — **the CDN runtime and the `face_landmarker.task`
  model both loaded.**
- **Still unmeasured: a real human face.** Placement accuracy remains the open question — see below.

### Earring swing physics — measured, then corrected
Added 2026-10-11: `core/swing.ts`, a damped driven pendulum folded into `target.rotation` upstream of
both renderers, so the flat and 3D paths cannot disagree about whether a piece swings. Detail in
[`ar-engine.md`](./ar-engine.md).

**A sign error was found by adversarial review, confirmed independently, and fixed.** The drive term
shipped as `−d·a`; it must be `+d·a`. A pivot accelerating right throws its bob *left* (pseudo-force
`−mA`), and in this engine's canvas convention a positive angle puts the free end left of the anchor —
so the piece was *leading* the head, the exact sticker-like tell the feature exists to remove. Nothing
threw and nothing NaN'd; it would simply have rendered the mirror of the intended motion forever.

- The convention is **not assumed**: `ctx.rotate(0.5)` read back through the canvas's own
  `getTransform()` places the local point `(0, h)` at `dx = −28.77`, i.e. positive ⇒ free end left.
- **Verified live, two-sided, on the real render path** (canvas pivot stepped left, then right):
  leftward → angle `−0.0289` rad, rightward → angle `+0.0797` rad. It flips sign with the pivot and is
  opposite the acceleration in both cases — trailing. Ring-down continues through several sign changes
  (underdamped); `anyNaN: false`.
- The unit test had **pinned the bug** (`expect(after.angle).toBeLessThan(0)`) and was flipped.
- A second, **vacuous** test was found by mutation: deleting the `/ width` normalisation left the
  scale-invariance test passing, because the `maxDriveAccel = 400` rail clamped both inputs to the same
  angle. It could not be fixed by shrinking the motion — removing `/ width` scales the term by the very
  factor under test — so the test now lifts the rail for itself. Both mutations now fail the tests
  meant to catch them; this was run, not reasoned.
- The swing measurement is still **~2.7 fps in the instrumented browser**, so **smoothness at 30–60 fps
  is NOT verified**, and the constants have never been compared with a real earring.

### Ear-anchor placement — measured on a stationary synthetic face
`EAR_GEOMETRY.outward` lowered **0.30 → 0.24** on the first real-face report ("a bit ahead of the
ear"). Measured after the change, **stationary** synthetic face, canvas 640×480, ears drawn at known
`x = 192 / 448`:

| | drawn anchor x | truth | error |
| --- | --- | --- | --- |
| left | 184.2 | 192 | **−7.8 px** |
| right | 453.2 | 448 | **+5.2 px** |

On a drawn asset width of 78.4 px (interocular ≈ 196 px), the anchor now sits within ~10 % of the piece
width of the ear centre, and `ay ≈ 262–277` falls inside the ear's own vertical span (216–288). Before
the correction it would have sat ~12 px further out.
This is a **method fix, not a fitted value or a real-face result**: it was measured against a cartoon
head, whose own landmark fit is an approximation, and there is still **no earlobe landmark** in the
478-point mesh to check the extrapolation against. The per-face correction remains the slider.

**A swaying face cannot measure placement.** An earlier screenshot appeared to show both earrings
~90 px left of the ears; that was a tracking-latency artifact at this browser's ~2.2 fps, not a solver
error. Placement must be measured with the face held still.

### Earring drop — now anatomical, and unit-tested for it
The drop is no longer a fixed multiple of interocular. `lobeDrop()` in `anchors/earring.ts` measures
the **nose base** (landmarks `2, 94, 19`) and solves the drop as the travel along the jaw that reaches
`lobeFromNoseBase: -0.06 · interocular` above it, so the piece follows the subject's own face instead
of an average one — and rolls with the head for free, because the nose base is a mesh point. Full
description, the three guards, and the canon caveat in [`ar-engine.md`](./ar-engine.md).

**Verified, run this session:** `npx tsc --noEmit` clean; `npx vitest run` → **17 files, 304 tests,
all passed**. On the canonical fixture the anatomical and fixed answers agree within ~1 px (172.77,
296.32 vs 172.43, 295.35) — the change is a refinement where the face matches the canon and a
correction where it does not. All three guards were **mutated and the mutation run**: reverting the
anchor fails on `295.3569` (the fixed answer, computed independently), removing the clamp fails only
the clamp test, and removing the jaw guard moves the anchor **76 px sideways**. The first flat-jaw
test was **vacuous** — it used an exactly-flat jaw, where the `isFinite` branch catches the division
one line earlier — and was rewritten to use a nearly-flat jaw, which is the case the guard exists for.

**What is NOT verified:** `lobeFromNoseBase` is a facial-proportion canon, deliberately **not** tuned
to the synthetic head, and has **never been checked against a human face**. The measured numbers above
come from a fixture, not a camera.

### Asset processing service — `backend/`
Added 2026-10-10/11. A FastAPI process, mock-backed, no AWS, no GPU, no paid API, no external model
download. Upload → validate → simulated background removal → item detection/separation → 2D assets
→ optional flat-card 3D → review → approve/reject, with a retryable failure path and a low-confidence
confirmation prompt. The dashboard reaches it only when `VITE_ASSET_API_URL` is set; unset, every
existing upload path is unchanged and the panel is not rendered. Detail in
[`asset-pipeline.md`](./asset-pipeline.md).

Verified **live in a browser on 2026-10-11** (demo-mode dashboard on 5201, service on 8140 with
`ASSET_PROVIDER=mock ASSET_ENABLE_3D=true ASSET_MOCK_ITEM_COUNT=2`):
- A synthetic 520×360 two-jhumka PNG uploaded and validated from its decoded bytes (`PNG 520×360
  accepted`, `simulated: false` on the validation stage).
- The cut-out came back as **transparent RGBA with `SIMULATED` burned into the pixels**.
- Detection separated the pair: **2 items**, roles `left` / `right`, `resolved_configuration: pair`,
  confidence 1.0. One flat-card GLB per item, each labelled *"Simulated — a flat card, not a real
  model"*.
- Declaring "One piece" for the same pair produced the confirmation prompt verbatim (*"You said this
  is a single item, but two separate pieces were found…"*); **"Run again with this"** created a
  **new** job that resolved cleanly with no prompt.
- `POST /api/jobs/{id}/approve` → 200; the job settled **`approved`** with **only the chosen asset
  `approved=true`** — the sibling cut-out and both 3D files stayed `false`.
- The approved cut-out was handed to the existing try-on field as `jhumka-pair-left.png` with the
  provenance callout, and "Saving" is still the separate, explicit step.
- **No request left the origin for the Supabase API** during the flow. (Three network entries match
  `supabase`, and all three are the Vite dev server serving its own source files — the module graph
  imports `supabaseSellerService`, so the bundle loads it; nothing was called.)

**Not built, not claimed:** real background removal, real 3D reconstruction, the Supabase
`processing_jobs` / `assets` tables with RLS, AWS/SQS/GPU deployment, and **any authentication on the
service** — it is loopback-only and anyone with a job id can read it.

---

## UNVERIFIED — do not read as working

| Item | Why it is unverified |
| --- | --- |
| **The Google OAuth flow end to end** | Needs a live browser and a real Google account. The dev server used for verification runs in demo mode, where `capabilities.oauth` is `false` and the button is correctly absent — so that server cannot exercise the path. |
| ~~Whether the 8 migrations are applied~~ | **RESOLVED 2026-10-11 — all 8 are applied.** See "Live Supabase project" below. |
| **The Supabase adapter's write paths** | Reads against live rows are now verified (below). **Writes through the form — create product, upload image, create store — are still undriven.** `.env.local` holds both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, so a local dev server selects the **live** adapter. |
| **A real human face for try-on** | Every live try-on run so far used a synthetic cartoon head. Placement accuracy on real skin, hair, glasses and lighting is **unmeasured**. That now includes `lobeFromNoseBase: -0.06`: the nose-base anchor is unit-tested and its fallbacks are mutation-tested, but the constant itself is a **proportion canon** that has never been compared with a real earlobe. |
| **Swing smoothness at a real frame rate** | The direction is verified live, but every run was at ~2.2–2.7 fps in an instrumented browser. Whether the motion reads as smooth at 30–60 fps is **unmeasured**, and `DEFAULT_SWING` has never been compared against a real earring. |
| **`holding` replay path** | Implemented and reasoned; never triggered on camera. |
| **Real device / iOS Safari / phone front camera** | Not tested. No cross-browser claim. |
| **3D quality** | Only "a validated GLB loads and renders". Lighting untuned, no animation played. |
| **End-to-end sign-up with real email** | Blocked earlier by email confirmation and sender rate limiting. Status not re-checked. |
| **The asset service on anything but loopback** | It has **no authentication** and an in-memory job store. Every live run so far was on `127.0.0.1`. Nothing about ownership or multi-seller isolation has been exercised. |
| **The `baseline` (non-mock) provider end to end** | Unit-tested directly, but the live browser run used the `mock` set only. The baseline remover's behaviour on a real photograph is unmeasured. |

---

## Documentation drift — the source docs are stale in places

Found while building this memory directory. **These files have not been corrected yet**; the
corrections are listed so the next session can make them.

1. **`task.md` "Open items → Blocked on a backend"** lists *"Create the Supabase project and apply the
   schema + RLS"* and *"Implement `createSupabaseSellerService()`"* as not done. Both now exist
   (`supabase/migrations/`, `supabaseSellerService.ts`). The list is stale.
2. **`arch.md` §2** says the data row is *"service abstraction + browser-local mock — no Supabase
   project exists yet"*. There is now a Supabase adapter and a migration set.
3. **`task.md` stage 13** records *215 tests across 14 files*. The suite is now **229 across 15**.
4. **`arch.md` §7** is titled *"Tables (proposed schema)"* and describes a denormalised
   `products.seller_id` that the migrations deliberately do **not** have (see `decisions.md`).

---

## Known gaps shipped as-is (not defects)

- `city` is stored and shown on the dashboard header but rendered on **no customer surface**.
- The demo seed's try-on assets are **descriptions with no stored file**, with exactly one exception:
  `prd_demo_008` ("Pearl Drop Jhumka") carries a **committed, obviously-fake PNG**
  (`src/assets/tryon/dev-jhumka-overlay.png`, captioned `DEV PLACEHOLDER` inside a dashed box) so the
  demo-mode try-on route is reachable at all. A seed may carry a URL **only** when the file is in
  this repository and cannot be mistaken for a real listing — no `.glb` seed does, because no model
  is committed and filling the URL in would dress an empty record up as a try-onable product.
  `SCHEMA_VERSION` is **6**; a stale `localStorage` payload is discarded and re-seeded.
- The one **live** test listing (`Test Jhumka (2D overlay demo)`) points at
  `/dev-earring-test.png` — a file served from the app's own `public/` folder, **not a seller
  upload**, because `anon` cannot write to `tryon-assets` (see above). Its own description says so.
  The durable path is to upload the same PNG through the form while signed in.
- The React Router `v7_startTransition` future-flag warning is left in place deliberately — silencing
  it means opting into a behaviour change.
- MediaPipe posts small rate-limited telemetry beacons to `odml.pa.googleapis.com` (protobuf, a few
  dozen bytes: library version and counters, **no image data**). The customer line *"no photo or video
  leaves your device"* is accurate; *"everything runs in your browser"*, read as *no network calls at
  all*, is not. Flagged, not silently accepted. Recorded in `arch.md` §8.
