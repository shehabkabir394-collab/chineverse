-- Publicly expose only the IDs of titles imported from the user's video server.
-- This avoids opening the server_media_imports table itself to public reads.
create or replace function public.cineverse_public_server_import_movie_ids()
returns table(movie_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct smi.movie_id
  from public.server_media_imports smi
  where smi.movie_id is not null;
$$;

revoke all on function public.cineverse_public_server_import_movie_ids() from public, anon, authenticated;
grant execute on function public.cineverse_public_server_import_movie_ids() to anon, authenticated;
