-- CineVerse 4K schema. Run in Supabase SQL Editor.
-- Add the first admin using the instructions in README.md.
create extension if not exists pgcrypto;
create table if not exists public.movies (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(title) between 1 and 180),
 release_year integer check(release_year is null or release_year between 1888 and 2100),
 genre text not null default '', language text not null default '',
 quality text not null default '1080p' check(quality in ('4K UHD','1080p','720p','Other')),
 description text not null default '',
 poster_url text check(poster_url is null or poster_url ~ '^https://'),
 trailer_url text check(trailer_url is null or trailer_url ~ '^https://'),
 download_url text check(download_url is null or download_url ~ '^https://'),
 published boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.admin_users(
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index if not exists movies_published_created_idx on public.movies(published,created_at desc);
create index if not exists movies_title_idx on public.movies(lower(title));
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
-- Intentionally no client insert/update/delete policy on admin_users.
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end; $$;
drop trigger if exists movies_set_updated_at on public.movies;
create trigger movies_set_updated_at before update on public.movies for each row execute function public.set_updated_at();
-- After creating an admin user under Authentication > Users, run:
-- insert into public.admin_users(user_id) values ('PASTE-AUTH-USER-UUID-HERE');
