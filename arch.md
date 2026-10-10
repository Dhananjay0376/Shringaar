# Shringaar — Architecture

> **Status of this document:** living record of the architecture decisions that govern the
> seller module. When a decision changes, change it here in the same commit.
>
> Related: [`design.md`](./design.md) (visual + interaction decisions) · [`task.md`](./task.md) (build tracker)

---

## 1. Key points (the short version)

1. **One SPA, one seller dashboard, many sellers.** Sellers are separated by *data*, not by app
   instance or route prefix. Every product row carries `seller_id`; the backend enforces ownership.
2. **Feature-modular, not layer-modular.** Seller functionality lives entirely in
   `src/features/seller/`. The customer storefront lives in `src/features/storefront/`. The public
   marketing surface and the guided first run live in `src/features/marketing/` and
   `src/features/onboarding/`. Shared primitives live in `src/components/ui/`. Nothing in `seller/`
   imports from `storefront/`.
3. **The dashboard never talks to a database directly.** UI → hooks → `sellerService` (typed
   interface) → adapter. Two adapters exist by design: `mock` (default here) and `supabase` (the
   integration point). Swapping adapters must not require touching a single page component.
4. **Demo data is labelled, never disguised.** Every response carries
   `dataSource: 'demo' | 'live'`. Anything derived from demo data renders a "Demo data" badge. Mock
   writes are described as *"saved in this browser only"* — never as database writes.
5. **The try-on asset is a separate, first-class field.** An ordinary product photo is **not**
   converted into a 3D model and the UI must never imply otherwise. `tryOnAsset` carries its own
   kind (`image` | `glb` | `usdz` | `none`), placement anchor and upload state.
6. **Public identity is a stable ID + a human slug.** A product's public URL identifies exactly one
   product; a store's public URL identifies exactly one store.
7. **Out of scope, deliberately:** payments, checkout, delivery, marketplace purchasing, order
   management. The seller module is a catalogue + storefront + analytics surface.

---

## 2. Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Runtime | Node 24, npm 11 | present on the machine |
| Build | Vite 5 | fast dev server, plain ESM, no framework lock-in |
| UI | React 18 + TypeScript (strict) | typed props end-to-end |
| Routing | `react-router-dom` v6 | one router; seller and public routes share it |
| Styling | hand-written CSS with design tokens | no Tailwind/UI-kit dependency; brand control; see `design.md` |
| QR | `qrcode` | generates both a data-URL PNG (download) and inline SVG (display) |
| Face tracking | `@mediapipe/tasks-vision` | Face Landmarker in VIDEO mode; WASM and the `.task` model come from a CDN, so nothing is vendored |
| 3D | `three` | GLB parsing and WebGL drawing. Reached only through `await import()`, so it never loads for a 2D asset — see §8 |
| Data | service abstraction + browser-local mock | no Supabase project exists yet |
| Tests | Vitest | `environment: 'node'`, because the try-on core is deliberately DOM-free |

**Deliberately not used:** a component kit (MUI/shadcn/etc.), state manager (Redux/Zustand),
data-fetching library (React Query/SWR), form library (react-hook-form/Zod). Each would be a
reasonable later addition, but the module is small enough that they would add more surface than
they remove. The service interface is where a fetch cache or a schema validator would slot in.

---

## 3. Folder structure

```text
src/
├── components/
│   └── ui/                     # brand-agnostic primitives, typed props
│       ├── Badge.tsx           # status + dataSource chips
│       ├── Button.tsx          # primary | secondary | ghost | danger | link
│       ├── Card.tsx            # Card / CardHeader / CardBody / CardFooter
│       ├── Field.tsx           # Field wrapper + Input + Textarea + Select
│       ├── Icon.tsx            # dependency-free inline SVG set
│       ├── Modal.tsx           # dialog with focus trap + Escape
│       ├── Skeleton.tsx        # loading placeholders
│       └── Toast.tsx           # ToastProvider + useToast
├── features/
│   ├── marketing/              # the public surface a seller lands on before they have an account
│   │   ├── components/         # MarketingShell (frame + panel), LandingNav, LandingFooter,
│   │   │                       # FeatureShowcase, AppMock
│   │   └── pages/              # Landing — nav → hero → feature band → CTA → footer
│   ├── onboarding/             # the guided first run: one screen per step, each its own URL
│   │   └── pages/              # CreateStore, StoreReady, BatchProducts, SignIn
│   ├── seller/
│   │   ├── components/         # SellerSidebar, SellerHeader, StatCard, ProductCard,
│   │   │                       # ProductTable, ProductForm, EmptyState, QrDialog,
│   │   │                       # DemoBadge, DemoModeBanner, ActivityFeed, AnalyticsChart
│   │   ├── context/            # SellerProvider — session + store for the shell
│   │   ├── hooks/              # useAsync, useProducts, useStore, useAnalytics, useDebounced
│   │   ├── layout/             # SellerLayout — sidebar + header + <Outlet/>
│   │   ├── pages/              # SellerHome, SellerCollection, SellerProducts, AddProduct,
│   │   │                       # EditProduct, SellerStore, SellerAnalytics, SellerSettings
│   │   ├── services/           # sellerService (interface + adapter selection), mockDb, mockSellerService
│   │   ├── types/              # seller.ts — now a one-line re-export of lib/seller.ts
│   │   └── utils/              # slug, validation, product/URL/currency helpers
│   ├── storefront/
│   │   └── pages/              # PublicStore, PublicProduct — customer-facing, read-only
│   └── try-on/                 # the AR engine. See §8.
│       ├── anchors/            # the category solvers — earring.ts is the only one that exists
│       ├── assets/             # image loading, GLB container validation, the generated placeholder
│       ├── components/         # TryOnStage (video + canvas), TryOnControls, LandmarkOverlay
│       ├── core/               # pure: geometry, coordinates, framing, smoothing, calibration
│       ├── hooks/              # useTryOnSession (camera + tracker + loop), useEarringRender
│       ├── pages/              # TryOnProduct (customer), TryOnLab (diagnostics)
│       ├── renderers/          # canvas2d (the working one), three (lazy), select (the gate)
│       ├── tests/              # the pure logic, pinned
│       └── tracking/           # camera, the rAF loop, the MediaPipe Face Landmarker adapter
├── lib/                        # config, catalog, seller.ts (the contract), formatting, clipboard, qr, …
├── routes/                     # paths.ts (route constants) + router.tsx
├── styles/                     # tokens.css → base.css → app.css → marketing.css → dashboard.css
├── App.tsx
└── main.tsx
```

The five stylesheets load **in that order** and only `tokens.css` holds raw values; `base.css`
resets, `app.css` is the app shell and the shared components, and `marketing.css` / `dashboard.css`
are surface-scoped. A page never hardcodes a hex value or a raw px font size.

**Rule of thumb for where code goes:** reusable across features → `src/components/ui` or `src/lib`.
Specific to selling → `src/features/seller`. Specific to shopping → `src/features/storefront`.
Specific to persuading or to the first run → `src/features/marketing` / `src/features/onboarding`.
Specific to trying a piece on → `src/features/try-on`.

`features/try-on` is the third consumer of the seller contract, and it is the reason
`types/seller.ts` moved down into `lib` — see rule 1 of §9. It reads a product through
`getSellerService().resolveProduct(productId)` and imports the contract from `lib/seller`, which is
exactly the read path the storefront is allowed; it never reaches into seller pages or components.

---

## 4. Data contract (`lib/seller.ts`)

The types are the contract between the seller dashboard, the public storefront and the AR engine.
All three read the same `Product`, so changing a field here is a cross-module change.

The canonical file is `src/lib/seller.ts`. `src/features/seller/types/seller.ts` remains as a
one-line `export * from '@/lib/seller'` so the 37 existing import sites keep working; it is a
shim, not a second copy, and new code should import from `lib/seller` directly.

```
Seller  1 ──── * Store          (one seller owns ≥1 store; v1 ships one active store)
Store   1 ──── * Product
Product 0..1 ·· TryOnAsset      (independent of the display image)
Product 1 ──── * AnalyticsEvent (conceptual — events are aggregated server-side)
```

| Entity | Key fields | Notes |
| --- | --- | --- |
| `Seller` | `id`, `email`, `displayName` | `id` is the auth user id — the ownership anchor |
| `Store` | `id`, `sellerId`, `name`, `slug`, `logoUrl`, `description`, `city`, `contactEmail`, `contactPhone`, `whatsappNumber`, `currency` | `slug` is the public URL key, unique per platform. `city` is **nullable** — see below |
| `Product` | `id`, `sellerId`, `storeId`, `name`, `slug`, `description`, `price`, `currency`, `category`, `status`, `image`, `tryOnAsset`, `externalProductUrl`, `whatsappNumber` | `status: 'draft' \| 'published'` |
| `TryOnAsset` | `kind: 'image' \| 'glb' \| 'usdz' \| 'none'`, `url`, `anchor`, `uploadedAt` | `anchor` ∈ unspecified/finger/wrist/neck/ear/**nose**/ankle |
| `AnalyticsSummary` | `range`, `dataSource`, `totals`, `series[]`, `topProducts[]` | `dataSource` drives the demo badge |

**`city` is nullable on purpose.** The onboarding form asks for it, but optionally — a seller who
wants to be online tonight should not be blocked on a field that only decorates a dashboard header.
`null` and `''` are both normalised to `null` at the service boundary, so "not given" has exactly one
representation rather than three. **Known gap:** `city` is captured, stored and shown on the
dashboard, but is not yet rendered anywhere on the public storefront. The `CreateStore` hint says
"Where your shop trades from" rather than promising a storefront placement that does not exist.

**Categories are one vocabulary.** `lib/catalog.ts` holds the canonical ten (`rings`, `necklaces`,
`earrings`, `noserings`, `bracelets`, `bangles`, `pendants`, `anklets`, `sets`, `other`). The guided
first-run uploader offers `GUIDED_CATEGORY_KEYS` — `['earrings', 'noserings', 'necklaces', 'other']` —
which is a **subset** of that list, not a second one. A product added through the guided flow is
indistinguishable from one added through the full product form, and the remaining categories stay
available on that form for the pieces the short list would flatten.

**Money** is stored as a number plus an explicit `currency` code — never a pre-formatted string.
Formatting happens at render time in `features/seller/utils/product.ts`.

**Contact destinations resolve product → store → seller.** A product may override `whatsappNumber`;
when it does not, the store's number applies. This keeps the destination attached to the correct
seller for every product without duplicating it on each row.

---

## 5. The service boundary

```text
page component
   └── feature hook (useProducts / useStore / useAnalytics)
          └── SellerService  ← the only thing pages are allowed to call
                 ├── createMockSellerService()      ← active today
                 └── createSupabaseSellerService()  ← integration point (not implemented)
```

`features/seller/services/sellerService.ts` exports:

- `interface SellerService` — every method returns a `Promise`, so an async adapter is a drop-in.
- `ServiceResult<T> = { data: T; dataSource: DataSource }` — the demo/live signal rides along with
  the data instead of being guessed by the UI.
- `createSellerService()` — reads `lib/config.ts` and returns the Supabase adapter when the project
  is configured, otherwise the mock adapter.

**Why a mock adapter is not a lie.** The mock adapter is explicit about what it is:

- it lives in a file named `mockSellerService.ts`, wrapped in a `MOCK_DEMO_MODE` banner comment;
- every read returns `dataSource: 'demo'`;
- every write resolves with `persistence: 'browser-local'`;
- the UI shows a persistent "Demo data" chip in the header and a banner on first load;
- the service throws `NotImplementedInDemoError` for operations a browser cannot honestly fake
  (real file upload to storage, real auth).

That is the difference between a development fallback and silently presenting mock CRUD as a
database.

**Signing in with Google is a third capability, not a flag on `auth`.** `ServiceCapabilities` carries
`auth` (the backend verifies a credential) and `oauth` (the backend can hand the browser to an
identity provider) separately. Both are true for Supabase, so they could be collapsed — but they are
different claims, and a screen that read `auth` as "show the Google button" would offer a door that
does not open on a project with no provider configured. The button is rendered from `capabilities.oauth`
and from nothing else.

The provider remains a closed union — `type OAuthProvider = 'google'` — with its labels beside it in
`OAUTH_PROVIDER_LABELS`, so a provider cannot exist without a name to show for it.

Three details of the flow are load-bearing and were chosen rather than inherited:

- **`signInWithOAuth` returns `void`, and the page it is called from does not survive it.** Supabase
  mints the authorize URL and sets `window.location` itself, so the promise resolves only on the
  failure path. Returning a `Seller` would describe a state no caller can observe.
- **The browser comes back to `/sign-in`**, built by `oauthRedirectUrl()` from `config.publicSiteUrl`
  so it follows the running origin. Not the dashboard: a seller arriving from Google has an account
  and may have no store at all, and the sign-in screen is the only place that decides which of those
  they are before routing them.
- **A failed return is read out of the URL, not caught.** The redirect replaced the document, so
  there is no stack to catch; `readOAuthError()` reads the query string *and* the fragment, and the
  screen then clears those parameters. It deliberately returns `null` for a URL carrying an
  authorization `code` — deleting that would break the exchange that is still in flight.

**This URL must be listed in the Supabase project's allowed redirect URLs**, alongside every origin
the app is served from. Supabase refuses an unlisted one before the browser returns, which the app
cannot see.

**`createStore` replaces the seed rather than appending to it.** The demo database ships one seeded
store. When a seller completes onboarding, the mock adapter swaps that store and its twelve products
for the one they just created, instead of leaving them beside a catalogue that is not theirs. The
alternative — a new seller deleting twelve products that appeared from nowhere before adding their
own first piece — is a worse first minute than an empty store. A real backend has no such seed to
replace; this is a property of the demo adapter, and `SCHEMA_VERSION` (currently **4**) is what
discards an older payload when the seed changes shape.

---

## 6. Routing

Single router (`src/routes/router.tsx`), route strings centralised in `src/routes/paths.ts`. The
routes fall into **four groups, in the order a seller meets them**.

| Route | Screen | Group | Access |
| --- | --- | --- | --- |
| `/` | Landing page | Marketing | public |
| `/sign-in` | Sign in → seller details | Marketing | public |
| `/get-started` | Create your store | Onboarding | public |
| `/onboarding/store` | Create your store (same screen, flow's own URL) | Onboarding | public |
| `/onboarding/ready` | Store created → "Add your first product" | Onboarding | public |
| `/onboarding/products` | Add your jewellery, in category batches | Onboarding | public |
| `/seller/dashboard` | Home | Dashboard | seller session |
| `/seller/collection` | Collection, grouped by category | Dashboard | seller session |
| `/seller/products` | Products list | Dashboard | seller session |
| `/seller/products/new` | Add Product | Dashboard | seller session |
| `/seller/products/:productId/edit` | Edit Product | Dashboard | seller session |
| `/seller/store` | My Store + live storefront preview | Dashboard | seller session |
| `/seller/analytics` | Analytics | Dashboard | seller session |
| `/seller/settings` | Settings | Dashboard | seller session |
| `/s/:storeSlug` | Public storefront | Storefront | public |
| `/s/:storeSlug/p/:productId` | Public product + try-on entry point | Storefront | public |
| `/p/:productId` | Resolves a bare product link → its storefront URL | Storefront | public |
| `/seller/sign-in` | Redirect → `/sign-in` (the pre-marketing path, kept for links in the wild) | — | public |
| `*` | Not found | — | public |

**Why marketing and onboarding are public, and why the dashboard is not.** `/sign-in` is public
because it is where you go *to get* a session. The three `/onboarding/*` routes are public because
they run **before a store exists** — which is also why they sit outside `SellerLayout`: that layout
renders the sidebar, and a sidebar needs a store to name.

**Why `get-started` and `onboarding/store` are the same screen under two names.** The landing page
links to `/get-started`, which names the intent and stays true if the flow gains steps; the flow's
own URLs are `/onboarding/*`. Both render `CreateStore` rather than redirecting to a shared path, so
the landing link keeps the intent in the URL bar.

**Dashboard routes are nested under one `SellerLayout`** so the sidebar and header mount once. The
layout is also the session guard: it reads `SellerContext` and sends an unauthenticated visitor to
`/sign-in` instead of rendering chrome around an empty page.

**Public routes never render dashboard chrome** and never read seller-only data.

---

## 7. Backend integration — what "real" looks like

Supabase is **not configured** in this repository, so the mock adapter is active. The section below
is the contract the Supabase adapter must satisfy; it is also the checklist to run before shipping.

### 7.1 Client safety

- Frontend reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only. The anon key is a public
  identifier and is safe **only because RLS is enabled**. Never a service-role key in a `VITE_`
  variable — Vite inlines those into the bundle.
- Files that need elevated rights (bulk import, billing, webhooks) belong in a server runtime or an
  edge function, not in this SPA.

### 7.2 Tables (proposed schema)

```sql
create table stores (
  id                uuid primary key default gen_random_uuid(),
  seller_id         uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  slug              citext not null unique,
  description       text,
  city              text,                       -- optional at sign-up; nullable by design
  logo_url          text,
  contact_email     text,
  contact_phone     text,
  whatsapp_number   text,
  currency          text not null default 'INR',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table products (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null references stores(id) on delete cascade,
  seller_id           uuid not null references auth.users(id) on delete cascade,
  name                text not null,
  slug                text not null,
  description         text not null default '',
  price               numeric(12,2) not null check (price >= 0),
  currency            text not null default 'INR',
  category            text not null,
  status              text not null default 'draft' check (status in ('draft','published')),
  image_path          text,
  tryon_asset_path    text,
  tryon_asset_kind    text not null default 'none' check (tryon_asset_kind in ('none','image','glb','usdz')),
  tryon_anchor        text not null default 'unspecified',
  external_product_url text,
  whatsapp_number     text,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (store_id, slug)
);

create index on products (seller_id);
create index on products (store_id, status);
```

### 7.3 Row Level Security — the ownership model

Ownership is enforced by the database, not by the dashboard. The dashboard hiding a button is UX;
RLS is security. Both are required.

```sql
alter table stores   enable row level security;
alter table products enable row level security;

-- Public read of published catalogue (storefront + AR pipeline)
create policy "public reads published products"
  on products for select using (status = 'published');
create policy "public reads active stores"
  on stores for select using (true);

-- Sellers manage only their own rows
create policy "seller reads own stores"
  on stores for select using (auth.uid() = seller_id);
create policy "seller writes own stores"
  on stores for all using (auth.uid() = seller_id) with check (auth.uid() = seller_id);

create policy "seller reads own products"
  on products for select using (auth.uid() = seller_id);
create policy "seller writes own products"
  on products for all
  using (auth.uid() = seller_id and exists (
    select 1 from stores s where s.id = products.store_id and s.seller_id = auth.uid()))
  with check (auth.uid() = seller_id and exists (
    select 1 from stores s where s.id = products.store_id and s.seller_id = auth.uid()));
```

`products.seller_id` is denormalised on purpose: it makes the ownership predicate a single-column
check that an index can serve, and it survives a store transfer. The `store_id` sub-check keeps the
denormalised column honest.

### 7.4 Storage

Two buckets, both validated on upload:

- `product-images` — public read. Accept `image/jpeg|png|webp|avif`, cap ~5 MB, and **re-encode or
  strip EXIF** before storing.
- `tryon-assets` — public read. Accept `image/*` for 2D placement, `model/gltf-binary` (`.glb`) and
  `model/vnd.usdz+zip` (`.usdz`) for 3D. Cap ~25 MB for `.glb`, ~15 MB for `.usdz`.

Path convention: `{seller_id}/{product_id}/{uuid}.{ext}` — the leading `seller_id` makes a storage
policy that mirrors the RLS rule trivial to write and audit.

```sql
create policy "seller writes own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id in ('product-images','tryon-assets')
              and (storage.foldername(name))[1] = auth.uid()::text);
```

### 7.5 Analytics

Event table, append-only, inserted by the storefront and AR client; read *aggregated* by the
dashboard. Do not let the dashboard write analytics rows — a seller must not be able to inflate
their own numbers.

```sql
create table analytics_events (
  id          bigint generated always as identity primary key,
  store_id    uuid not null references stores(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,
  event_type  text not null check (event_type in
                ('store_visit','product_view','tryon_start','tryon_complete',
                 'outbound_click','contact_click','qr_scan')),
  occurred_at timestamptz not null default now(),
  session_id  text,
  referrer    text
);
```

The dashboard's five headline metrics map directly:
`store_visits → store_visit`, `product_views → product_view`, `try_on_sessions → tryon_start`,
`outbound_clicks → outbound_click`, `contact_clicks → contact_click`.

### 7.6 Adapter checklist

Before the Supabase adapter ships, confirm:

- [ ] RLS **enabled** on `stores`, `products`, `analytics_events`, `storage.objects`
- [ ] Every policy has both `using` and `with check` where it writes
- [ ] `listProducts` filters by `auth.uid()` server-side (never trust a client-sent `sellerId`)
- [ ] Uploads validated on MIME type **and** size **and** decoded dimension
- [ ] `updated_at` maintained by trigger, not by the client
- [ ] No service-role key anywhere in the bundle (grep the built `dist/` for it)

---

## 8. Integration boundaries for what is not built yet

**Customer storefront.** `features/storefront/` renders `PublicStore` and `PublicProduct` from
read-only service calls. Its data source is the same `Product` type, so the mapping to a real
backend is the same work as the dashboard's.

**QR system.** `lib/qr.ts` is the only place that knows about the QR library. A QR code always
encodes an absolute public URL, so a printed QR cannot go stale as long as the store slug and
product id are stable. `qr_scan` is already an event type, so scan attribution needs no schema
change. A server-side renderer (for print batches) can reuse the same helpers.

**AR try-on engine.** Built, in-repo, at `features/try-on` — and narrowly. Read this paragraph before
believing anything a screenshot suggests.

*What it does.* `/tryon/:productId` reads the product through `getSellerService().resolveProduct(id)`,
gets the camera from `getUserMedia`, runs MediaPipe's Face Landmarker in VIDEO mode over each frame,
derives an ear position per side from a face-local frame, and draws the seller's asset at that point
on a canvas over the video. Inference is local: **no frame, image or landmark is uploaded anywhere.**
`/tryon/lab` is the same engine with the diagnostics exposed — landmark dots and their indices, fps,
detection time, a calibration panel and a local file picker.

*Two things do leave the device, and they are worth knowing before repeating the customer copy.* Both
belong to the MediaPipe runtime, not to this repository. The WASM binary and the `.task` model are
**downloaded** from `cdn.jsdelivr.net` and `storage.googleapis.com` on first use — centralised as two
constants in `tracking/mediapipe.ts`, so vendoring them is a two-line change. And the runtime posts
small rate-limited telemetry beacons to `odml.pa.googleapis.com` (protobuf, a few dozen bytes: the
library version and counters, no image data). The customer line "no photo or video leaves your device"
is therefore accurate; "everything runs in your browser", read as *no network calls at all*, is not.
A stricter deployment would vendor the two assets and a CSP would bound the rest.

*What it is limited to.* **Earrings, and only earrings.** `anchors/registry.ts` returns a solver for
`earrings` and `null` for every other category, and the page renders that `null` as "not available
yet for this category" rather than as an empty stage. Hand and pose tracking exist as an interface
(`LandmarkTracker`) with no implementations and no stubs pretending otherwise. Nothing here generates
a 3D model from a photograph.

*The two renderers.* `canvas2d` draws a flat image and is the path every earring product uses today.
`three` parses a `.glb` and draws it. The choice is made by `chooseRenderer(asset, validation)`, which
is pure and tested, and which never switches to 3D because a URL merely *looks* like a model: a `.glb`
is fetched and its container inspected first, and a model that fails is reported with its own reason
rather than silently drawn as something else. `usdz` is refused with a stated reason — no viewer here
parses it.

*What it does not do, stated because the gap is invisible on screen.* There is no face mesh in the
scene, so **nothing occludes the piece** — hair over an ear cannot be detected and the earring draws
on top of it. The anchor is derived from face-oval points near the ear, **not from an earlobe**: the
478-point topology has no earlobe landmark at all, so there is a small systematic offset, which is
what the calibration sliders exist to correct per face. Placement degrades with large head yaw. The
lighting rig is untuned. No animation is played. There is no fitment or measurement claim of any kind.

*The external seam is retained.* If `VITE_TRYON_BASE_URL` is set, the product page links out to that
host exactly as before; unset, it links to the in-repo route. Nothing about this engine requires a
host to be configured.

**What a product photo is not.** Uploading a JPEG of a ring does not produce a 3D model, and nothing
in the UI claims it does. An ordinary photo is a *placement image* for 2D overlay — which is
genuinely useful — while generating a true 3D asset is a separate authoring step that produces a
`.glb`/`.usdz`. The form states this plainly next to the field. The try-on module keeps the same
distinction: an image asset and a model asset are separate kinds, carried through as a typed union
rather than guessed from a file extension.

---

## 9. Architectural constraints (do not violate without updating this doc)

1. `features/seller` and `features/storefront` are layered, not symmetric: **the storefront may depend
   on the seller module, never the reverse.**
   - `features/seller` must not import from `features/storefront` — no components, pages, hooks or
     anything else. (Checkable: `grep -rn "features/storefront" src/features/seller/` returns nothing.)
   - Consumers of the seller contract may import exactly two things: the shared contract, now at
     **`lib/seller.ts`**, and the service locator `getSellerService`. Those are their whole read path —
     they render a seller's catalogue through the same typed interface the dashboard writes through, so
     the two cannot drift apart. They must never reach into seller *pages* or *components*.
   - Every other kind of shared code moves down into `components/ui`, `components/storefront` or
     `lib`. `lib/seller.ts` itself imports only from `lib/catalog`, so the dependency graph stays
     acyclic — which is the property that actually matters here.
   - **The move this rule anticipated has been made.** `features/seller/types/seller.ts` →
     `lib/seller.ts`, with `export *` left behind as a shim (not `export type *`: the module also
     exports the runtime values `ServiceError`, `isServiceError` and `NotImplementedInDemoError`).
     The trigger was the AR engine — `features/try-on` — being the third consumer. It is a sanctioned
     consumer on exactly these terms: `lib/seller` plus `getSellerService`, nothing else.
   - This check still holds and should be re-run after any try-on change:
     `grep -rn "features/seller" src/features/try-on/` returns only `getSellerService` and
     `lib/seller` imports.
2. Pages never import an adapter. Pages import hooks; hooks import `SellerService`.
3. No secret ever enters `src/`. Only `VITE_`-prefixed public config.
4. Every user-visible metric states its provenance (`demo` vs `live`).
5. A product's public URL and a store's public URL are stable and identify exactly one entity.
6. Ownership is enforced in the database. Client-side filtering is presentation, not security.
7. Adding a field to `Product` is a cross-module change — update the storefront and the section
   above in the same commit.
