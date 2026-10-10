# Tasks

**Last updated:** 2026-10-11
**Note:** `task.md` is the detailed stage-by-stage tracker with two verification passes. This file is
the **priority order for what comes next**. Where they disagree, this file is newer.

---

## P0 — verify before building anything else

The code is ahead of the verification. Everything below is a check, not a feature.

### 1. ~~Confirm the live Supabase schema matches the migrations~~ — **DONE 2026-10-11**
**Result:** `list_migrations` returned all **8** timestamps (`20261010142016` … `20261010153530`). The
remote schema matches `supabase/migrations/`. **The gap this task existed to find does not exist.**
What it unblocked is recorded in [`current-state.md`](./current-state.md) → "Live Supabase project".

### 2. Configure the Google redirect URLs, then test sign-in live
**Why:** the button is on `/sign-in` and the code is tested, but the redirect has never completed
against a real provider.
**Steps:**
- Supabase → Authentication → URL Configuration → Redirect URLs: add `<origin>/sign-in` for **each**
  origin the app is served from (`http://localhost:5173/sign-in` for dev, plus any deployed origin).
- Supabase → URL Configuration → Site URL: the deployed origin.
- Google Cloud Console → Authorized redirect URIs must contain
  `https://<project-ref>.supabase.co/auth/v1/callback`.

**Acceptance:** a real Google sign-in returns to `/sign-in`, a session appears, and a **brand-new**
seller is routed to store creation rather than a dashboard. Cancelling the consent screen shows *"You
closed the sign-in window before finishing, so nothing changed."* and leaves the URL clean.

### 3. Drive the Supabase adapter's **write** paths against real rows
**Why:** `.env.local` has both Supabase variables set, so `npm run dev` selects the **live** adapter.
Reads are now verified (P0.1 result, and the live product page); **nothing has written yet.**
**Acceptance:** create a store, add a product with an image and a try-on asset **through the form**,
confirm the rows land in `stores`/`products` and the objects in the right bucket; confirm the public
storefront resolves the store by slug and the product by id while **signed out**; confirm a second
account cannot read the first's rows. Record what fails.

**A known blocker on the asset half:** `anon` cannot INSERT into `storage.objects` — only
`authenticated`, keyed on the leading path segment being `auth.uid()`. Any try-on-asset upload test
therefore needs a real signed-in session, and the session must be the store owner's.

---

## P1 — the honest gaps that matter

### 4. A real-face placement pass
**Why:** the single most likely thing to disappoint, and the only unmeasured result. The anchor offsets
(`k_out ≈ 0.35`, `k_down ≈ 0.30`) are reasoned and unit-tested for *form*, never checked against a
human ear.
**How:** `/tryon/lab` on a real face. Watch the landmark overlay against the *"Indices the solver
reads"* card; confirm the ear-cluster points sit near the ear. Then judge where the earring lands and
whether the calibration sliders can correct it.
**Acceptance:** either the placement is acceptable, or the offsets are retuned and the new values are
recorded in `ar-engine.md` **with the observation that produced them**. Do not tune to a synthetic head.

### 5. Fix the documentation drift
Listed in [`current-state.md`](./current-state.md). Four items: `task.md`'s stale "blocked on a
backend" list, `arch.md` §2's "no Supabase project exists yet", the test count, and `arch.md` §7's
proposed `products.seller_id` that the migrations do not have.
**Acceptance:** each corrected in the same commit as the next relevant change.

---

## P2 — blocked on a decision or a schema change

| Task | Blocker / note |
| --- | --- |
| Try-on session events (`tryon_start` → `tryon_complete`) | The event **types** exist in `analytics_events`; no anon INSERT policy does, so nothing is written. A schema change, not a client change. |
| Aggregate analytics queries | The dashboard must never write its own metrics. Needs a read path for real (non-demo) aggregates. |
| `city` on the storefront | Either render it or drop the field — see [`decisions.md`](./decisions.md). |
| Seeded test accounts — keep or delete | Open question with the user. |
| `.mcp.json` — commit or ignore | Currently untracked. |
| Reconcile the upload caps | The browser validator refuses above **5 MB** (`src/lib/files.ts`); the asset service accepts **12 MB** (`ASSET_MAX_UPLOAD_BYTES`). The frontend therefore rejects files the backend would take. Pick one number and make the other follow it — and the same number belongs on the `tryon-assets` bucket policy. |
| Run a `baseline`-provider job on a real photograph | The live browser run used the `mock` set only. The baseline remover's honest failure modes (busy background, reflective surface, fine chain against a similar colour) are reasoned and unit-tested but never observed by eye. |

---

## P3 — AR coverage beyond earrings

Only start these once P1.4 has produced a real-face result for earrings. Each needs its own solver
**and** its own test procedure before it may be called working.

- [ ] Finger / wrist / neck / nose / ankle solvers. `anchors/registry.ts` returns `null` for all of
      them today and the UI says *"not available yet"* — which is the correct behaviour until a solver
      exists. Do **not** widen `TRYON_READY_CATEGORIES` before the solver is written and tested.
- [ ] Hand and pose tracking. `LandmarkTracker` is shaped for them; nothing implements them and there
      are no stubs pretending otherwise.
- [ ] Occlusion. There is no face mesh in the scene, so hair over an ear cannot hide the piece. The
      page says so rather than implying it is handled.

---

## P4 — product and UX follow-ups

Carried from `task.md`. None blocks anything above.

- [ ] Bulk actions on the products table. · [ ] Image cropping / aspect normalisation before upload.
- [ ] Real QR scan attribution, once `analytics_events` writes exist. · [ ] A full dark mode.
- [ ] SSR or prerender for public storefront SEO.
- [ ] Unit tests for `utils/` — still **none**. The try-on core and the two newest service modules
      (`seller/tests/assetApi.test.ts`, 46 tests; `seller/tests/oauth.test.ts`, 14) are well covered;
      the older `utils/` helpers are not.

---

## Explicitly NOT planned

- **Fitment or measurement.** No sizing claim of any kind.
- Payments, checkout, delivery, order management.

## Deferred, not rejected

- **Real background removal.** Feasible now — `onnxruntime` is already installed and `rembg` / U²-Net
  runs on CPU. It means implementing one Protocol in `backend/app/providers/` and registering it in
  `providers/__init__.py`; nothing in the pipeline or the API changes. Not done.
- **Real image → 3D reconstruction.** Deferred on cost, not on principle: it needs a GPU and model
  weights (TripoSR or similar), and neither may be obtained without explicit authorisation. The
  provider interface exists; the only implementation is the flat-card billboard.
  **Until that lands, no output of this repository may be described as a 3D model of a piece.**
- **AWS / SQS / GPU deployment, and the Supabase `processing_jobs` + `assets` tables with RLS.**
  The service currently keeps jobs in memory and has no owner column, so per-seller isolation is
  unenforced and untested.
