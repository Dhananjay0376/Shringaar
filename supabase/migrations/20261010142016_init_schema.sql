-- ════════════════════════════════════════════════════════════════════════════════
-- Shringaar — 001 schema
--
-- profiles · stores · products · analytics_events · import_jobs
--
-- Design notes that are easy to get wrong later:
--
--  * **products carries NO owner column.** Ownership is `products.store_id → stores.owner_id`.
--    arch.md §7.3 originally denormalised `seller_id` onto products for a single-column RLS
--    predicate. The product spec explicitly forbids that ("avoid redundant ownership fields where
--    a relationship already determines ownership"), and a denormalised column that disagrees with
--    its store is an ownership bug waiting to happen. The RLS predicate therefore uses an EXISTS
--    against `stores`, which is index-served and cannot drift. The cost is one extra index probe
--    per row; the benefit is that "who owns this product" has exactly one answer.
--
--  * **Profiles are created by trigger, never by the client.** A client that could INSERT its own
--    profile row could set its own `id` to another user's and inherit their data. The trigger runs
--    as SECURITY DEFINER on `auth.users` insert, so the row exists before any client can ask.
--
--  * **`price` is nullable.** A website-import draft can land without a price; a manual product
--    cannot, because the form requires one before it will save. No constraint enforces that here
--    because it is a UI rule about the *manual* path, not a fact about the column.
-- ════════════════════════════════════════════════════════════════════════════════

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ── updated_at ────────────────────────────────────────────────────────────────
-- Maintained by trigger, never by the client. A client-supplied `updated_at` is a client claim
-- about the past; this is the database's own record of it (arch.md §7.6).
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── profiles ──────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'One row per authenticated user. Created by trigger on auth.users insert; the client never inserts here.';

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Creates the profile for a new auth user.
--
-- SECURITY DEFINER because it writes to `public` on behalf of a user who has no session yet during
-- signup. `search_path = ''` is set so nothing inside can be hijacked by a caller-controlled
-- schema. COALESCE handles the three ways a display name can be absent: a signup that supplied no
-- metadata, empty-string metadata, and an email with no local part.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fallback_name text;
begin
  fallback_name := nullif(split_part(coalesce(new.email, ''), '@', 1), '');

  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      fallback_name
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: if the project already had users before this migration, give them a profile too.
insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(nullif(split_part(coalesce(u.email, ''), '@', 1), ''))
from auth.users u
on conflict (id) do nothing;

-- ── stores ────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.business_type as enum (
    'individual', 'boutique', 'retailer', 'wholesaler', 'manufacturer', 'other'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.stores (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null references auth.users (id) on delete cascade,
  name                 text not null check (length(trim(name)) between 1 and 120),
  -- citext so "MeenaJewels" and "meenajewels" cannot both be taken. A store slug is a public
  -- URL key; two stores differing only in case would be indistinguishable to a visitor.
  slug                 citext not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description          text not null default '',
  logo_url             text,
  business_type        public.business_type,
  whatsapp_number      text,
  existing_website_url text,
  -- Onboarding resume hinges on this flag: a store row can exist with setup unfinished.
  onboarding_completed boolean not null default false,
  city                 text,
  contact_email        text,
  contact_phone        text,
  currency             text not null default 'INR',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on column public.stores.owner_id is
  'The authenticated seller. Sole ownership anchor for the store and, through it, every product.';

create index if not exists stores_owner_id_idx on public.stores (owner_id);

create trigger stores_touch_updated_at
  before update on public.stores
  for each row execute function public.touch_updated_at();

-- v1 ships one store per seller. A partial unique index enforces that in the database rather than
-- in a UI that could be bypassed, while still leaving the door open to lifting the rule later by
-- dropping one index instead of migrating data.
create unique index if not exists stores_one_per_owner_idx on public.stores (owner_id);

-- ── products ──────────────────────────────────────────────────────────────────
do $$ begin
  create type public.product_status as enum ('draft', 'published');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.ar_status as enum ('needs_asset', 'ready', 'needs_review');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.product_source as enum ('manual', 'website_import');
exception when duplicate_object then null;
end $$;

create table if not exists public.products (
  id                   uuid primary key default gen_random_uuid(),
  store_id             uuid not null references public.stores (id) on delete cascade,
  name                 text not null check (length(trim(name)) between 1 and 160),
  slug                 text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description          text not null default '',
  price                numeric(12, 2) check (price is null or price >= 0),
  currency             text not null default 'INR',
  category             text not null default 'other',
  product_image_url    text,
  -- Kept strictly separate from the display image. A photo is 2D placement material; a true 3D
  -- asset is authored elsewhere. Nothing here converts one into the other.
  try_on_asset_url     text,
  original_product_url text,
  status               public.product_status not null default 'draft',
  ar_status            public.ar_status not null default 'needs_asset',
  source               public.product_source not null default 'manual',
  whatsapp_number      text,
  published_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Slug is unique within a store, not globally: two sellers may both have a "gold-jhumka".
  unique (store_id, slug)
);

create index if not exists products_store_status_idx   on public.products (store_id, status);
create index if not exists products_store_created_idx  on public.products (store_id, created_at desc);
create index if not exists products_store_updated_idx  on public.products (store_id, updated_at desc);

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

-- `published_at` is set and cleared by the database, so it cannot disagree with `status` the way a
-- client-supplied timestamp can.
create or replace function public.sync_published_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and (old.status is distinct from 'published' or new.published_at is null) then
    new.published_at := coalesce(old.published_at, now());
  elsif new.status = 'draft' then
    new.published_at := null;
  end if;
  return new;
end;
$$;

create trigger products_sync_published_at
  before insert or update on public.products
  for each row execute function public.sync_published_at();

-- ── analytics_events ──────────────────────────────────────────────────────────
-- Append-only, written by the PUBLIC storefront, read aggregated by the dashboard. The dashboard
-- must never write here: a seller able to insert their own rows could inflate their own numbers,
-- which is the one thing an analytics surface must not permit.
create table if not exists public.analytics_events (
  id          bigint generated always as identity primary key,
  store_id    uuid not null references public.stores (id) on delete cascade,
  product_id  uuid references public.products (id) on delete set null,
  event_type  text not null check (event_type in (
                'store_visit', 'product_view', 'tryon_start', 'tryon_complete',
                'outbound_click', 'contact_click', 'qr_scan'
              )),
  occurred_at timestamptz not null default now(),
  session_id  text,
  referrer    text
);

create index if not exists analytics_events_store_time_idx on public.analytics_events (store_id, occurred_at desc);

-- ── import_jobs ───────────────────────────────────────────────────────────────
-- Groundwork for the TinyFish website-import workflow. No crawler exists in this repository and
-- nothing here pretends one does: a job is a *record* that an import was requested, what it was
-- pointed at, and how it ended. The crawl itself is someone else's system.
do $$ begin
  create type public.import_job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists public.import_jobs (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references public.stores (id) on delete cascade,
  source_url     text not null,
  status         public.import_job_status not null default 'queued',
  products_found integer,
  products_created integer,
  error_message  text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists import_jobs_store_created_idx on public.import_jobs (store_id, created_at desc);

create trigger import_jobs_touch_updated_at
  before update on public.import_jobs
  for each row execute function public.touch_updated_at();
