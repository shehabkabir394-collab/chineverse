-- CineVerse R2 video asset catalog. Additive: preserves existing movies and data.
create table if not exists public.movie_media_assets (
 id uuid primary key default gen_random_uuid(),
 movie_id uuid not null references public.movies(id) on delete cascade,
 quality text not null check (quality in ('480p','720p','1080p','2K','4K UHD')),
 object_key text not null unique,
 public_url text not null,
 mime_type text not null,
 file_size bigint not null check (file_size > 0),
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(movie_id, quality)
);
create index if not exists movie_media_assets_movie_idx on public.movie_media_assets(movie_id,is_active);
alter table public.movie_media_assets enable row level security;
drop policy if exists "Public read active assets for published movies" on public.movie_media_assets;
create policy "Public read active assets for published movies" on public.movie_media_assets
 for select to anon,authenticated using (
  (is_active and exists(select 1 from public.movies m where m.id=movie_id and m.published=true))
  or exists(select 1 from public.admin_users a where a.user_id=(select auth.uid()))
 );
drop policy if exists "Admins insert movie media assets" on public.movie_media_assets;
create policy "Admins insert movie media assets" on public.movie_media_assets for insert to authenticated
 with check(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
drop policy if exists "Admins update movie media assets" on public.movie_media_assets;
create policy "Admins update movie media assets" on public.movie_media_assets for update to authenticated
 using(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())))
 with check(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
drop policy if exists "Admins delete movie media assets" on public.movie_media_assets;
create policy "Admins delete movie media assets" on public.movie_media_assets for delete to authenticated
 using(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
