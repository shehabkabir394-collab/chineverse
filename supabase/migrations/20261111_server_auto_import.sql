-- Idempotent laptop-server movie import. Additive only; existing movies and RLS remain intact.
create table if not exists public.server_media_imports (
  source_key text primary key,
  movie_id uuid references public.movies(id) on delete set null,
  imported_at timestamptz not null default now()
);
alter table public.server_media_imports enable row level security;
revoke all on public.server_media_imports from anon, authenticated;
grant all on public.server_media_imports to service_role;

create or replace function public.cineverse_import_server_movie(p_source_key text, p_movie jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movie_id uuid;
  v_existing uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'service_role required' using errcode='42501';
  end if;
  if p_source_key is null or length(p_source_key) < 16 or length(p_source_key) > 128 then
    raise exception 'invalid source key';
  end if;
  select movie_id into v_existing from public.server_media_imports where source_key=p_source_key;
  if found then
    return jsonb_build_object('duplicate',true,'movie_id',v_existing);
  end if;

  insert into public.movies (
    title, release_year, genre, language, quality, description,
    poster_url, trailer_url, download_url, published, tmdb_id,
    media_type, rating, backdrop_url, video_url, cast_members,
    runtime_minutes, content_status, watch_url
  ) values (
    left(coalesce(p_movie->>'title','Untitled'),180),
    nullif(p_movie->>'release_year','')::integer,
    coalesce(p_movie->>'genre',''),
    coalesce(p_movie->>'language',''),
    case when p_movie->>'quality' in ('480p','720p','1080p','2K','4K UHD','HEVC','Other') then p_movie->>'quality' else '1080p' end,
    coalesce(p_movie->>'description',''),
    p_movie->>'poster_url', p_movie->>'trailer_url', p_movie->>'download_url',
    true, nullif(p_movie->>'tmdb_id','')::bigint,
    'movie', nullif(p_movie->>'rating','')::numeric,
    p_movie->>'backdrop_url', p_movie->>'video_url',
    coalesce(p_movie->>'cast_members',''),
    nullif(p_movie->>'runtime_minutes','')::integer,
    coalesce(p_movie->>'content_status','Released'),
    p_movie->>'watch_url'
  ) returning id into v_movie_id;

  insert into public.server_media_imports(source_key,movie_id) values(p_source_key,v_movie_id);
  return jsonb_build_object('duplicate',false,'movie_id',v_movie_id);
end;
$$;
revoke all on function public.cineverse_import_server_movie(text,jsonb) from public, anon, authenticated;
grant execute on function public.cineverse_import_server_movie(text,jsonb) to service_role;
