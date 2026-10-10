-- ════════════════════════════════════════════════════════════════════════════════
-- Shringaar — 004 Try-on asset shape, slug availability, public views v2
--
-- Three things the first three migrations left open, all found by trying to write the client
-- adapter against them:
--
--  1. `products` stored a try-on *URL* and nothing about what the URL is. The app's `TryOnAsset`
--     has carried a `kind` ('none' | 'image' | 'glb' | 'usdz') and an `anchor` ('ear', 'wrist', …)
--     since it was written, and inferring them from a file extension on every read is a guess
--     dressed as a mapping. Both are now columns.
--
--  2. `ar_status` stays. It is not a duplicate of `kind`: `kind` records what asset exists,
--     `ar_status` records whether anyone has checked it. A crawled product can arrive with a
--     perfectly good `kind` and still need `needs_review`. Phase 8 (website import) is the reason
--     it exists.
--
--  3. Onboarding has to answer "is this slug free?" before it can insert. The demo adapter could
--     only answer for the one store it knew about; a real one cannot ask, because `stores` is
--     owner-only under RLS and a *half-built* store is exactly the row the question is about.
--     `slug_available()` answers it without exposing a row.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── products: record what the try-on asset is, not just where it lives ────────

alter table public.products
  add column if not exists try_on_asset_kind text not null default 'none',
  add column if not exists try_on_anchor     text not null default 'unspecified';

-- Added as named constraints so a re-run of this migration is a no-op rather than a duplicate.
do $$ begin
  alter table public.products
    add constraint products_try_on_asset_kind_check
    check (try_on_asset_kind in ('none', 'image', 'glb', 'usdz'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.products
    add constraint products_try_on_anchor_check
    check (try_on_anchor in ('unspecified', 'finger', 'wrist', 'neck', 'ear', 'nose', 'ankle'));
exception when duplicate_object then null;
end $$;

comment on column public.products.try_on_asset_kind is
  'What the try-on asset is: none, a 2D placement photo, or an authored .glb/.usdz. Distinct from ar_status, which records review state.';

comment on column public.products.try_on_anchor is
  'Where an AR client should attempt to place the piece. A hint for the renderer, never a guarantee.';

-- ── slug availability ─────────────────────────────────────────────────────────
-- SECURITY DEFINER, and it has to be: under RLS a SECURITY INVOKER function reading `stores`
-- would see only the caller's own row and answer "free" to every question, including the one that
-- matters. It returns a single boolean and no row, so it reveals strictly less than the public
-- storefront already does — and the unique index it mirrors is case-insensitive, which is why the
-- comparison casts to citext exactly as the index does.

create or replace function public.slug_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    candidate is not null
    and trim(candidate) <> ''
    and not exists (
      select 1 from public.stores s where s.slug = trim(candidate)::extensions.citext
    );
$$;

comment on function public.slug_available(text) is
  'True when no store holds this slug. Mirrors stores_slug_key, including its case-insensitivity. Authenticated callers only.';

revoke all on function public.slug_available(text) from public, anon;
grant execute on function public.slug_available(text) to authenticated;

-- ── public views v2 ───────────────────────────────────────────────────────────
-- Recreated rather than replaced: the column list changes in the middle, which
-- `create or replace view` refuses. The safe-column rule from 002 is unchanged — no `owner_id`,
-- no `contact_email`, no `contact_phone`, and the same WHERE gates.

drop view if exists public.storefront_products;
drop view if exists public.storefront_stores;

create view public.storefront_stores
with (security_barrier = true) as
select
  s.id, s.name, s.slug, s.description, s.logo_url, s.business_type,
  s.whatsapp_number, s.existing_website_url, s.city, s.currency,
  s.created_at, s.updated_at
from public.stores s
where s.onboarding_completed;

create view public.storefront_products
with (security_barrier = true) as
select
  p.id, p.store_id, p.name, p.slug, p.description, p.price, p.currency, p.category,
  p.product_image_url, p.try_on_asset_url, p.try_on_asset_kind, p.try_on_anchor,
  p.original_product_url, p.status, p.ar_status, p.source, p.whatsapp_number,
  p.published_at, p.created_at, p.updated_at
from public.products p
join public.stores s on s.id = p.store_id
where p.status = 'published' and s.onboarding_completed;

grant select on public.storefront_stores, public.storefront_products to anon, authenticated;
