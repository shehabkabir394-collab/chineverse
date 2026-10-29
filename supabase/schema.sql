-- CineVerse 4K schema + backward-compatible feature migration.
create extension if not exists pgcrypto;
create table if not exists public.movies (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(title) between 1 and 180),
 release_year integer check(release_year is null or release_year between 1888 and 2100),
 genre text not null default '', language text not null default '',
 quality text not null default '1080p',
 description text not null default '',
 poster_url text, trailer_url text, download_url text,
 published boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.admin_users(
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
-- Add new catalog fields safely for existing installations.
alter table public.movies add column if not exists media_type text not null default 'movie';
alter table public.movies add column if not exists rating numeric(3,1);
alter table public.movies add column if not exists backdrop_url text;
alter table public.movies add column if not exists cast_members text not null default '';
alter table public.movies add column if not exists runtime_minutes integer;
alter table public.movies add column if not exists content_status text not null default 'Released';
alter table public.movies add column if not exists seasons integer;
alter table public.movies add column if not exists episodes integer;
alter table public.movies add column if not exists tags text not null default '';
alter table public.movies add column if not exists updated_at timestamptz not null default now();
alter table public.movies drop constraint if exists movies_quality_check;
alter table public.movies add constraint movies_quality_check check (quality in ('480p','720p','1080p','2K','4K UHD','HEVC','Other'));
alter table public.movies drop constraint if exists movies_media_type_check;
alter table public.movies add constraint movies_media_type_check check (media_type in ('movie','series','anime'));
alter table public.movies drop constraint if exists movies_rating_check;
alter table public.movies add constraint movies_rating_check check (rating is null or rating between 0 and 10);
create index if not exists movies_published_created_idx on public.movies(published,created_at desc);
create index if not exists movies_title_idx on public.movies(lower(title));
create index if not exists movies_type_idx on public.movies(media_type);
alter table public.movies enable row level security;
alter table public.admin_users enable row level security;
drop policy if exists "Public can read published movies" on public.movies;
create policy "Public can read published movies" on public.movies for select to anon,authenticated
using(published=true or exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
drop policy if exists "Admins can insert movies" on public.movies;
create policy "Admins can insert movies" on public.movies for insert to authenticated
with check(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
drop policy if exists "Admins can update movies" on public.movies;
create policy "Admins can update movies" on public.movies for update to authenticated
using(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())))
with check(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
drop policy if exists "Admins can delete movies" on public.movies;
create policy "Admins can delete movies" on public.movies for delete to authenticated
using(exists(select 1 from public.admin_users a where a.user_id=(select auth.uid())));
drop policy if exists "Admins can read own membership" on public.admin_users;
create policy "Admins can read own membership" on public.admin_users for select to authenticated
using(user_id=(select auth.uid()));
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end; $$;
drop trigger if exists movies_set_updated_at on public.movies;
create trigger movies_set_updated_at before update on public.movies for each row execute function public.set_updated_at();
-- No client-side write policy for admin_users. Add admin UUID manually:
-- insert into public.admin_users(user_id) values ('AUTH-USER-UUID');
