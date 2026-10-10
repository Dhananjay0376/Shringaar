-- ════════════════════════════════════════════════════════════════════════════════
-- Shringaar — 003 Storage
--
-- Two buckets, kept separate because they hold different things and have different rules:
--
--   product-images  what a customer sees. Cap ~5 MB, images only.
--   tryon-assets    what the AR client consumes. A photo for 2D placement, or a real .glb/.usdz.
--                   Much larger cap because a mesh is not a JPEG.
--
-- Both are public-read: they are served to anonymous visitors on the storefront, and a signed-URL
-- dance for a product thumbnail would cost more than it protects.
--
-- **Path convention: `{auth.uid()}/{product_id}/{uuid}.{ext}`.** The leading segment is the
-- owner's user id, which makes the write policy a string comparison against `auth.uid()` — no
-- join, nothing to drift. It also means a seller cannot overwrite another seller's object even if
-- they learn its exact path, because their own id will not match the prefix.
--
-- MIME types and sizes are declared on the bucket so the platform rejects an oversized or
-- wrong-typed upload before it lands. That is a backstop, not the whole check: the client
-- validates before uploading so the seller gets a useful message instead of a 400 (Phase 6), and
-- arch.md §7.4 notes the dimension check still has to happen on read.
-- ════════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'product-images',
    'product-images',
    true,
    5242880, -- 5 MiB
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
  ),
  (
    'tryon-assets',
    'tryon-assets',
    true,
    26214400, -- 25 MiB, sized for a .glb
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/avif',
      'model/gltf-binary',          -- .glb
      'model/vnd.usdz+zip',         -- .usdz
      'application/octet-stream'    -- browsers routinely send this for .glb
    ]
  )
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── Reads ─────────────────────────────────────────────────────────────────────
-- Both buckets are public, so objects are fetchable by URL without any policy. These SELECT
-- policies exist for the *authenticated API* paths — listing a folder, and letting the dashboard
-- confirm an upload landed — and are scoped to the caller's own prefix so bucket listing does not
-- become a directory of every seller's inventory.

drop policy if exists "read own storage objects" on storage.objects;
create policy "read own storage objects"
  on storage.objects for select
  to authenticated
  using (
    bucket_id in ('product-images', 'tryon-assets')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Writes ────────────────────────────────────────────────────────────────────
-- Insert, update and delete are each scoped to the caller's own folder. UPDATE needs both halves:
-- USING picks which existing objects may be replaced, WITH CHECK stops a replace from renaming the
-- object into another seller's folder.

drop policy if exists "insert own storage objects" on storage.objects;
create policy "insert own storage objects"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in ('product-images', 'tryon-assets')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "update own storage objects" on storage.objects;
create policy "update own storage objects"
  on storage.objects for update
  to authenticated
  using (
    bucket_id in ('product-images', 'tryon-assets')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('product-images', 'tryon-assets')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "delete own storage objects" on storage.objects;
create policy "delete own storage objects"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in ('product-images', 'tryon-assets')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
