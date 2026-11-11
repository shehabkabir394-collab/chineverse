-- Additive CineVerse TV-series episode support. Existing movies and RLS policies are preserved.
create table if not exists public.series_episodes (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.movies(id) on delete cascade,
  season_number integer not null check (season_number >= 0),
  episode_number integer not null check (episode_number >= 0),
  title text not null default '',
  overview text not null default '',
  still_url text,
  air_date date,
  runtime_minutes integer,
  video_url text,
  watch_url text,
  download_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(series_id, season_number, episode_number)
);
alter table public.series_episodes enable row level security;
revoke all on public.series_episodes from anon, authenticated;
grant select on public.series_episodes to anon, authenticated;
grant all on public.series_episodes to service_role;
drop policy if exists "Published series episodes are readable" on public.series_episodes;
create policy "Published series episodes are readable" on public.series_episodes
for select to anon, authenticated using (
  exists (select 1 from public.movies m where m.id=series_id and m.published=true and m.media_type='series')
);

create or replace function public.cineverse_import_server_episode(
  p_source_key text, p_series jsonb, p_episode jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_series_id uuid;
  v_episode_id uuid;
  v_duplicate boolean := false;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'service_role required' using errcode='42501';
  end if;
  if p_source_key is null or length(p_source_key)<16 or length(p_source_key)>128 then
    raise exception 'invalid source key';
  end if;
  if exists(select 1 from public.server_media_imports where source_key=p_source_key) then
    select movie_id into v_series_id from public.server_media_imports where source_key=p_source_key;
    return jsonb_build_object('duplicate',true,'series_id',v_series_id);
  end if;
  select id into v_series_id from public.movies
    where tmdb_id=nullif(p_series->>'tmdb_id','')::bigint and media_type='series'
    order by created_at desc limit 1;
  if v_series_id is null then
    insert into public.movies (
      title,release_year,genre,language,quality,description,poster_url,trailer_url,
      published,tmdb_id,media_type,rating,backdrop_url,cast_members,content_status,seasons,episodes
    ) values (
      left(coalesce(p_series->>'title','Untitled Series'),180),
      nullif(p_series->>'release_year','')::integer,
      coalesce(p_series->>'genre',''),coalesce(p_series->>'language',''),'1080p',
      coalesce(p_series->>'description',''),p_series->>'poster_url',p_series->>'trailer_url',
      true,nullif(p_series->>'tmdb_id','')::bigint,'series',
      nullif(p_series->>'rating','')::numeric,p_series->>'backdrop_url',
      coalesce(p_series->>'cast_members',''),coalesce(p_series->>'content_status','Ongoing'),
      nullif(p_series->>'seasons','')::integer,nullif(p_series->>'episodes','')::integer
    ) returning id into v_series_id;
  else
    update public.movies set
      title=left(coalesce(p_series->>'title',title),180),
      release_year=coalesce(nullif(p_series->>'release_year','')::integer,release_year),
      genre=coalesce(nullif(p_series->>'genre',''),genre),
      language=coalesce(nullif(p_series->>'language',''),language),
      description=coalesce(nullif(p_series->>'description',''),description),
      poster_url=coalesce(nullif(p_series->>'poster_url',''),poster_url),
      backdrop_url=coalesce(nullif(p_series->>'backdrop_url',''),backdrop_url),
      trailer_url=coalesce(nullif(p_series->>'trailer_url',''),trailer_url),
      cast_members=coalesce(nullif(p_series->>'cast_members',''),cast_members),
      rating=coalesce(nullif(p_series->>'rating','')::numeric,rating),
      seasons=coalesce(nullif(p_series->>'seasons','')::integer,seasons),
      episodes=coalesce(nullif(p_series->>'episodes','')::integer,episodes),
      published=true
    where id=v_series_id;
  end if;
  insert into public.series_episodes (
    series_id,season_number,episode_number,title,overview,still_url,air_date,runtime_minutes,
    video_url,watch_url,download_url
  ) values (
    v_series_id,(p_episode->>'season_number')::integer,(p_episode->>'episode_number')::integer,
    coalesce(p_episode->>'title',''),coalesce(p_episode->>'overview',''),
    p_episode->>'still_url',nullif(p_episode->>'air_date','')::date,
    nullif(p_episode->>'runtime_minutes','')::integer,
    p_episode->>'video_url',p_episode->>'watch_url',p_episode->>'download_url'
  )
  on conflict(series_id,season_number,episode_number) do update set
    title=excluded.title,overview=excluded.overview,still_url=excluded.still_url,
    air_date=excluded.air_date,runtime_minutes=excluded.runtime_minutes,
    video_url=excluded.video_url,watch_url=excluded.watch_url,download_url=excluded.download_url,
    updated_at=now()
  returning id into v_episode_id;
  insert into public.server_media_imports(source_key,movie_id) values(p_source_key,v_series_id);
  return jsonb_build_object('duplicate',v_duplicate,'series_id',v_series_id,'episode_id',v_episode_id);
end;
$$;
revoke all on function public.cineverse_import_server_episode(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.cineverse_import_server_episode(text,jsonb,jsonb) to service_role;
