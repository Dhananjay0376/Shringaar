-- 1. Pin the search_path on both trigger helpers. Neither references anything outside pg_catalog
--    today, but a mutable search_path means a caller who can create objects in a schema earlier in
--    the path could shadow a name these functions later resolve. Pinning it removes the class.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.sync_published_at()
returns trigger
language plpgsql
set search_path = ''
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

-- 2. handle_new_user() is a trigger body, not an API. Supabase exposes every function in `public`
--    through PostgREST as /rest/v1/rpc/<name>, so without this any anonymous caller could invoke
--    it directly. It is harmless when fired by a real auth.users insert and meaningless when called
--    by hand — but "meaningless if called" is not a reason to leave an endpoint open.
--
--    Revoking EXECUTE does NOT stop the trigger: trigger invocation does not check the invoking
--    role's EXECUTE privilege on the function.
--
--    NOTE: this revokes from anon and authenticated only, which turned out to be insufficient —
--    both inherit EXECUTE from PUBLIC. See 20261010151304_revoke_public_execute_on_trigger_fn.sql,
--    which is the grant that actually counts. The view comments below are also this migration's
--    work, so the file is kept in full rather than dropped.
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.touch_updated_at() from anon, authenticated;
revoke execute on function public.sync_published_at() from anon, authenticated;

comment on view public.storefront_stores is
  'Public read surface for storefront pages. SECURITY DEFINER by design: it runs as its owner, bypassing the owner-only RLS on public.stores, and is the access-control boundary itself — it hard-codes the safe column list (no owner_id, contact_email or contact_phone) and the onboarding_completed gate, and is security_barrier so a caller predicate cannot be pushed below the filter. Supabase''s security_definer_view lint fires on this deliberately.';

comment on view public.storefront_products is
  'Public read surface for storefront and product pages. SECURITY DEFINER by design — see storefront_stores. Filters to status = published within an onboarded store, and exposes no seller identity.';
