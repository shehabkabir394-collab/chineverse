-- Local SSD quality variants for CineVerse movies and TV episodes.
-- Original video URLs and existing catalog rows remain untouched.
create table if not exists public.series_episode_media_assets (
 id uuid primary key default gen_random_uuid(),
 series_id uuid not null references public.movies(id) on delete cascade,
 season_number integer not null,
 episode_number integer not null,
 quality text not null check (quality in ('720p','1080p')),
 object_key text not null unique,
 public_url text not null,
 mime_type text not null default 'video/mp4',
 file_size bigint not null check (file_size > 0),
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(series_id,season_number,episode_number,quality)
);
create index if not exists series_episode_assets_lookup_idx
 on public.series_episode_media_assets(series_id,season_number,episode_number,is_active);
alter table public.series_episode_media_assets enable row level security;
drop policy if exists "Public read active assets for published series" on public.series_episode_media_assets;
create policy "Public read active assets for published series"
 on public.series_episode_media_assets for select to anon,authenticated
 using (is_active and exists(select 1 from public.movies m where m.id=series_id and m.published=true and m.media_type='series'));
revoke insert,update,delete on public.series_episode_media_assets from anon,authenticated;
grant select on public.series_episode_media_assets to anon,authenticated;
grant all on public.series_episode_media_assets to service_role;

create or replace function public.cineverse_import_server_movie_asset(
 p_tmdb_id bigint,p_quality text,p_object_key text,p_public_url text,p_mime_type text,p_file_size bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_movie_id uuid;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role required' using errcode='42501'; end if;
 if p_quality not in ('720p','1080p') or p_file_size <= 0 then raise exception 'invalid asset metadata'; end if;
 select id into v_movie_id from public.movies where tmdb_id=p_tmdb_id and media_type='movie' order by created_at desc limit 1;
 if v_movie_id is null then raise exception 'movie must be imported before adding quality assets'; end if;
 insert into public.movie_media_assets(movie_id,quality,object_key,public_url,mime_type,file_size,is_active)
 values(v_movie_id,p_quality,p_object_key,p_public_url,coalesce(p_mime_type,'video/mp4'),p_file_size,true)
 on conflict(movie_id,quality) do update set object_key=excluded.object_key,public_url=excluded.public_url,mime_type=excluded.mime_type,file_size=excluded.file_size,is_active=true;
 return jsonb_build_object('movie_id',v_movie_id,'quality',p_quality);
end $$;
revoke all on function public.cineverse_import_server_movie_asset(bigint,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.cineverse_import_server_movie_asset(bigint,text,text,text,text,bigint) to service_role;

create or replace function public.cineverse_import_server_episode_asset(
 p_tmdb_id bigint,p_season integer,p_episode integer,p_quality text,p_object_key text,p_public_url text,p_mime_type text,p_file_size bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_series_id uuid; v_episode_id uuid;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role required' using errcode='42501'; end if;
 if p_quality not in ('720p','1080p') or p_file_size <= 0 then raise exception 'invalid asset metadata'; end if;
 select id into v_series_id from public.movies where tmdb_id=p_tmdb_id and media_type='series' order by created_at desc limit 1;
 if v_series_id is null then raise exception 'series must be imported before adding quality assets'; end if;
 select id into v_episode_id from public.series_episodes where series_id=v_series_id and season_number=p_season and episode_number=p_episode;
 if v_episode_id is null then raise exception 'episode must be imported before adding quality assets'; end if;
 insert into public.series_episode_media_assets(series_id,season_number,episode_number,quality,object_key,public_url,mime_type,file_size,is_active)
 values(v_series_id,p_season,p_episode,p_quality,p_object_key,p_public_url,coalesce(p_mime_type,'video/mp4'),p_file_size,true)
 on conflict(series_id,season_number,episode_number,quality) do update set object_key=excluded.object_key,public_url=excluded.public_url,mime_type=excluded.mime_type,file_size=excluded.file_size,is_active=true;
 return jsonb_build_object('series_id',v_series_id,'episode_id',v_episode_id,'quality',p_quality);
end $$;
revoke all on function public.cineverse_import_server_episode_asset(bigint,integer,integer,text,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.cineverse_import_server_episode_asset(bigint,integer,integer,text,text,text,text,bigint) to service_role;
