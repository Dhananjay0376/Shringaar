-- ════════════════════════════════════════════════════════════════════════════════
-- Shringaar — 005 Store logos
--
-- The third bucket, and the reason it is not simply a folder inside `product-images`:
--
--   • Different lifetime. A logo is replaced on its own schedule and belongs to the brand, not to
--     any product. Keeping it out of `product-images` means the cleanup that runs when a product is
--     deleted — which removes the objects under that product's folder — can never touch it.
--   • Different cap. 2 MiB is generous for a mark that renders at 40px and 96px. A bucket-level
--     limit is the one check a client cannot forget to make.
--
-- Path convention stays `{auth.uid()}/{folder}/{uuid}.{ext}`, with `store-logo` as the folder, so
-- the same four write policies cover it by a string comparison against `auth.uid()` and nothing has
-- to learn a second rule.
-- ════════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'store-logos',
  'store-logos',
  true,
  2097152, -- 2 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── Extend the four object policies to the new bucket ─────────────────────────
-- Recreated rather than supplemented, so there stays exactly one policy per verb. A second INSERT
-- policy for the same command would be OR-ed with the first, which is how a bucket-scoped rule
-- quietly widens into "either of these", and it makes the set harder to read than it is.

drop policy if exists "read own storage objects" on storage.objects;
create policy "read own storage objects"
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('product-images', 'tryon-assets', 'store-logos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "insert own storage objects" on storage.objects;
create policy "insert own storage objects"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('product-images', 'tryon-assets', 'store-logos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE needs both halves: USING picks which existing objects may be replaced, WITH CHECK stops a
-- replace from renaming the object into another seller's folder.
drop policy if exists "update own storage objects" on storage.objects;
create policy "update own storage objects"
  on storage.objects for update
  to authenticated
  using (
    bucket_id in ('product-images', 'tryon-assets', 'store-logos')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('product-images', 'tryon-assets', 'store-logos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "delete own storage objects" on storage.objects;
create policy "delete own storage objects"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('product-images', 'tryon-assets', 'store-logos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
