-- Additive CineVerse Ultimate migration. Existing movies/admin data and RLS remain intact.
create table if not exists public.live_channels (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(name) between 1 and 120),
 category text not null default 'General',
 logo_url text,
 stream_url text not null,
 stream_type text not null default 'hls' check (stream_type in ('hls','mp4','embed')),
 description text not null default '',
 is_published boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.community_videos (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (char_length(title) between 1 and 180),
 description text not null default '',
 object_path text not null,
 mime_type text not null,
 file_size bigint not null check (file_size > 0),
 status text not null default 'pending' check (status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id)
);
create index if not exists live_channels_published_idx on public.live_channels(is_published,category);
create index if not exists community_videos_status_idx on public.community_videos(status,created_at desc);
create index if not exists community_videos_user_idx on public.community_videos(user_id,created_at desc);
alter table public.live_channels enable row level security;
alter table public.community_videos enable row level security;
drop policy if exists "Public read published live channels" on public.live_channels;
create policy "Public read published live channels" on public.live_channels for select to anon,authenticated using (is_published or exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
drop policy if exists "Admins manage live channels" on public.live_channels;
create policy "Admins manage live channels" on public.live_channels for all to authenticated using (exists(select 1 from public.admin_users a where a.user_id=(select auth.uid()))) with check (exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
drop policy if exists "Users submit own videos" on public.community_videos;
create policy "Users submit own videos" on public.community_videos for insert to authenticated with check (user_id=(select auth.uid()) and status='pending');
drop policy if exists "Users read own or approved videos" on public.community_videos;
create policy "Users read own or approved videos" on public.community_videos for select to authenticated using (user_id=(select auth.uid()) or status='approved' or exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
drop policy if exists "Admins review community videos" on public.community_videos;
create policy "Admins review community videos" on public.community_videos for update to authenticated using (exists(select 1 from public.admin_users a where a.user_id=(select auth.uid()))) with check (exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
-- Private bucket: video files are not publicly addressable before moderation.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('community-videos','community-videos',false,524288000,array['video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public=false,file_size_limit=524288000,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Users upload own community videos" on storage.objects;
create policy "Users upload own community videos" on storage.objects for insert to authenticated with check (bucket_id='community-videos' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "Owners and admins read community videos" on storage.objects;
create policy "Owners and admins read community videos" on storage.objects for select to authenticated using (bucket_id='community-videos' and ((storage.foldername(name))[1]=(select auth.uid())::text or exists(select 1 from public.admin_users a where a.user_id=(select auth.uid()))));
drop policy if exists "Owners delete own pending uploads" on storage.objects;
create policy "Owners delete own pending uploads" on storage.objects for delete to authenticated using (bucket_id='community-videos' and (storage.foldername(name))[1]=(select auth.uid())::text);
-- Run once in Supabase SQL Editor. Never expose a service_role key in browser code.
