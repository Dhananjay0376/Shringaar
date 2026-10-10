# Session log

**Newest first.** Concise: what was done, what was found, and where the next session picks up.
The detailed record for the build stages is `task.md`; this is the handoff trail.

---

## 2026-10-11 — the earring drop is now anatomical, and mutation-tested

**The user's question:** *"cant you place earring on earlob?"* — why the piece is not simply put on the
lobe.

**The honest answer first, because it constrains everything:** there is **no ear in the 478-point
mesh at all**. The boundary runs along where the ear *attaches*; the lobe hangs below and outside it.
So **no index can be re-chosen** to find the lobe — indices 234/454 are face-oval contour at the
cheekbone, not earlobes, and there is nothing better to swap them for. The real weakness was
different: the drop was a **fixed multiple of interocular**, i.e. a bet on an average face. A long
face put the piece above the lobe; a short one put it below.

**The fix — follow the nose base.** The lobe's *position* cannot be read from this mesh, but its
*level* can: the earlobe's lower edge sits level with the base of the nose. New landmark group
`FACE_LANDMARKS.noseBase = [2, 94, 19]` (subnasale + both alar bases, averaged). `lobeDrop()` in
`anchors/earring.ts` solves the drop as the travel along the jaw direction that reaches
`(noseBaseY + lobeFromNoseBase + calibrationOffset) · interocular`. Because the nose base is a mesh
point, it **tracks head roll for free**.

Files: `core/landmarks.ts`, `core/framing.ts` (`FaceFrame.noseBase`, built with `projectGroup` —
deliberately the one **optional** field, since a frame without it is the engine's previous behaviour
rather than a frame to refuse), `anchors/earring.ts`, `tests/helpers/syntheticFace.ts`,
`tests/earring.test.ts`, plus memory.

**On a canonically-proportioned face the two answers land within ~1 px** — 172.77, 296.32 (anatomical)
vs 172.43, 295.35 (fixed) at interocular 128. A refinement, not a jump. They diverge as the face
departs from the canon, which is exactly the case the constant could not handle. All 300 pre-existing
tests still pass unchanged.

**Three guards, each with a test that dies without it** — no nose base, a near-horizontal jaw, and a
clamp on the travel. The reverted-anchor mutant fails on `295.3569`, the fixed-proportion answer,
confirming the arithmetic independently of the test's own expectation.

**A test of mine was vacuous, and the mutation is what found it.** The first flat-jaw test set `jawY`
*exactly* at the cluster height — where the quotient is `±Infinity` and the **`isFinite` branch one
line earlier** catches it. Removing the jaw guard changed nothing and the test still passed. Rewritten
to use a *nearly* flat jaw, where the quotient is finite and huge (~840 px of travel for a plausible
nose base), the mutant now dies by moving the anchor **76 px sideways** — which is precisely the
failure the guard exists to prevent, and it is now measured rather than assumed.

**Verified:** `npx tsc --noEmit` clean; `npx vitest run` → **17 files, 304 tests, all passed**. Every
guard mutated and re-run; all three mutations fail the test meant to catch them.

**Honest caveats that must be carried forward:**
1. **`lobeFromNoseBase: -0.06` is a facial-proportion canon, not a measurement of anyone.** It was
   deliberately **not** tuned to the synthetic head — fitting a constant to a face this engine drew
   itself would be fitting to a fake.
2. **Still no human face has ever been used.** All numbers above come from a fixture.
3. There is still no earlobe landmark, so `outward` remains an extrapolation past the contour.

### Next handoff point

**This supersedes the handoff under the swing entry below; it is the current one.**

**The exact next action:** open
`http://localhost:5173/s/seller-one-shringaar-test/p/52501949-6b74-470c-bfc9-7c3f5a8ce2b6` on a
machine with a **real camera and a real person**, and report **where the earring lands relative to the
earlobe** — specifically whether the drop now sits at the lobe or still high/low. That single
observation is the only thing that can move `lobeFromNoseBase` / `EAR_GEOMETRY.outward` off
"considered guess". **Still unanswered.**

Then: swap the pngtree test asset for the seller's own file via the form (P0.3), which also exercises
the Supabase **write** path that has never been driven.

---

## 2026-10-11 — earring swing physics, and a sign bug caught before it shipped

**The user's request:** the earring sat "a bit ahead of the ear" (fix the placement), and add "a bit of
physics" so it looks like a normal human earring, demoable in the 2D canvas. Time was short, so the
work was fanned out to agents.

**Two changes landed:**

1. **Placement** — `EAR_GEOMETRY.outward` **0.30 → 0.24** in `anchors/earring.ts`, on the first
   real-face report this engine has had. Kept deliberately modest: under-correcting reads as "still
   slightly out", over-correcting sinks the piece into the jaw and reads as broken.
2. **Swing** — new `core/swing.ts`, a damped driven pendulum (`θ'' = −k·sin θ − c·θ' + d·a`),
   semi-implicit Euler, drive normalised by drawn width for scale invariance, folded into
   `target.rotation` inside `useEarringRender.draw()` so both renderers share one answer. Timed off
   `performance.now()`, not `frame.at`, so it keeps running during a `holding` replay. New
   `tests/swing.test.ts` (25 tests).

**The review agent found a real defect, and it was the important one.** The drive term shipped as
`−d·a`; it must be `+d·a`. A pivot accelerating right throws its bob *left*, and in this engine's
canvas convention positive rotation puts the free end left of the anchor — so the piece **led** the
head. Nothing threw, nothing NaN'd; every moving frame would have rendered the mirror of the intended
motion, which is precisely the sticker-like tell the feature exists to remove.

- Confirmed **from the engine, not from memory**: `ctx.rotate(0.5)` read back via `getTransform()`
  places `(0, h)` at `dx = −28.77` ⇒ positive rotation is free-end-left.
- Confirmed **live and two-sided** on the real render path: canvas pivot stepped left → angle
  `−0.0289` rad; stepped right → angle `+0.0797` rad. Flips with the pivot, opposite the acceleration
  in both cases. Rings down through several sign changes; `anyNaN: false`.
- **The unit test had pinned the bug** (`toBeLessThan(0)`) — it asserted the leading direction and
  passed. Flipped, with the reason written into the file.

**A second defect: a vacuous test.** Deleting the `/ width` normalisation left the scale-invariance
test green — both inputs saturated `maxDriveAccel = 400` and agreed because the clamp had swallowed
the difference (`0.05 · 400 · dt² = 1/180` for each). Shrinking the displacement cannot fix it, because
the mutation scales the term by the factor under test. The test now lifts the rail for itself. **Both
mutations were run and both now fail the test meant to catch them.**

**Placement, re-measured properly.** The first attempt used a *swaying* face and appeared to show both
earrings ~90 px left of the ears — that was tracking latency at ~2.2 fps, not a solver error. A swaying
face cannot measure placement. With a **stationary** face, ears at known `x = 192 / 448`:

| | drawn anchor x | truth | error |
| --- | --- | --- | --- |
| left | 184.2 | 192 | −7.8 px |
| right | 453.2 | 448 | +5.2 px |

Anchor `y ≈ 262–277` sits inside the ear's vertical span (216–288). Within ~10 % of the piece width
(78.4 px) horizontally.

**Verified:** `npx tsc --noEmit` clean; `npx vitest run` → **17 files, 300 tests, all passed**.

**Honest caveats that must be carried forward:**
1. **A human face still has never been used.** Everything above is a synthetic cartoon head, whose own
   landmark fit is an approximation. There is still **no earlobe landmark** in the 478-point mesh.
2. `outward = 0.24` is a correction from **one report about one face** — not a fitted value.
3. The instrumented browser delivered only **~2.2–2.7 fps**, so **swing smoothness at 30–60 fps is
   NOT verified**. The constants have never been compared with a real earring.
4. A head **rotating** is not modelled — the pivot is the mean of the drawn targets, so both pieces are
   driven together by head translation only.

### Next handoff point — superseded by the entry above

**The exact next action:** open
`http://localhost:5173/s/seller-one-shringaar-test/p/52501949-6b74-470c-bfc9-7c3f5a8ce2b6` on a
machine with a **real camera and a real person**, launch the try-on, and report two things — where the
earring lands relative to the earlobe, and whether the swing reads as a real earring. Those two
observations are the only thing that can move `EAR_GEOMETRY.outward` / `.drop` and `DEFAULT_SWING` off
"considered guess". **Still unanswered.**

Then: swap the pngtree test asset for the seller's own file via the form (P0.3), which also exercises
the Supabase **write** path that has never been driven.



## 2026-10-11 — live 2D-overlay try-on proven on a real product row

**The user's request:** make **one** earring work from a **PNG** (the 2D overlay path, not 3D), and
add it as the **3rd product** on `krishnagtkr@gmail.com`.

**What was checked first, and it overturned an assumption:** that account already had a working
try-on button. Its two existing published earrings carry **valid `glb` v2 assets** in `tryon-assets`
(magic `glTF`, 134 meshes, 2.98 MB, `generator: glTF-Transform v4.2.1`), and the live customer page
rendered *Try-on: Available*. The missing button the user reported was a **demo-mode / dashboard
confusion**, not a broken feature — demo seeds carried `url: null`, so every demo customer page fell
to the "not available for this piece yet" branch.

**Changes made:**
- `src/features/seller/services/mockDb.ts` — `SCHEMA_VERSION` 5 → 6; `tryOn()` gained an optional
  `overlay`; `prd_demo_008` is now the one seed with a committed PNG behind it. The rule ("a seed may
  carry a URL only when the file is committed here and cannot be mistaken for a real listing") is
  written into the module, not just into memory.
- `src/assets/tryon/dev-jhumka-overlay.png` — new, 160×260 drawn jhumka, captioned `DEV
  PLACEHOLDER`, generated by a Pillow script kept outside the repo.
- `public/dev-earring-test.png` — new, 256×512, 24,472 bytes: the **left earring only**, cropped from
  the downloaded pngtree cut-out and re-cropped to its own alpha bbox (the source is a **pair**;
  the renderer draws one image per ear).
- The 3rd live product: id `52501949-6b74-470c-bfc9-7c3f5a8ce2b6`, slug `test-jhumka-2d-overlay`,
  `category = earrings`, `status = published`, `try_on_asset_kind = 'image'`, `try_on_anchor = 'ear'`,
  image + try-on URL both `/dev-earring-test.png`.

**Verified live (dev server 5173, live adapter):**
- `/tryon/52501949-…` → `TryOnRun`, status **TRACKING**, flat-image copy, and **both earrings drawn**
  on the synthetic face (`canvas.captureStream()` stand-in for a webcam).
- Console: the only try-on-page errors are MediaPipe's own `console.error` INFO line and WASM
  warnings — **the CDN runtime and the model both loaded** (unlike the demo-mode attempt on 5199).
- `/p/52501949-…` redirects to `/s/seller-one-shringaar-test/p/52501949-6b74-470c-bfc9-7c3f5a8ce2b6`
  and shows **Try-on: Available** + *Launch virtual try-on*.
- Frontend still green: `npx tsc --noEmit` clean; `npx vitest run` → **16 files, 275 tests, passed**.

**Honest caveats that must be carried forward:**
1. The pngtree source is a **free-license stock image** — free pngtree assets are licensed for
   personal use with attribution, and this is a commercial storefront. **Delete or replace the test
   listing before anything is public.**
2. The test listing's asset is served from the app's own `public/` folder, **not** from
   `tryon-assets` — a row is not a real seller upload until the form does it while signed in.
3. The face used was a **synthetic cartoon head, not a human**. Placement accuracy on real skin is
   still the open question.
4. `/p/<slug>` does **not** resolve — the canonical product path takes the **product id**. Worth
   knowing before quoting a URL.

### Next handoff point — historical

**The exact next action:** open
`http://localhost:5173/s/seller-one-shringaar-test/p/52501949-6b74-470c-bfc9-7c3f5a8ce2b6` on a
machine with a **real camera and a real person**, tap *Launch virtual try-on*, and report where the
earring lands relative to the earlobe. That single observation decides whether
`EAR_GEOMETRY.outward = 0.30` / `.drop = 0.26` need retuning (see [`ar-engine.md`](./ar-engine.md)),
and it is the same question `/tryon/lab` was opened for on an earlier session — **still unanswered**
at the time of writing. *(The constants named here are superseded: `outward` is now 0.24 and `drop` is
the fallback branch. See the rollup at the end of this file for the current values.)*

Then: swap the pngtree asset for the seller's own file via the form (P0.3), which also exercises the
Supabase **write** path that has never been driven.

---

## 2026-10-11 — asset-processing service, verified live end to end


### `backend/` — the mock-backed asset service, and the dashboard wired to it
One folder at the repository root, Python + FastAPI. `VITE_ASSET_API_URL` is the only seam; unset, the
dashboard behaves exactly as before and the "cut out of a photo" panel is not rendered. New frontend
pieces: `seller/services/assetApi.ts`, `seller/hooks/useAssetJob.ts`, `seller/components/AssetProcessor.tsx`,
`styles/asset-pipeline.css`, and an optional panel inside `TryOnAssetField.tsx`.

**Two contract mismatches were found and fixed before they could render as `undefined`:**
1. `POST /api/jobs` returns **only** `{ id, state, status_url, created_at }` — a partial job. `createAssetJob`
   now reads the job back, so the screen renders real stages immediately instead of an empty list.
2. `DerivedAsset` had no `mimeType`. Added it rather than having the UI synthesise `'image/png'`, because
   the server reports the real type and the client should not invent it.

**A real gap was found by running it, not by reading it.** The mock's cut-out mask is drawn ellipses,
and `build_providers` constructed it with the default `item_count=1` — so the **pair** branch, which is
the case the review screen exists for, was **unreachable through the running service**. It was covered
by `test_workflow.py` only because that test builds the provider by hand. Fixed with
`ASSET_MOCK_ITEM_COUNT` (1–3, default 1), reported on `/health` as `providers.background_items`, plus
two tests. Backend is now **158 tests**.

**Verified live in a browser** (demo-mode dashboard on 5201, service on 8140, `mock` +
`ASSET_ENABLE_3D=true` + `ASSET_MOCK_ITEM_COUNT=2`), with a synthetic 520×360 two-jhumka PNG:
upload → validate-from-bytes → transparent cut-out with `SIMULATED` burned into the pixels → **2 items
separated** (`left`/`right`, `pair`, confidence 1.0) → one flat-card GLB each → review → **approve
returned 200 and only the chosen asset was recorded** (sibling cut-out and both 3D files stayed
`false`). Declaring "One piece" produced the confirmation prompt; **"Run again with this" created a new
job** that resolved cleanly. No request to the Supabase API during the flow.

**Honest boundaries:** no authentication on the service (loopback only, anyone with a job id can read
it), in-memory job store, no Supabase job/asset tables, no real background removal, no real 3D
reconstruction — the `.glb` is a **flat card**, explicitly not a model of the piece. The "supplied
green-and-gold jhumka pair" image referred to in the spec **does not exist in the repository**
(`backend/app/tests/images.py` says so); a synthetic fixture was generated and kept outside the repo.

**Frontend:** 275 tests across 16 files, `tsc --noEmit` clean, `vite build` clean (277 modules, entry
690.31 kB / 199.90 kB gzip; `three` and `vision_bundle` still separate lazy chunks — the heavy graphs
did not leak into the entry).

### Memory corrected in the same session
`asset-pipeline.md`'s headline (*"No image-to-3D pipeline exists in this repository, and none is
planned"*) was **wrong the moment `backend/` landed** and is rewritten: `src/` still has none, the
service produces a 2D cut-out and a flat-card `.glb`, and real reconstruction is **deferred on cost, not
rejected**. Also updated: `MEMORY.md` (honesty rule 1 + the tree), `current-state.md` (test/build
numbers, the new service, two new UNVERIFIED rows), `tasks.md` (a "Deferred, not rejected" section —
the old text said photograph→3D was *not planned*).

---

## 2026-10-11 — Google sign-in, documentation, memory system

### Google sign-in on `/sign-in` (implemented)
A `Continue with Google` button, gated on a new `ServiceCapabilities.oauth` flag — deliberately
**separate from `auth`**. Added `OAuthProvider` + `OAUTH_PROVIDER_LABELS` to `lib/seller.ts`,
`signInWithOAuth` to the service interface, the real implementation in `supabaseSellerService.ts`,
`signInWithGoogle` in `SellerContext`, `utils/oauth.ts` (redirect URL + error reader), and
`onboarding/components/GoogleMark.tsx` (the brand mark, kept out of `Icon.tsx` because that set is
stroke-based and `currentColor`-tinted). 14 tests in `seller/tests/oauth.test.ts`. `arch.md` §5 and
`design.md` §7 updated.

**No new dependency** — a redirect flow on the already-present `@supabase/supabase-js`.

**Verified:** `tsc --noEmit` clean, 229 tests pass. **Not verified:** the live flow, which needs a real
browser and a Google account.

### Try-on lab opened for a manual real-face test
`/tryon/lab` opened in the browser on the demo-mode dev server (port 5199). The lab needs no backend.
**Outcome not yet reported** — this is the open thread.

### This memory directory created
`memory/` + the repository-root `CLAUDE.md`. While populating it, **documentation drift** was found in
`task.md` and `arch.md` (the "blocked on a backend" list and "no Supabase project exists yet" are both
stale; the test count is stale). Recorded in `current-state.md`, **not yet corrected in the source
docs**.

**Also checked:** `npx vite build` — clean, 273 modules, entry 671.22 kB / 194.60 kB gzip.

---

## 2026-10-11 (early) — Stage 13 follow-through
`src/features/try-on/` completed: camera, MediaPipe adapter, loop, tracking state machine, framing,
coordinates, smoothing, target smoother, calibration, the earring solver and registry, the Canvas 2D
and Three.js renderers with `chooseRenderer`'s validation gate, GLB byte inspection, the dev
placeholder asset, `/tryon/lab` and `/tryon/:productId`, and 14 test files.

Three defects were found by measurement rather than by reading:
1. **A `showLabels` gate where a `showDiagnostics` gate was meant** — the customer page drew landmark
   dots it should not have. Found by instrumenting `CanvasRenderingContext2D.prototype`.
2. **Two GLB slot groups were cloned and stored but never added to the scene** — a validated model
   produced zero draw calls and **no error at all**, indistinguishable from a failed load.
3. **A `.glb` reachable from the customer page with no validation gate** — closed by making
   `chooseRenderer` take the validation as a second argument.

Verified live with a **synthetic cartoon head** standing in for a webcam: 478 landmarks, both earrings
drawn, calibration symmetric to 0.1 px. **A real human face was never used** — see `current-state.md`.

---

## 2026-10-10 — Stages 1–12 and two verification passes

**Stages 1–8.** React + Vite + TS from an empty directory. Seller shell, Home, Collection, Products,
Add/Edit product, Store, Analytics, Settings. The `SellerService` abstraction with a demo adapter.

**Stage 9.** The reference theme extracted from a supplied landing page — palette, one typeface
(Inter Tight), radii, alpha-based line tokens. `tokens.css` rewritten with provenance recorded at the
top of the file.

**Stages 10–12.** Marketing landing page (drawn app mockups, no stock photography), the four-screen
onboarding flow, Home + Collection.

**Verification pass 1** — the dashboard scrolled sideways at 390px (`documentElement.scrollWidth` was
**715px**). Two independent leaks: bare `fr` grid tracks, and an absolutely-positioned `.sr-only` label
escaping `.table-wrap`'s clip. Also: the seed activity feed mislabelled products, seeded try-on assets
were presented as real files, the My Store preview ignored the form, and customer pages inherited the
seller's tab title.

**Verification pass 2** — feature cards rendered as empty dark frames, the footer was cream-on-cream,
the demo banner told new sellers their own products were "sample data", and Collection printed the
description twice. **16 routes × 3 widths = 48 combinations** re-checked with no horizontal overflow.

Both passes are recorded in full, with the evidence, in `task.md`.

---

## Next handoff point

**Where to resume.** This rollup is kept current; the per-entry handoffs above are history.

1. **The open thread, still unanswered, and the highest-value thing anyone can do:** open
   `http://localhost:5173/s/seller-one-shringaar-test/p/52501949-6b74-470c-bfc9-7c3f5a8ce2b6` on a
   machine with a **real camera and a real person**, and report **where the earring lands relative to
   the earlobe** and **whether it swings believably at a real frame rate**. Every measurement this
   engine has is from a synthetic cartoon head; the drop constants (`lobeFromNoseBase: -0.06`,
   `EAR_GEOMETRY.outward = 0.24`) and `DEFAULT_SWING` are all **considered guesses** until someone
   answers that. Note the constants moved on 2026-10-11 — `drop: 0.26` is now only the **fallback**
   used when a frame carries no nose base, not the primary answer.
2. **`tasks.md` P0** is the priority queue: verify the live Supabase migration state, configure the
   Google redirect URLs and test the sign-in live, then drive the Supabase adapter against real rows.
   P0.1 is the cheapest and unblocks the rest.
3. **The asset service has no persistence and no auth.** The next real step for it is the Supabase
   `processing_jobs` / `assets` tables with RLS, which is also what makes the spec's ownership rule —
   *a seller must not reach another seller's assets* — enforceable rather than theatre. Do not expose
   the service beyond loopback before that lands.
4. **Uncommitted:** essentially the whole application, including `backend/`. Git history is one commit;
   `src/features/try-on/`, `src/features/onboarding/`, `src/features/marketing/`, `src/features/seller/tests/`,
   `supabase/`, `backend/`, and the memory directory are all untracked or modified. Nothing has been
   committed since `7ace935`.
