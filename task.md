# Shringaar — Task Tracker

> Live build tracker for the seller dashboard. Update the checkbox **and** the status line as work
> lands. `arch.md` holds the architecture; `design.md` holds the visual contract.
>
> **Last updated:** 2026-10-10 · **Build:** seller dashboard v0.1.0 (demo data mode)
>
> Stages 1–8 below are done. The **verification pass** section at the end lists what the first
> end-to-end walkthrough found and fixed — read that before treating any stage as fully closed.

---

## Stage status

| # | Stage | Status | Notes |
| --- | --- | --- | --- |
| 1 | Inspect repository, report stack | ✅ Done | Empty project; React + Vite + TS initialized from scratch |
| 2 | Seller folder structure + shared types | ✅ Done | `src/features/seller/**`, `types/seller.ts` |
| 3 | Dashboard shell, sidebar, header, responsive layout | ✅ Done | Fixed sidebar ≥1024px, slide-over drawer below |
| 4 | Overview + Products pages | ✅ Done | Stats, recent products, activity, search/filter, grid + table |
| 5 | Add-product form + store configuration | ✅ Done | Validation, image + try-on asset, live storefront preview |
| 6 | Analytics + Settings pages | ✅ Done | Hand-rolled SVG chart; settings with honest "not connected" rows |
| 7 | Service abstraction + demo data isolation | ✅ Done | `SellerService` interface, mock adapter, `dataSource` on every read |
| 8 | Build, typecheck, fix errors | ✅ Done | `npm run typecheck` and `npm run build` both clean |

---

## Stage 1 — Inspection ✅

- [x] List project contents — only `.claude/` and an empty `.git` (no commits)
- [x] Confirm toolchain — Node v24.21.0, npm 11.19.0
- [x] Detect existing framework — none
- [x] Detect existing routes / conventions — none
- [x] Detect Supabase configuration — **not configured** (no `.env`, no client, no schema)
- [x] Detect auth — none
- [x] Initialize React + Vite + TypeScript

## Stage 2 — Structure and types ✅

- [x] `features/seller/{components,pages,hooks,services,types,utils,context,layout}`
- [x] `components/ui/` shared primitives
- [x] `lib/` config, formatting, clipboard, QR, file reading, ids
- [x] `routes/` path constants + router
- [x] `features/storefront/` public pages, isolated from seller
- [x] `types/seller.ts` — Seller, Store, Product, TryOnAsset, AnalyticsSummary, ProductInput
- [x] `types/` reused unchanged by the storefront (single data contract)

## Stage 3 — Shell and layout ✅

- [x] `SellerSidebar` — wordmark, store block, 6 nav items, profile footer
- [x] `SellerHeader` — mobile menu, page context, demo chip, profile menu
- [x] `SellerLayout` — sidebar + header + `<Outlet/>`, single mount for all seller routes
- [x] Responsive: fixed sidebar ≥1024px, slide-over drawer below, Escape/backdrop/nav close
- [x] Session guard (`RequireSeller`) that offers the demo session instead of faking login
- [x] Toast provider mounted once at app root

## Stage 4 — Overview and Products ✅

**Overview**
- [x] Total products, total product views, try-on sessions, outbound clicks
- [x] Recent products (latest 4) and recent activity feed
- [x] Prominent `Add Product` + `View My Store` buttons
- [x] `Copy Store Link` and QR-code entry point
- [x] Every metric labelled "Demo data" while the mock adapter is active

**Products**
- [x] Debounced search over name/description/category
- [x] Category and status filters + result count + clear-filters
- [x] Grid view and table view, toggle persisted per session
- [x] Per product: image, name, price, category, status
- [x] Actions: edit, delete (confirm dialog naming the product), copy link, QR
- [x] Loading (skeletons), error (retry), empty (first-run vs no-match) states

## Stage 5 — Add product and Store ✅

**Add / Edit product** (one shared `ProductForm`, two routes)
- [x] Name, description, price + currency, category, status
- [x] Product image upload with preview and replace/remove
- [x] Try-on asset upload, separate field, separate kind (image / glb / usdz), anchor hint
- [x] Explicit copy that a photo is not converted into a 3D model
- [x] Optional existing website product URL
- [x] WhatsApp number with per-product override of the store default
- [x] Draft / Published — publishing requires a product image
- [x] Required-field and format validation with field-level messages
- [x] Edit reuses the form and pre-fills from the product

**My Store**
- [x] Store name, logo, description, contact email/phone, WhatsApp, slug
- [x] Slug validation (lowercase, hyphens, uniqueness against the live store list)
- [x] Live storefront preview driven by the same data as the public route
- [x] Copy public store URL + QR

## Stage 6 — Analytics and Settings ✅

- [x] Store visits, product views, try-on starts, outbound clicks, contact clicks
- [x] Range selector (7 / 30 / 90 days apportioned from the demo series)
- [x] Trend chart + top-products breakdown
- [x] Explicit demo-data banner — no fabricated "real" metrics
- [x] Empty state for a store with no traffic yet

**Settings**
- [x] Store profile section, contact preferences section, account section
- [x] Logout wired to the session provider (clears session, routes to sign-in)
- [x] Unfinished integrations visibly marked "Not connected" with the reason

## Stage 7 — Data layer ✅

- [x] `SellerService` interface — all methods async, all reads carry `dataSource`
- [x] `mockSellerService` — browser-local, seeded, explicitly named as demo
- [x] `createSellerService()` selects the adapter from `lib/config.ts`
- [x] Persistence caveat surfaced in the UI ("saved in this browser only")
- [x] No secret keys in the bundle; only `VITE_`-prefixed public config
- [x] Supabase schema + RLS policies documented in `arch.md` §7
- [x] `NotImplementedInDemoError` thrown for operations a browser cannot honestly fake

## Stage 8 — Verification ✅

- [x] `npm install` — 103 packages, exit 0
- [x] `npm run typecheck` — no errors
- [x] `npm run build` — production build succeeds
- [x] `npm run dev` — app serves and renders

---

## Verification pass — what the first full walkthrough found

Stages were marked done as they were written. This is the pass that went looking for the gap between
"written" and "works", and found it. **Every item below was a real defect, not a polish note.**

### Responsive (design.md D17, §5.4)

- [x] **The whole dashboard scrolled sideways at 390px.** `document.documentElement.scrollWidth` was
      **715px** on a 390px viewport. `.grid-2` used bare `fr` tracks, and a grid child is
      `min-width: auto`, so the 697px recent-products table stretched its card instead of scrolling
      inside `.table-wrap`. Fixed with `minmax(0, 1fr)` tracks + `min-width: 0` on grid children.
- [x] **A second leak hid behind the first.** After the grid fix the page still scrolled 227px. The
      `.sr-only` "Actions" label inside the table header is `position: absolute`; with no positioned
      ancestor inside the scroller it resolved against the page and escaped `.table-wrap`'s clip.
      Fixed with `position: relative` on `.table-wrap` — confirmed as the sole cause by hiding that
      one element's containing block and watching the width drop from 617px to 375px.
- [x] **My Store overflowed by 12px.** The save-status line sat outside the card because
      `.card__footer` could not wrap. Fixed with `flex-wrap: wrap`.
- [x] **`.spacer` was inert in 3 of its 4 uses.** Only `.product-card__actions .spacer` had a rule,
      so the footers on My Store, Add Product and Analytics silently did nothing. Promoted to a real
      global utility; it now right-aligns the trailing item as the markup always intended.
- [x] Re-verified: **30 route × viewport combinations** (10 routes at 390 / 768 / 1440) — no
      horizontal scroll anywhere, 0 console errors.

### Correctness and honesty

- [x] **The seed activity feed made false claims.** `const [choker, pendant, anklet, ring] = SEED_PRODUCTS`
      mislabelled every variable against the real array order, so the feed announced a *draft* for a
      *published* product. Rewritten to look up products by id and derive names and timestamps from
      their own records. `SCHEMA_VERSION` bumped 1 → 2 so a stale payload is discarded, not half-read.
- [x] **Seeded try-on assets were dressed up as real.** `tryOn()` returned `fileName: 'demo-asset.glb'`
      and an `uploadedAt` while `url` was `null` — an empty record presented as something a customer
      could actually try on. File metadata nulled to match the absence of the file.
- [x] **The My Store preview ignored the form.** It rendered `storefront.data.store` (fetched by the
      *preview* slug) instead of the edited values, so typing a new store name changed nothing on
      screen. Now reads products by the *saved* slug and renders the in-progress store.
- [x] **Customer pages carried the seller's tab title.** A shared storefront link opened a tab
      reading "Seller Dashboard". Per-screen titles via `lib/useDocumentTitle.ts` (design.md D18).
- [x] **"1 product match your filters"** — plural verb for a singular count. Fixed and re-verified in
      the browser: `1 product matches` / `0 products match` / `6 products match`.
- [x] **favicon 404** on every load — replaced with an inline SVG data URI.

### Documentation

- [x] `arch.md` §9 rule 1 now states the real dependency shape (storefront → seller, never the
      reverse) instead of a rule the code did not follow.
- [x] `design.md` D17/D18 and §5.4 record the containment rules and the tab-title rule.

### Known and accepted, not defects

- The React Router `v7_startTransition` future-flag warning is left in place. Silencing it means
  opting into a behaviour change, which is not a fix.
- The storefront's "usable try-on asset, no AR client" branch is unreachable in demo mode, because
  the seeds deliberately carry no stored asset (see above). It becomes reachable the moment storage
  is connected. It is left in place rather than deleted, since it is the branch a real seller hits.

---

## Open items — carried forward, not done

These are explicitly **not** implemented. They are listed so nothing looks finished when it is not.

### Blocked on a backend
- [ ] Create the Supabase project and apply the schema + RLS in `arch.md` §7
- [ ] Implement `createSupabaseSellerService()` against the same interface
- [ ] Real auth: sign-in, session refresh, sign-out, password reset
- [ ] Storage buckets `product-images` / `tryon-assets` with MIME + size validation
- [ ] Server-side analytics ingestion (`analytics_events` writes from the public pages)
- [ ] Aggregate analytics queries (the dashboard must not write its own metrics)
- [ ] `updated_at` triggers; slug uniqueness enforcement at the database level

### Blocked on the AR pipeline
- [ ] AR try-on client at `VITE_TRYON_BASE_URL/{productId}` reading asset + anchor
- [ ] Try-on asset validation (`.glb` / `.usdz` structural check, not just extension)
- [ ] 2D placement tuning per anchor (finger / wrist / neck / ear / ankle)
- [ ] Try-on session lifecycle events (`tryon_start` → `tryon_complete`)

### Product/UX follow-ups
- [ ] Bulk actions on the products table (multi-select, bulk publish/unpublish)
- [ ] Image cropping / aspect normalisation before upload
- [ ] Real QR scan attribution once `analytics_events` exists
- [ ] Dark theme (deliberately out of scope for v1 — see `design.md` §9)
- [ ] Server-side rendering or prerender for public storefront SEO
- [ ] Test suite: unit tests for `utils/` and `services/`, component tests for the form
