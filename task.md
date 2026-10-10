# Shringaar — Task Tracker

> Live build tracker for the seller dashboard. Update the checkbox **and** the status line as work
> lands. `arch.md` holds the architecture; `design.md` holds the visual contract.
>
> **Last updated:** 2026-10-10 · **Build:** seller dashboard v0.3.0 (demo data mode, reference theme,
> in-repo AR try-on for earrings)
>
> Stages 1–12 below are done. Two **verification passes** at the end list what the end-to-end
> walkthroughs found and fixed — read those before treating any stage as fully closed.

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
| 9 | Reference theme extracted and applied | ✅ Done | Palette + type + radii read off the supplied landing page; `tokens.css` rewritten |
| 10 | Marketing landing page | ✅ Done | Frame/panel shell, hero, feature band with drawn app mockups, footer watermark |
| 11 | Onboarding flow (sign-in → store → first products) | ✅ Done | Four public screens, each its own URL; guided category batching |
| 12 | Home + Collection dashboard | ✅ Done | Home replaces Overview; Collection groups the catalogue by category |
| 13 | AR try-on engine (in-repo) | ✅ Done, earrings only | `features/try-on`; `/tryon/:productId` + `/tryon/lab`. See the section below for what is verified and what is not |

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

## Stage 9 — Reference theme ✅

The client supplied a landing page and asked for its **design theme and fonts**, not its content.
The theme was read off the rendered page rather than eyeballed, and `tokens.css` was rewritten around
it. Provenance is recorded at the top of that file.

- [x] Palette: frame `#2F4436`, paper `#E5E4DA`, ink `#141A16`, cream `#ECEBE1`, night `#121D17`,
      brand `#2F5640`, muted `#7F857B`
- [x] `--gold-*` ramp replaced by `--brand-*` of the same shape — the *names* are the contract, so the
      brand can change back without touching a component
- [x] One typeface, **Inter Tight**, at every size; display set at **weight 400** with `-0.045em`
      tracking (the reference's signature move, and the easiest thing to lose)
- [x] Radii shrunk to the reference's scale: 3px controls, 6px cards, 12px dialogs, 18px feature band
- [x] Alpha-based `--line*` tokens, matching the reference's `color-mix(ink 12%, transparent)`
- [x] `--ease: cubic-bezier(.2,.8,.2,1)`; transitions 140 / 180 / 260ms
- [x] `design.md` rewritten — D1–D8 restated, D19–D22 added for the two-tone headline rule, the
      micro-label pill, the no-`.on-night` rule and the no-stock-photography rule
- [x] Removed the unused `.on-night` token scope rather than documenting a mechanism nothing used —
      and which would have broken the *light* mockups inside the dark feature band

## Stage 10 — Marketing landing page ✅

- [x] `MarketingShell` — the dark green frame inset around the cream panel, the reference's most
      recognisable structural move (`.mk-frame` / `.mk-panel`)
- [x] `LandingNav` — sticky logo pill, links, **Sign in** and **Start selling**; `overflow: clip` not
      `hidden`, so the sticky nav sticks to the viewport rather than to the panel
- [x] Hero — `✳` eyebrow, two-tone display headline (`.mk-mute`), lead, two CTAs, stat row
- [x] Four floating `.mk-chip` metaphor badges with fading connector lines tying them to the grid
- [x] `FeatureShowcase` — dark band, three cards, each with a **drawn app mockup**, not a photo:
      `StorefrontMock`, `PhoneMock`, `TagMock` in `AppMock.tsx`
- [x] `LandingFooter` — dark ground, brand + three link columns, giant watermark wordmark, bottom bar
- [x] Hero CTAs split the two real paths: **Start selling** → `/get-started`, **Sign in** → `/sign-in`

## Stage 11 — Onboarding flow ✅

Four public screens, each its own URL so a refresh, a back button and a shared link all behave.

- [x] **Sign in** (`/sign-in`) — email first; the returning-seller path validates the address before
      showing the details screen
- [x] **Create your store** (`/get-started`, `/onboarding/store`) — name, logo (optional), **city
      (optional)**, WhatsApp number; **Continue**. Optional fields stay optional so a seller can
      start quickly
- [x] **Store ready** (`/onboarding/ready`) — *"Your "[Store name]" store is ready. Let's add your
      first jewellery product."* + **Add Your First Product**
- [x] **Add your jewellery** (`/onboarding/products`) — *Step 1 of 3 · Product details*: name,
      category, description, photo upload **and** click-a-photo, both marked *clear image recommended*;
      price asked **after** the image exists; **Continue clicking pictures** saves and clears the form;
      **Finish up this category** moves to the category tab
- [x] Guided categories are `GUIDED_CATEGORY_KEYS` — **Earrings, Nose rings, Necklaces, Other** — a
      subset of the canonical list, so a guided product is indistinguishable from a full-form one
- [x] Progress persists per category, so a seller can photograph a tray in batches and see what is done
- [x] `createStore` replaces the demo seed rather than leaving twelve strangers' products beside the
      seller's own first piece

## Stage 12 — Home and Collection ✅

**Home** (`/seller/dashboard`) answers one question — what do I do next.

- [x] "My jewellery store" kicker, store name, *"Welcome back! Let's grow your online store."*
- [x] Three real reads: **Products**, **Product QR codes** (one per piece), **Live on your storefront**
- [x] Quick actions — **Add new product** (the only primary) and **Store settings**
- [x] Empty state is the onboarding for a seller who has added nothing
- [x] Footnote states the figures' provenance rather than letting "12 products" imply a live shop

**Collection** (`/seller/collection`) is the review surface.

- [x] Every uploaded piece with image, price and description, **grouped by category**
- [x] Category selector to filter the wall
- [x] Description suppressed when it is the uploader's name fallback rather than something the seller
      wrote — printing the name twice reads as a bug
- [x] `Preview` links open the real public product page in a new tab

**Demo catalogue** expanded to **twelve** pieces so the dashboard's real reads match the brief's
"12 Products / 12 Product QR codes" (12 / 12 / 10 live, 2 deliberately kept as drafts).
`SCHEMA_VERSION` bumped 3 → 4.

---

## Verification pass 1 — what the first full walkthrough found

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

## Verification pass 2 — the reference theme and the new flow

After the theme swap and the four new surfaces landed, the whole app was walked end-to-end again in a
real browser, at three widths. This pass found **five** defects, two of them false claims in the UI.

### The flow, end to end

- [x] Landing → **Start selling** → Create store (name + WhatsApp, city left blank) → **Continue**
- [x] Store ready → **Add Your First Product**
- [x] Product details: name, category, photo upload, price — then **Continue clicking pictures**
      (saved the piece and cleared the form) → **Finish up this category**
- [x] Category tab showed 4 chips with 1 marked done; picked the next, added two more
- [x] Done summary: 3 pieces. Dashboard: 3 stats, 2 quick actions. Collection: 3 cards, 2 groups
- [x] Returning-seller path: empty submit and a malformed address both produced field-level errors;
      the details screen showed real facts; `Preview` links resolved to the right public product

### Defects found and fixed

- [x] **The feature cards were empty dark frames.** The reference's cards contain light product-UI
      mockups; ours were blank `--night` boxes, which read as broken images. Replaced with three
      miniatures (`AppMock.tsx`) drawn from the app's own tokens and generated placeholder art.
- [x] **The footer was cream text on a cream panel.** `.mk-foot` styled its text for a dark ground but
      had no dark ground of its own, so the links were nearly invisible. Given an explicit `--night`
      background at `--r-section` radius, matching the reference's structure.
- [x] **The hero chips read as stray artefacts.** 38×30 with a faint border. Enlarged to 46×34,
      strengthened border/ink, added a shadow and fading connector lines back to the grid, and added
      a fourth chip to balance the composition.
- [x] **`DemoModeBanner` told new sellers their own products were "sample data."** It is shared by
      Overview (seeded catalogue) and Home (the seller's own uploads) and assumed the former. Given a
      `seeded` prop, and both branches rewritten to be true regardless of which screen it is on.
- [x] **`SellerHome`'s footnote claimed ownership it cannot know.** "Your figures" is false on the
      sign-in path. Rewritten to state where the numbers come from, not whose they are.
- [x] **Collection printed the description twice** on every guided product, because the uploader falls
      back to the piece name when no description is typed. The fallback is now suppressed on the card.

### Verified, not assumed

- [x] **16 routes × 3 widths (390 / 768 / 1440) = 48 combinations** — `documentElement.scrollWidth`
      never exceeds the viewport, and the console is clean apart from the known `v7_startTransition`
      warning.
- [x] `npx tsc --noEmit` — clean. `npm run build` — 183 modules, `index.html` 1.49 kB, CSS 72.14 kB,
      JS 409.96 kB.
- [x] The seeded collection renders **12 distinct pieces across 8 categories**; the dashboard reads
      **12 products / 12 QR codes / 10 live** (2 kept as drafts).
- [x] **Checked-and-cleared false alarm:** "half the collection tiles render blank" was `loading="lazy"`
      images that had not loaded when a full-page screenshot was taken, not a rendering bug. A
      scroll-then-measure run confirmed 12 cards, **0 failed to load**. An earlier comment attributing
      it to pale placeholder palettes was rewritten, since the cause had not been verified.
- [x] **Checked-and-cleared false alarm:** a 404 on `/s/meena-jewels/p/pearl-drop-jhumka` was my test
      guessing a slug URL. Public product routes are keyed by **product id** (`/p/prd_demo_008`), and
      both the Collection and the storefront link by id consistently.

### Documentation

- [x] `design.md` rewritten for the reference theme: D1–D8 restated, D19–D22 added, §3 colour and §4
      typography replaced, §5.1/§5.2 shell diagrams corrected (Home/Collection + Manage), §9 no longer
      claims there is no dark theme.
- [x] `arch.md` updated: the four route groups, the `marketing`/`onboarding` features, the folder
      tree, `city` on `Store` and in the `stores` DDL, `nose` in the anchor list, the category subset
      rule, `SCHEMA_VERSION = 4`, and `createStore`'s seed-replacement behaviour.
- [x] `task.md` (this file) brought up to date.

---

## Stage 13 — AR try-on engine (in-repo) ✅ earrings only

`src/features/try-on/`. The route the product page always linked to is now served in-repo.

- [x] **The contract move** — `features/seller/types/seller.ts` → `lib/seller.ts`, `export *` shim left
      behind. This is the moment `arch.md` §9 rule 1 anticipated: the try-on module is the third
      consumer. 37 existing import sites unchanged.
- [x] Camera + MediaPipe Face Landmarker (VIDEO mode) in a rAF loop, with a tracking state machine
      (`acquiring → tracking → holding → lost`) so one dropped detection does not tear the piece off.
- [x] **Earring solver** — a face-local frame scaled by interocular distance, an anchor derived from
      face-oval points *near* the ear averaged per side, an outward offset, yaw-driven squash and a
      confidence falloff. The topology has **no earlobe landmark**; the UI says so.
- [x] Calibration sliders (size / outward / drop / tilt), persisted per browser, loadable in a lazy
      initialiser so the first painted frame is already calibrated.
- [x] `canvas2d` renderer — the working path for an image asset.
- [x] `three` renderer behind `await import()`, reached only through `chooseRenderer`'s measured
      validation, never from a URL's extension.
- [x] `/tryon/lab` diagnostics: landmark dots with optional indices, fps, detection time, frames
      skipped, the face-frame readout, and a picker for a local image or `.glb`.
- [x] `/tryon/:productId` customer route resolving the product by id, copy written to say what it can
      and cannot do.
- [x] `SellerSettings` AR row corrected — the no-host branch used to claim try-on was unavailable,
      which stopped being true the moment this shipped.
- [x] **215 tests across 14 files**, `tsc --noEmit` clean, `npm run build` clean.

### Verified live, in a browser (demo-mode dev server)

- [x] Landmark overlay **off by default on the customer page**: instrumenting
      `CanvasRenderingContext2D.prototype` over 3 s of tracking gave `arc: 0`, `fillText: 0`,
      `stroke: 0`. The lab over the same period gave `arc: 54`, `stroke: 36`, `fill: 36`;
      `fillText: 36` with indices on — 12 labelled points per frame, matching the unit test's own
      expectation. This is the bug that shipped a `showLabels` gate where a `showDiagnostics` gate was
      meant; the gate now lives in `drawOverlay`, where it is tested.
- [x] Camera lifecycle: stop and navigate-away both release the stream; one overlay under
      `<StrictMode>`, not two.
- [x] Nothing is uploaded — no request to Supabase during a session.
- [x] **A validated `.glb` loads and renders.** A hand-built 600-byte triangle GLB was picked through
      the lab: `Kind: 3D model`, `State: ready`, one `webgl2` context and **no** `2d` context on the
      stage canvas. Driving the real `three.ts` with real targets and reading the framebuffer back
      gave **7600 lit px** at `fbX [150,249] / fbY [0,149]` for one ear, **15200** (exactly 2×) for
      two, and **0** for an empty frame — matching `modelTransformFor`'s predicted box pixel for pixel.
- [x] **Bug found by that measurement and fixed:** the two slot groups were cloned and stored but
      never added to the scene. `clearModel` had a `scene.remove` with no matching `scene.add`, so the
      scene held only lights — a validated model produced zero draw calls, zero lit pixels and **no
      error at all**, which is indistinguishable from a model that failed to load. `scene.add` now
      lives inside `duplicate`, where a slot is created.
- [x] Bundle: `three` lands in its own 791.23 kB (205.16 kB gzip) lazy chunk and `vision_bundle` in a
      145.13 kB (44.01 kB gzip) one. The entry chunk has **no static import** of either and
      `index.html` preloads neither. Entry is 668.43 kB / 193.38 kB gzip — **+2.4 kB / +1.4 kB** on the
      pre-try-on 666 / 192, not unchanged, and that is the honest figure.
- [x] **The full flow, driven end to end**, with a **synthetic face** in place of a webcam
      (`getUserMedia` replaced by `canvas.captureStream()`, the face drawn on that canvas and swaying).
      Product page → *Launch virtual try-on* → *Start camera* → `Tracking` → both earrings drawn →
      sliders → *Stop camera*, with screenshots. MediaPipe genuinely locked on: **478 landmarks**,
      confidence **0.70**, interocular **143.5 px**, roll **1.9°**, yaw **−0.1°** — the tracker, the
      solver and the renderer all ran for real. This is a cartoon head, not a person; see below.
- [x] **Calibration moves the piece, symmetrically.** With `outward: 0.8` the solver moved the left
      anchor −119.6 px and the right +119.5 px — symmetric to **0.1 px** — and `drop: 0.8` moved both
      down ~118 px. A first pass *looked* asymmetric (172 px vs 132 px) because the two canvas
      measurements were taken at different phases of the head's sway; the deterministic solver reading
      settled it, and the lesson is that a pixel measurement on a moving subject has a noise floor that
      a solver reading does not.
- [x] **The hook → 3D seam with a detected face, now closed.** The 824-byte quad GLB was picked
      through the laboratory's own file input while tracking was live: `Kind: 3D model`, `State: ready`,
      and the stage canvas reported `webgl2: true` with **`2d: false`** — the fresh-canvas keyed on
      `asset.kind` does what it was written to do. Instrumenting `WebGL2RenderingContext.prototype`
      counted **84 `drawElements` calls in 3 s** (28/s ÷ 2 slots ≈ 14 fps) against a reported
      **13.6 fps** at 65.3 ms detection, and the screenshot shows both quads at the ears. The earlier
      "7600 lit px" figure was this same module driven by hand; this run is the real app path.
- [x] **Frames per second reports a true number.** It read `—` then `1.1` for the first minutes because
      the Playwright window was occluded and Chrome throttled `requestAnimationFrame` to a measured
      **1.5 Hz** while `document.visibilityState` still said `visible`. Once the window was actually
      composited the counter read **13.6**, which is `1000 / (65.3 ms + frame overhead)` — correct for
      the measured detection cost. The counter was never wrong; the environment was throttled. Worth
      recording because "fps is broken" is the obvious wrong conclusion from that reading.
- [x] **MediaPipe sends its own telemetry.** Observed `POST https://odml.pa.googleapis.com/v1/log`
      (200) with a `content-type: application/x-protobuf` body of a few dozen bytes whose only readable
      content is the library version `1.1.0` and numeric counters. **No image data** — a single
      640×480 frame is orders of magnitude larger than the whole payload. It is rate-limited and did
      **not** recur in a clean reload → start → track run, so it is not per-frame. The customer copy
      ("No photo or video leaves your device") is literally true, but "everything runs in your browser"
      is the sentence a reader would take to mean *no network calls at all*, and this is one. Flagged,
      not silently accepted.

### Not verified — do not read the above as more than it is

- [ ] **A real human face.** The run above used a **synthetic cartoon head**, and that distinction
      matters: BlazeFace detected it and returned a full 478-point mesh, so the *pipeline* is proven
      end to end — but a drawn face has none of the variation a person has. Placement accuracy on real
      skin, real hair, real glasses and real lighting is **unmeasured**, and it remains the result most
      likely to disappoint. On the synthetic head the solver put the anchor ≈35 px outboard of the ears
      *as drawn*; that is a property of a cartoon whose ears sit inboard of the face-oval contour
      landmarks 234/454 trace, and it says nothing either way about a person.
- [ ] **The `holding` replay path** — implemented and reasoned, never triggered on camera.
- [ ] No real-device, no iOS Safari, no phone-front-camera test. No cross-browser claim.
- [ ] No 3D-quality claim beyond "a validated GLB loads and renders". The lighting is untuned and no
      animation is played.

---

## Open items — carried forward, not done

These are explicitly **not** implemented. They are listed so nothing looks finished when it is not.

### Known gap in what shipped
- [ ] **`city` is not rendered on the public storefront.** It is captured at sign-up, stored, and shown
      on the dashboard header, but no customer-facing surface shows it. The `CreateStore` hint was
      changed to "Where your shop trades from" so it stops promising a storefront placement that does
      not exist. Either render it on the storefront or drop the field.

### Blocked on a backend
- [ ] Create the Supabase project and apply the schema + RLS in `arch.md` §7
- [ ] Implement `createSupabaseSellerService()` against the same interface
- [ ] Real auth: sign-in, session refresh, sign-out, password reset
- [ ] Storage buckets `product-images` / `tryon-assets` with MIME + size validation
- [ ] Server-side analytics ingestion (`analytics_events` writes from the public pages)
- [ ] Aggregate analytics queries (the dashboard must not write its own metrics)
- [ ] `updated_at` triggers; slug uniqueness enforcement at the database level

### AR pipeline — what is left after Stage 13

- [x] ~~AR try-on client reading asset + anchor~~ — shipped in-repo at `/tryon/:productId`. The
      `VITE_TRYON_BASE_URL` seam is untouched and still wins when set.
- [x] ~~Try-on asset validation (`.glb` structural check, not just extension)~~ — `inspectGlbBytes` is
      pure over bytes and pins a distinct reason per failure; `usdz` is refused with its own reason.
- [ ] **2D placement tuning per anchor** — only `ear` has a solver. Finger / wrist / neck / nose /
      ankle return `null` from the registry and render as "not available yet", deliberately: an empty
      stage would look like a bug rather than a missing feature.
- [ ] **Hand and pose tracking** — `LandmarkTracker` is shaped for them; nothing implements them and
      there are no stubs pretending otherwise.
- [ ] Try-on session lifecycle events (`tryon_start` → `tryon_complete`) — the event types exist in
      `analytics_events`, but no anon INSERT policy does, so nothing is written. A schema change, not
      a client change.
- [ ] **A real-face placement pass.** The anchor offsets (`k_out ≈ 0.35`, `k_down ≈ 0.30`) are
      reasoned and unit-tested for *form*, but never checked against a human ear on camera.
- [ ] Occlusion. There is no face mesh in the scene, so hair over an ear cannot hide the piece — the
      page says so rather than implying it is handled.

### Product/UX follow-ups
- [ ] Bulk actions on the products table (multi-select, bulk publish/unpublish)
- [ ] Image cropping / aspect normalisation before upload
- [ ] Real QR scan attribution once `analytics_events` exists
- [ ] A full dark mode. The theme has dark *bands* (feature band, footer) but no dark variant of the
      app surfaces — the cream paper is the identity, and a dark mode is a second theme, not a toggle
- [ ] Server-side rendering or prerender for public storefront SEO
- [x] ~~Test suite: unit tests for `utils/` and `services/`~~ — 215 tests across 14 files. The try-on
      core (coordinates, framing, smoothing, tracking state, calibration, the earring solver, GLB
      validation, renderer selection, the model transform, the landing overlay) is pure and DOM-free
      and is covered. `utils/` and `services/` still have **no** tests of their own; that part stands.
