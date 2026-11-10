-- Public gallery: only approved community submissions are visible to visitors.
-- Existing pending/rejected rows and private storage remain protected.
drop policy if exists "Users read own or approved videos" on public.community_videos;
create policy "Public read approved or own community videos"
on public.community_videos for select to anon, authenticated
using (
  status = 'approved'
  or user_id = (select auth.uid())
  or exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
);

drop policy if exists "Owners and admins read community videos" on storage.objects;
create policy "Read approved or owned community video objects"
on storage.objects for select to anon, authenticated
using (
  bucket_id = 'community-videos'
  and (
    exists (
      select 1 from public.community_videos v
      where v.object_path = storage.objects.name
        and v.status = 'approved'
    )
    or (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.admin_users a
      where a.user_id = (select auth.uid())
    )
  )
);
