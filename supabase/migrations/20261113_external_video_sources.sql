-- External authorized video sources. Additive only: existing movies and R2 assets stay untouched.
create table if not exists public.movie_video_sources (
 id uuid primary key default gen_random_uuid(),
 movie_id uuid not null references public.movies(id) on delete cascade,
 source_type text not null check (source_type in ('embed','direct','local')),
 provider text not null default '',
 quality text not null default 'Auto',
 watch_url text,
 download_url text,
 license_name text not null default '',
 license_url text,
 commercial_use boolean not null default false,
 redistribution_allowed boolean not null default false,
 attribution_required boolean not null default false,
 attribution_text text not null default '',
 rights_verified boolean not null default false,
 is_active boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint movie_video_sources_has_url check (watch_url is not null or download_url is not null),
 constraint movie_video_sources_https check (
  (watch_url is null or watch_url ~* '^https://') and
  (download_url is null or download_url ~* '^https://') and
  (license_url is null or license_url ~* '^https://')
 )
);
create index if not exists movie_video_sources_movie_idx on public.movie_video_sources(movie_id,is_active,created_at desc);
alter table public.movie_video_sources enable row level security;
revoke all on public.movie_video_sources from anon,authenticated;
grant select on public.movie_video_sources to anon,authenticated;
grant insert,update,delete on public.movie_video_sources to authenticated;
grant all on public.movie_video_sources to service_role;
drop policy if exists "Public read active authorized video sources" on public.movie_video_sources;
create policy "Public read active authorized video sources" on public.movie_video_sources
 for select to anon,authenticated using (
  is_active=true and rights_verified=true and
  exists(select 1 from public.movies m where m.id=movie_id and m.published=true)
 );
drop policy if exists "Admins manage video sources" on public.movie_video_sources;
create policy "Admins manage video sources" on public.movie_video_sources for all to authenticated
 using(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())))
 with check(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
drop trigger if exists movie_video_sources_set_updated_at on public.movie_video_sources;
create trigger movie_video_sources_set_updated_at before update on public.movie_video_sources
 for each row execute function public.set_updated_at();
