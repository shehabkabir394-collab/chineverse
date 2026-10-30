alter table public.movies add column if not exists download_links jsonb not null default '[]'::jsonb;
