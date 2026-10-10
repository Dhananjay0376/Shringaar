# Shringaar — Project Memory

> **Read this file first, in every session.** It is the index. The detail lives in the files linked
> below. The repository-root `CLAUDE.md` instructs every Claude Code session to start here.

**Last updated:** 2026-10-11
**Repository:** `C:\Users\krishna\Desktop\Si` · branch `main` (PR base: `dash`)

---

## Why this directory exists

Project context was being re-explained on every compaction and every new session. These files are
the durable record instead. They hold **verified** facts and say plainly when something is
**unverified** or **proposed**. Nothing here is aspirational dressed as done.

**Precedence:** source code and verified runtime behaviour beat these files. If memory and the code
disagree, the code is right — fix the memory.

---

## The files

| File | Read it when |
| --- | --- |
| [`project-overview.md`](./project-overview.md) | You need the product, users, business model, or scope boundaries |
| [`architecture.md`](./architecture.md) | You are touching module layout, the service boundary, or routing |
| [`decisions.md`](./decisions.md) | You are about to change something load-bearing and want to know why it is that way |
| [`current-state.md`](./current-state.md) | **Always, before choosing what to work on.** What works, what does not, what is unverified |
| [`tasks.md`](./tasks.md) | You need the next step, a blocker, or acceptance criteria |
| [`ar-engine.md`](./ar-engine.md) | You are changing try-on: camera, MediaPipe, anchors, calibration, renderers |
| [`asset-pipeline.md`](./asset-pipeline.md) | You are changing uploads, try-on assets, GLB validation, or anything about 3D |
| [`database-and-auth.md`](./database-and-auth.md) | You are changing Supabase schema, RLS, storage, or sign-in |
| [`testing-and-deployment.md`](./testing-and-deployment.md) | You are running tests, building, or deploying |
| [`session-log.md`](./session-log.md) | You are resuming after a break and need the handoff point |

---

## The three long-form documents (existing, authoritative)

These predate the memory directory and are **not duplicated here**. They remain the deep record:

- **`arch.md`** — architecture decisions. §5 the service boundary · §7 backend integration · §8
  integration boundaries · §9 constraints that must not be violated without updating the doc.
- **`design.md`** — the visual and interaction contract (D1–D22), plus §7 content and honesty rules.
- **`task.md`** — the live build tracker, stages 1–13, two verification passes, and the carried-forward
  open items.

Memory points at these. Do not copy them; when they change, memory changes only if the *status* changed.

---

## Non-negotiable honesty rules

These come from the user and from `arch.md`. They override convenience.

1. **A photo is not a 3D model.** Uploading a PNG/JPEG does not create one. The backend service can
   produce a transparent 2D cut-out and, optionally, a **flat-card** `.glb` that is explicitly not a
   reconstruction — no real image-to-3D model is wired up (see
   [`asset-pipeline.md`](./asset-pipeline.md)).
2. **Never claim a test, build, device run, or visual result passed unless it was actually run.**
3. **Landmarks 234 and 454 are facial side reference points, not earlobes.** The 478-point topology
   has no earlobe landmark at all.
4. **Do not switch to 3D because a URL looks like a model.** Validate the asset first.
5. **Only earrings have a try-on solver.** Do not describe other categories as working.
6. **No secrets in `src/` and none in these files.** Only `VITE_`-prefixed public config.
7. **Never use the service-role key in browser code.** It must never appear in a `VITE_` variable.
8. **Keep ordinary product images separate from AR try-on assets.**
9. **Only public product data on public pages** — no seller-private fields.

---

## Quick orientation

```
src/
  lib/          shared, dependency-free-ish helpers (config, catalog, seller contract, supabaseClient)
  components/   ui/ primitives + storefront/ canvas
  features/
    marketing/  public landing page
    onboarding/ sign-in, create store, guided product batching
    seller/     the dashboard (owner of the SellerService contract)
    storefront/ public store + product pages (read-only consumer)
    try-on/     the AR engine (customer route + /tryon/lab diagnostics)
  routes/       paths.ts (every URL) + router.tsx
  styles/       tokens.css, base.css, app.css, dashboard.css, marketing.css, tryon.css
supabase/migrations/  8 SQL migrations — schema, RLS, buckets, hardening
backend/      asset-processing service (FastAPI, mock-backed) — see its own README.md
```

`backend/` is one folder at the repository root, Python, no AWS and no GPU. The dashboard reaches it
only when `VITE_ASSET_API_URL` is set. It has **no authentication** and is meant for loopback only.

Full detail: [`architecture.md`](./architecture.md) and `arch.md` §3.

---

## Maintaining this memory

Update the **relevant** file — not all of them — when: a feature completes, architecture or schema
changes, a significant decision is made, a hard bug is fixed, tests or a build are run, a limitation
is discovered, a blocker appears, or the plan changes.

When you finish a substantial task, **write the exact next step** into
[`session-log.md`](./session-log.md) before stopping.

Do not store: secrets, tokens, credentials, private face images, large source dumps, or repeated
narrative summaries. Update in place; delete what has become misleading.
