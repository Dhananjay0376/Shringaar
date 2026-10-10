# Database and auth

**Last updated:** 2026-10-11
**Code:** `supabase/migrations/` (8 files) · `src/lib/supabaseClient.ts` · `src/features/seller/services/supabaseSellerService.ts`
**Spec:** `arch.md` §7 · **⚠ `arch.md` §7 is titled "proposed schema" and is stale in places** — see
`current-state.md`. The migrations are the source of truth.

---

## Ownership model

**Ownership is enforced in the database, not in the client.** `arch.md` §9 rule 6.

```
auth.users ──1:1──> profiles
     │
     └──1:1──> stores (owner_id)  ──1:N──> products (store_id)
                                              │
                                              └──1:N──> analytics_events
                                                        import_jobs
```

**`products` carries NO owner column.** Ownership is `products.store_id → stores.owner_id`, and the
RLS predicate is an `EXISTS` against `stores`. A denormalised `products.seller_id` (which `arch.md`
§7.3 originally sketched) would let a product's owner disagree with its store's — an ownership bug
waiting to happen. See `decisions.md`.

**One store per seller** is enforced by a **partial unique index** on `stores.owner_id`, not by the UI.

---

## The asset service is NOT in this schema

`backend/` (the mock-backed asset-processing service) keeps its jobs in an **in-memory dict** and writes
files under `backend/data/`. It has **no owner column and no session**, so the ownership rule above is
**not** enforced for anything it produces, and a job id is a bearer token for its results. Its
`processing_jobs` / `assets` tables are a planned migration, not an existing one — do not look for them
in `supabase/migrations/`. `import_jobs` is unrelated (website import, Phase 8).

**A seller can reach another seller's asset job today.** That is acceptable only because the service is
meant to bind loopback on a developer's machine. See the "Security posture" section of
`backend/README.md` and [`asset-pipeline.md`](./asset-pipeline.md).

---

## Tables

### `profiles`
`id uuid PK → auth.users(id) on delete cascade` · `display_name text` · `created_at` · `updated_at`

**Created by trigger, never by the client.** A client that could INSERT its own profile row could set
its own `id` to another user's and inherit their data. `handle_new_user()` runs as `SECURITY DEFINER`
on `auth.users` insert.

> For a **Google** signup, `display_name` falls back to the email local part: the trigger reads
> `raw_user_meta_data->>'display_name'`, and Google supplies `full_name`/`name` instead. The profile
> row is still created automatically.

### `stores`
`id uuid PK` · `owner_id uuid NOT NULL → auth.users` · `name` (1–120 chars) ·
`slug citext NOT NULL UNIQUE` (lowercase-hyphen regex) · `description` · `logo_url` ·
`business_type` (enum) · `whatsapp_number` · `existing_website_url` · `onboarding_completed bool
default false` · `city` · `contact_email` · `contact_phone` · `currency default 'INR'` · timestamps

- `slug` is **citext** so `MeenaJewels` and `meenajewels` cannot both be taken — a slug is a public
  URL key and the two would be indistinguishable to a visitor.
- `onboarding_completed` is what makes a half-built store resumable.
- `business_type` enum: `individual | boutique | retailer | wholesaler | manufacturer | other`
- `owner_id` is the **sole ownership anchor** for the store and, through it, every product.

### `products`
`id uuid PK` · `store_id uuid NOT NULL → stores on delete cascade` · `name` (1–160) · `slug` ·
`description` · `price numeric(12,2)` **nullable** · `currency` · `category` · `product_image_url` ·
`try_on_asset_url` · `try_on_asset_kind` · `try_on_anchor` · `original_product_url` ·
`status` (enum) · `ar_status` (enum) · `source` (enum) · `whatsapp_number` · `published_at` ·
timestamps

- **`unique (store_id, slug)`** — a slug is unique *within a store*, not globally. Two sellers may both
  have a `gold-jhumka`.
- `price` is nullable on purpose: a website-import draft can land without one. A *manual* product
  cannot, because the form requires it — a UI rule about the manual path, not a column constraint.
- `product_status`: `draft | published`
- `ar_status`: `needs_asset | ready | needs_review` (**no `rejected`**)
- `product_source`: `manual | website_import`
- `try_on_asset_kind` check: `none | image | glb | usdz`
- `try_on_anchor` check: `unspecified | finger | wrist | neck | ear | nose | ankle`
- `published_at` is set and cleared **by the database** (`sync_published_at()`), so it cannot disagree
  with `status` the way a client-supplied timestamp can.
- Indexes: `(store_id, status)`, `(store_id, created_at desc)`, `(store_id, updated_at desc)`

### `analytics_events`
`id bigint identity PK` · `store_id` · `product_id nullable` · `event_type` · `occurred_at` ·
`session_id` · `referrer`

`event_type` check: `store_visit | product_view | tryon_start | tryon_complete | outbound_click |
contact_click | qr_scan`

**Append-only, written by the PUBLIC storefront, read aggregated by the dashboard.** The dashboard
must never write here — a seller able to insert their own rows could inflate their own numbers.

### `import_jobs`
Groundwork for a website-import workflow. `import_job_status` enum: `queued | running | succeeded |
failed | cancelled`. **No crawler exists in this repository and nothing here pretends one does** — a
job is a record that an import was requested, what it was pointed at, and how it ended.

---

## Triggers and functions

| Object | Purpose |
| --- | --- |
| `touch_updated_at()` | Sets `updated_at` on update. Attached to profiles, stores, products, import_jobs. Maintained by trigger, never by the client. |
| `handle_new_user()` | Creates the `profiles` row on `auth.users` insert. `SECURITY DEFINER`. |
| `sync_published_at()` | Sets/clears `published_at` in step with `status`. |
| `slug_available(candidate text)` | `SECURITY DEFINER`. Returns one boolean, no row. |

`slug_available()` is `SECURITY DEFINER` because onboarding must answer "is this slug free?" *before*
inserting, but `stores` is owner-only under RLS and the row in question is a half-built store the
asker cannot see. A `SECURITY INVOKER` function would see only the caller's own row and answer "free"
to every question. It reveals strictly less than the public storefront already does, and it casts to
`citext` exactly as the unique index does.

`20261010151304_revoke_public_execute_on_trigger_fn.sql` revokes public EXECUTE on the trigger
function — a hardening pass that corrected an over-grant in the initial schema.

---

## Row Level Security

RLS is **on** for every table. Policies:

| Table | Policies |
| --- | --- |
| `profiles` | read own · update own |
| `stores` | read own · create own · update own · delete own |
| `products` | read own · create own · update own · delete own — all keyed on ownership through `stores` |
| `analytics_events` | **public records storefront events** (anon INSERT) · owner reads own |
| `import_jobs` | owner manages own |
| `storage.objects` | read own · insert own · update own · delete own — per bucket, keyed on `(storage.foldername(name))[1] = auth.uid()::text` |

**Nothing reads another seller's row.** The client-side filtering in the dashboard is presentation,
not security.

> **Open gap:** the anon INSERT policy on `analytics_events` exists, but **the client never writes a
> try-on event** — `tryon_start`/`tryon_complete` are event types with no producer. The dashboard
> currently reads demo aggregates only. See `tasks.md` P2.

---

## Public views — the only customer-facing read path

`storefront_stores` and `storefront_products`, both `security_barrier = true`.

- `storefront_stores`: `where onboarding_completed`
- `storefront_products`: joins `stores`, `where p.status = 'published' and s.onboarding_completed`
- `grant select ... to anon, authenticated`

**Safe-column rule — these views deliberately omit:** `owner_id`, `contact_email`, `contact_phone`.
The storefront must never expose seller-private data.

`storefront_stores` exposes: id, name, slug, description, logo_url, business_type, whatsapp_number,
existing_website_url, city, currency, created_at, updated_at.
`storefront_products` exposes: id, store_id, name, slug, description, price, currency, category,
product_image_url, try_on_asset_url, try_on_asset_kind, try_on_anchor, original_product_url, status,
ar_status, source, whatsapp_number, published_at, created_at, updated_at.

The views were **recreated rather than replaced** in migration 004 because the column list changes in
the middle, which `create or replace view` refuses.

---

## Storage buckets

See [`asset-pipeline.md`](./asset-pipeline.md) for limits and MIME allowlists.

`product-images` (5 MiB) · `tryon-assets` (25 MiB) · `store-logos` (2 MiB) — all public.

Path convention: **`{auth.uid()}/{product_id}/{uuid}.{ext}`**. The leading segment is the owner's user
id, which makes the write policy a string comparison rather than a join.

---

## Authentication

`src/lib/supabaseClient.ts` — **one client instance** for the app (`createClient` is cheap but each
call starts its own auth listener).

```ts
{
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'shringaar.auth.v1',
    flowType: 'pkce',
  }
}
```

### Email + password
`signIn` / `signUp` / `signOut` / `getSession` on the service interface. `SessionGate` guards the
seller routes.

### Google OAuth
Added 2026-10-11. Code-complete and unit-tested; **the live flow is unverified** — see
`current-state.md`.

- `ServiceCapabilities.oauth` is a **separate flag from `auth`**. A backend could verify a password and
  have no provider configured; a screen reading `auth` as "show the Google button" would offer a door
  that does not open.
- `signInWithOAuth('google')` on the interface; the Supabase adapter calls
  `auth.signInWithOAuth({ provider, options: { redirectTo, queryParams: { prompt: 'select_account' } } })`.
- `redirectTo` is `oauthRedirectUrl()` — **`config.publicSiteUrl` + `/sign-in`**, never a hardcoded
  host. The sign-in screen is the target because it is the only place that decides where a seller
  belongs (`landingPathFor(seller, store)`); a brand-new Google seller has an account and **no store**.
- Failure is read out of the URL by `readOAuthError(search, hash)` (`utils/oauth.ts`), because the
  redirect replaced the document and there is nothing to catch. It checks both the query and the
  fragment, and **returns `null` for a successful `?code=` return** — that behaviour is load-bearing:
  the screen clears error params from the address bar only when it returns non-null, and mistaking a
  code for an error would delete the authorization code mid-exchange.
- `prompt: 'select_account'` prevents silent reuse of an existing Google account on a shared machine.
- **No extra dependency was needed** — this is a redirect flow on the already-present
  `@supabase/supabase-js`. No Google Identity Services script and no client ID in the bundle.

**Dashboard configuration this depends on (must exist, cannot be verified from here):**
1. Authentication → Providers → Google: enabled with the client ID + secret.
2. Authentication → URL Configuration → **Redirect URLs**: `<origin>/sign-in` for **every** origin the
   app is served from. An unlisted URL is refused *before the browser comes back*, and the app cannot
   see that it happened.
3. Google Cloud Console → Authorized redirect URIs must contain
   `https://<project-ref>.supabase.co/auth/v1/callback`.

---

## Demo mode

When either `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing, `config.supabase` is `null`
and `createSellerService()` returns the **mock** adapter. A half-configured project is treated as
unconfigured rather than failing at call time.

There is **no third behaviour and no silent fallback**: a build that claims a backend exists and then
serves sample data is the failure `arch.md` §5 exists to prevent, and a build configured for demo that
silently reaches the network would be worse.

`.env.local` currently holds **both** variables, so a local dev server selects the **live** adapter.

---

## Secrets — the hard rules

- **Never** put `SUPABASE_SERVICE_ROLE_KEY` in a `VITE_` variable. Anything `VITE_`-prefixed is inlined
  into the shipped JS. The service-role key bypasses RLS entirely and belongs only in a server runtime
  or edge function.
- The **anon key is a public identifier**, safe *only* because RLS protects the rows.
- No secret, token, or credential is stored in this memory directory.
- `.env.local` is gitignored; `.env.example` documents the variable names with empty values.
