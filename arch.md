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
   `src/features/seller/`. The customer storefront lives in `src/features/storefront/`. Shared
   primitives live in `src/components/ui/`. Nothing in `seller/` imports from `storefront/`.
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
| Data | service abstraction + browser-local mock | no Supabase project exists yet |

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
│   ├── seller/
│   │   ├── components/         # SellerSidebar, SellerHeader, StatCard, ProductCard,
│   │   │                       # ProductTable, ProductForm, EmptyState, QrDialog,
│   │   │                       # DemoBadge, ActivityFeed, AnalyticsChart
│   │   ├── context/            # SellerProvider — session + store for the shell
│   │   ├── hooks/              # useAsync, useProducts, useStore, useAnalytics, useDebounced
│   │   ├── layout/             # SellerLayout — sidebar + header + <Outlet/>
│   │   ├── pages/              # SellerDashboard, SellerProducts, AddProduct, EditProduct,
│   │   │                       # SellerStore, SellerAnalytics, SellerSettings, SellerSignIn
│   │   ├── services/           # sellerService (interface + adapter selection), mockDb, mockSellerService
│   │   ├── types/              # seller.ts — the shared data contract
│   │   └── utils/              # slug, validation, product/URL/currency helpers
│   └── storefront/
│       └── pages/              # PublicStore, PublicProduct — customer-facing, read-only
├── lib/                        # config, formatting, clipboard, qr, file reading, ids
├── routes/                     # paths.ts (route constants) + router.tsx
├── styles/                     # tokens.css, base.css, app.css
├── App.tsx
└── main.tsx
```

**Rule of thumb for where code goes:** reusable across features → `src/components/ui` or `src/lib`.
Specific to selling → `src/features/seller`. Specific to shopping → `src/features/storefront`.

The customer AR engine is intentionally **not** built here. `storefront/` renders read-only public
pages and hands the try-on asset to a future AR module via a URL — see §8.

---

## 4. Data contract (`features/seller/types/seller.ts`)

The types are the contract between the seller dashboard, the public storefront and the future AR
pipeline. All three read the same `Product`. Changing a field here is a cross-module change.

```
Seller  1 ──── * Store          (one seller owns ≥1 store; v1 ships one active store)
Store   1 ──── * Product
Product 0..1 ·· TryOnAsset      (independent of the display image)
Product 1 ──── * AnalyticsEvent (conceptual — events are aggregated server-side)
```

| Entity | Key fields | Notes |
| --- | --- | --- |
| `Seller` | `id`, `email`, `displayName` | `id` is the auth user id — the ownership anchor |
| `Store` | `id`, `sellerId`, `name`, `slug`, `logoUrl`, `description`, `contactEmail`, `contactPhone`, `whatsappNumber`, `currency` | `slug` is the public URL key, unique per platform |
| `Product` | `id`, `sellerId`, `storeId`, `name`, `slug`, `description`, `price`, `currency`, `category`, `status`, `image`, `tryOnAsset`, `externalProductUrl`, `whatsappNumber` | `status: 'draft' \| 'published'` |
| `TryOnAsset` | `kind: 'image' \| 'glb' \| 'usdz' \| 'none'`, `url`, `anchor`, `uploadedAt` | `anchor` ∈ finger/wrist/neck/ear/ankle |
| `AnalyticsSummary` | `range`, `dataSource`, `totals`, `series[]`, `topProducts[]` | `dataSource` drives the demo badge |

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

---

## 6. Routing

Single router (`src/routes/router.tsx`), route strings centralised in `src/routes/paths.ts`.

| Route | Screen | Access |
| --- | --- | --- |
| `/` | redirect → `/seller/dashboard` | — |
| `/seller/dashboard` | Overview | seller session |
| `/seller/products` | Products list | seller session |
| `/seller/products/new` | Add Product | seller session |
| `/seller/products/:productId/edit` | Edit Product | seller session |
| `/seller/store` | My Store + live storefront preview | seller session |
| `/seller/analytics` | Analytics | seller session |
| `/seller/settings` | Settings | seller session |
| `/seller/sign-in` | Session placeholder (no auth provider wired) | public |
| `/s/:storeSlug` | Public storefront | public |
| `/s/:storeSlug/p/:productId` | Public product + try-on entry point | public |
| `/p/:productId` | Resolves a bare product link → its storefront URL | public |
| `*` | Not found | public |

Seller routes are nested under one `SellerLayout` so the sidebar and header mount once. They are
wrapped in a `RequireSeller` guard reading `SellerContext`; in demo mode the guard offers the demo
session rather than pretending a login happened.

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

**AR try-on engine.** Not implemented — and this repository does not pretend otherwise. The
boundary is: the dashboard stores a try-on asset and publishes an anchor hint; the AR client is
given `productId`, the asset URL, the asset kind and the anchor, and does the rendering itself. The
product page exposes a single `VITE_TRYON_BASE_URL/{productId}` link so the AR client stays
decoupled from dashboard routing.

**What a product photo is not.** Uploading a JPEG of a ring does not produce a 3D model, and nothing
in the UI claims it does. An ordinary photo is a *placement image* for 2D overlay — which is
genuinely useful — while generating a true 3D asset is a separate authoring step that produces a
`.glb`/`.usdz`. The form states this plainly next to the field.

---

## 9. Architectural constraints (do not violate without updating this doc)

1. `features/seller` and `features/storefront` are layered, not symmetric: **the storefront may depend
   on the seller module, never the reverse.**
   - `features/seller` must not import from `features/storefront` — no components, pages, hooks or
     anything else. (Checkable: `grep -rn "features/storefront" src/features/seller/` returns nothing.)
   - `features/storefront` may import exactly two things from `features/seller`: the shared contract
     in `features/seller/types/seller.ts` (as `import type`, so it vanishes at build time) and the
     service locator `getSellerService`. Those are the storefront's whole read path — it renders a
     seller's catalogue through the same typed interface the dashboard writes through, so the two
     cannot drift apart. It must never reach into seller *pages* or *components*.
   - Every other kind of shared code moves down into `components/ui`, `components/storefront` or
     `lib`. `types/seller.ts` itself imports only from `lib/catalog`, so the dependency graph stays
     acyclic — which is the property that actually matters here.
   - When a third consumer of the contract appears (the AR module), move `types/seller.ts` down into
     `lib` and leave a re-export behind, rather than adding a third feature that imports across.
2. Pages never import an adapter. Pages import hooks; hooks import `SellerService`.
3. No secret ever enters `src/`. Only `VITE_`-prefixed public config.
4. Every user-visible metric states its provenance (`demo` vs `live`).
5. A product's public URL and a store's public URL are stable and identify exactly one entity.
6. Ownership is enforced in the database. Client-side filtering is presentation, not security.
7. Adding a field to `Product` is a cross-module change — update the storefront and the section
   above in the same commit.
