-- ════════════════════════════════════════════════════════════════════════════════
-- Shringaar — 002 Row Level Security
--
-- The ownership model, stated once:
--
--   auth.users ──1:1── profiles
--        │
--        └──1:N── stores ──1:N── products
--                     └──1:N── analytics_events, import_jobs
--
-- The base tables are **owner-only**. There is no "public can read some rows" policy on `stores`
-- or `products`, and that is deliberate.
--
-- Why: RLS is row-level, not column-level. A policy like `using (onboarding_completed)` on
-- `stores` would let any anonymous visitor SELECT * and read every store's `contact_email`. The
-- public storefront needs a store's name and WhatsApp number; it has no business reading its
-- owner's contact email. So public reads go through the `storefront_*` views below, which
-- hard-code a safe column list and a safe WHERE, run as their owner (bypassing RLS on purpose),
-- and are marked `security_barrier` so a caller-supplied predicate cannot be pushed down beneath
-- the filter and leak rows the view excluded.
--
-- Net effect: `anon` has no privilege on the base tables at all, and the views are the only
-- public surface. "No client can bypass ownership by supplying a different store ID" then holds
-- by construction — every policy that writes re-derives ownership from `stores`, and `WITH CHECK`
-- re-evaluates it against the *new* row, so a product cannot be moved into a store the caller
-- does not own.
-- ════════════════════════════════════════════════════════════════════════════════

alter table public.profiles         enable row level security;
alter table public.stores           enable row level security;
alter table public.products         enable row level security;
alter table public.analytics_events enable row level security;
alter table public.import_jobs      enable row level security;

-- ══ profiles ═══════════════════════════════════════════════════════════════════
-- Read and update own row only. There is deliberately NO insert policy: rows are created by the
-- `on_auth_user_created` trigger, which runs SECURITY DEFINER. A client that could insert its own
-- profile row could supply someone else's `id`.
--
-- There is also no `role` column anywhere in this schema, so "assign yourself a privileged role"
-- has no column to target. Privilege lives in `auth.users` and in the JWT, neither of which a
-- client can write.

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ══ stores ════════════════════════════════════════════════════════════════════

drop policy if exists "read own store" on public.stores;
create policy "read own store"
  on public.stores for select
  to authenticated
  using (owner_id = auth.uid());

-- `with check (owner_id = auth.uid())` on insert is what stops a client from creating a store it
-- attributes to somebody else.
drop policy if exists "create own store" on public.stores;
create policy "create own store"
  on public.stores for insert
  to authenticated
  with check (owner_id = auth.uid());

-- Both USING and WITH CHECK: the first limits which rows may be updated, the second stops the
-- update from *reassigning* `owner_id` to another user (which would hand the store away, or steal
-- one by rewriting the owner).
drop policy if exists "update own store" on public.stores;
create policy "update own store"
  on public.stores for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "delete own store" on public.stores;
create policy "delete own store"
  on public.stores for delete
  to authenticated
  using (owner_id = auth.uid());

-- ══ products ══════════════════════════════════════════════════════════════════
-- No `owner_id` on this table. Every predicate resolves ownership through the parent store, and
-- `stores_one_per_owner_idx` keeps that lookup cheap.

drop policy if exists "read own products" on public.products;
create policy "read own products"
  on public.products for select
  to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = products.store_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists "create own products" on public.products;
create policy "create own products"
  on public.products for insert
  to authenticated
  with check (
    exists (
      select 1 from public.stores s
      where s.id = products.store_id and s.owner_id = auth.uid()
    )
  );

-- The WITH CHECK is the important half: it re-tests the *destination* store, so an UPDATE cannot
-- move a product out of the caller's store and into a stranger's.
drop policy if exists "update own products" on public.products;
create policy "update own products"
  on public.products for update
  to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = products.store_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.stores s
      where s.id = products.store_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists "delete own products" on public.products;
create policy "delete own products"
  on public.products for delete
  to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = products.store_id and s.owner_id = auth.uid()
    )
  );

-- ══ analytics_events ══════════════════════════════════════════════════════════
-- Append-only from the public storefront; readable as an aggregate by the owning seller. There is
-- no UPDATE and no DELETE policy, so nobody — including the owner — can rewrite history or erase a
-- number they dislike. That is the whole point of keeping analytics out of the dashboard's write
-- path (arch.md §7.5).

drop policy if exists "public records storefront events" on public.analytics_events;
create policy "public records storefront events"
  on public.analytics_events for insert
  to anon, authenticated
  with check (
    exists (
      select 1 from public.stores s
      where s.id = analytics_events.store_id and s.onboarding_completed
    )
  );

drop policy if exists "owner reads own events" on public.analytics_events;
create policy "owner reads own events"
  on public.analytics_events for select
  to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = analytics_events.store_id and s.owner_id = auth.uid()
    )
  );

-- ══ import_jobs ═══════════════════════════════════════════════════════════════
-- Owner-only, full CRUD, resolved through the store exactly as products are.

drop policy if exists "owner manages own import jobs" on public.import_jobs;
create policy "owner manages own import jobs"
  on public.import_jobs for all
  to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = import_jobs.store_id and s.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.stores s
      where s.id = import_jobs.store_id and s.owner_id = auth.uid()
    )
  );

-- ══ Public storefront views ═══════════════════════════════════════════════════
-- These run as their owner (postgres) and therefore bypass RLS. They are the access-control
-- boundary for anonymous traffic, so the column list and the WHERE are both load-bearing:
--
--   * `owner_id`, `contact_email` and `contact_phone` are absent. A visitor needs a shop's name
--     and its WhatsApp number, not its owner's account identity.
--   * `onboarding_completed` is the gate. The spec calls this "published stores"; the flag the
--     spec asked to store on `stores` is what actually records that a shop is real.
--   * `security_barrier = true` stops the planner pushing a caller's predicate below the filter,
--     which is how a "safe" view leaks rows through a side channel.

create or replace view public.storefront_stores
with (security_barrier = true) as
select
  s.id, s.name, s.slug, s.description, s.logo_url, s.business_type,
  s.whatsapp_number, s.existing_website_url, s.city, s.currency,
  s.created_at, s.updated_at
from public.stores s
where s.onboarding_completed;

create or replace view public.storefront_products
with (security_barrier = true) as
select
  p.id, p.store_id, p.name, p.slug, p.description, p.price, p.currency, p.category,
  p.product_image_url, p.try_on_asset_url, p.original_product_url, p.status,
  p.ar_status, p.source, p.whatsapp_number, p.published_at, p.created_at, p.updated_at
from public.products p
join public.stores s on s.id = p.store_id
where p.status = 'published' and s.onboarding_completed;

-- `anon` gets no privilege on the base tables. Public traffic reaches only the views.
revoke all on public.profiles, public.stores, public.products,
              public.analytics_events, public.import_jobs
  from anon;

grant select on public.storefront_stores, public.storefront_products to anon, authenticated;

-- RLS gates rows, but a role still needs table privileges to be evaluated at all.
grant select, insert, update, delete on public.stores, public.products, public.import_jobs
  to authenticated;
grant select, insert, update on public.analytics_events to authenticated;
grant select, update on public.profiles to authenticated;
