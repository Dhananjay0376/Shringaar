-- Every store row must be owned by the caller, and the client is not the party that gets to say so.
--
-- The adapter deliberately never sends `owner_id` when it creates a store — that is the right shape,
-- because a client that names its own owner is a client that can be talked into naming someone
-- else's. But the column had no default, so omitting it sent NULL, the NOT NULL constraint and then
-- the `create own store` WITH CHECK both failed, and store creation was impossible: a new seller saw
-- "Creating your store is not permitted for this account." as the first thing after signing up.
--
-- Defaulting the column to `auth.uid()` fixes it by putting the decision in the only place it
-- belongs. The session says who owns the row; the payload cannot influence it at all, because a
-- DEFAULT is consulted only when the column is omitted. A client that *does* send an `owner_id` still
-- has to satisfy the RLS policy, which is left exactly as it was as defence in depth.
alter table public.stores
  alter column owner_id set default auth.uid();

comment on column public.stores.owner_id is
  'The auth user who owns this store. Defaults to auth.uid() so the client never supplies it — see 20261010153530_stores_owner_defaults_to_session.sql. Row Level Security still requires owner_id = auth.uid() on both INSERT and UPDATE, so an explicit value from a client cannot widen access.';
