const API="https://api.themoviedb.org/3";
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const norm=s=>(s||"").toLowerCase().normalize("NFKD").replace(/[’']/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
const img=(p,size)=>p&&p.startsWith("/")?"https://image.tmdb.org/t/p/"+size+p:null;
function parseName(filename){
 const base=filename.split("/").pop().replace(/\.[^.]+$/,"");
 const ep=base.match(/\bS(\d{1,2})E(\d{1,3})\b/i);
 let cleaned=base.replace(/[._]+/g," ");
 if(ep) cleaned=cleaned.slice(0,ep.index);
 cleaned=cleaned.replace(/\b(audiofixed|480p|720p|1080p|2160p|4k|uhd|web[ .-]?dl|webrip|bluray|brrip|hdtv|x264|x265|h264|h265|hevc|aac|dts|ddp|proper|repack)\b/ig," ").replace(/\bDDP\s*\d+(?:[ .]\d+)?\b/ig," ").replace(/\b\d+(?:[ .]\d+)?\s*(?:CH|CHANNELS?)\b/ig," ").replace(/\s+/g," ").trim();
 const yearMatch=cleaned.match(/\b(19\d{2}|20\d{2})\b/);
 const title=(yearMatch?cleaned.slice(0,yearMatch.index):cleaned).replace(/[()\[\]-]+$/g,"").trim();
 return {title,year:yearMatch?Number(yearMatch[1]):null,season:ep?Number(ep[1]):null,episode:ep?Number(ep[2]):null};
}
async function tmdb(path,headers){const r=await fetch(API+path,{headers});if(!r.ok)throw new Error("TMDB request failed: "+path);return r.json();}
function videoUrlFor(env,relative){return env.VIDEO_SERVER_BASE_URL.replace(/\/$/,"")+"/"+relative.split("/").map(encodeURIComponent).join("/");}
async function saveMovie(env,sourceKey,movie){
 const supa=env.SUPABASE_URL.replace(/\/$/,"");
 const resp=await fetch(supa+"/rest/v1/rpc/cineverse_import_server_movie",{method:"POST",headers:{"apikey":env.SUPABASE_SERVICE_ROLE_KEY,"Authorization":"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({p_source_key:sourceKey,p_movie:movie})});
 const result=await resp.json().catch(()=>null);if(!resp.ok)throw new Error("Supabase movie import failed: "+JSON.stringify(result));return result;
}
async function saveQualityAsset(env,rpc,args){
 const supa=env.SUPABASE_URL.replace(/\/$/,"");
 const resp=await fetch(supa+"/rest/v1/rpc/"+rpc,{method:"POST",headers:{"apikey":env.SUPABASE_SERVICE_ROLE_KEY,"Authorization":"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"},body:JSON.stringify(args)});
 const result=await resp.json().catch(()=>null);if(!resp.ok)throw new Error("Supabase quality asset import failed: "+JSON.stringify(result));return result;
}
async function saveEpisode(env,sourceKey,series,episode){
 const supa=env.SUPABASE_URL.replace(/\/$/,"");
 const resp=await fetch(supa+"/rest/v1/rpc/cineverse_import_server_episode",{method:"POST",headers:{"apikey":env.SUPABASE_SERVICE_ROLE_KEY,"Authorization":"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"},body:JSON.stringify({p_source_key:sourceKey,p_series:series,p_episode:episode})});
 const result=await resp.json().catch(()=>null);if(!resp.ok)throw new Error("Supabase episode import failed: "+JSON.stringify(result));return result;
}
export async function onRequestPost({request,env}){
 const secret=env.SERVER_IMPORT_SECRET;
 if(!secret||request.headers.get("authorization")!=="Bearer "+secret)return json({error:"Unauthorized"},401);
 if(!env.TMDB_API_READ_ACCESS_TOKEN||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.VIDEO_SERVER_BASE_URL)return json({error:"Server import is not configured"},503);
 let body;try{body=await request.json()}catch{return json({error:"Invalid JSON"},400)}
 const filename=String(body.filename||"").slice(0,500),relative=String(body.relative_path||"").replace(/\\/g,"/");
 if(!filename||!relative||relative.startsWith("/")||relative.split("/").some(x=>!x||x==="."||x===".."))return json({error:"Invalid file path"},400);
 if(!/\.(mp4|mkv|webm|mov|m4v)$/i.test(filename))return json({error:"Unsupported video format"},415);
 const parsed=parseName(filename);if(!parsed.title)return json({error:"Could not read title from filename"},422);
 const sourceKey=String(body.source_key||"").slice(0,128);if(!sourceKey)return json({error:"Missing source key"},400);
 const headers={Authorization:"Bearer "+env.TMDB_API_READ_ACCESS_TOKEN,accept:"application/json"};
 try{
  const isEpisode=parsed.season!==null&&parsed.episode!==null;
  const kind=isEpisode?"tv":"movie";
  const search=await tmdb("/search/"+kind+"?include_adult=false&language=en-US&page=1&query="+encodeURIComponent(parsed.title),headers);
  const results=search.results||[];
  const exact=results.filter(x=>[norm(x.title||x.name),norm(x.original_title||x.original_name)].includes(norm(parsed.title)));
  const chosen=(parsed.year?exact.find(x=>((x.release_date||x.first_air_date||"").startsWith(String(parsed.year)))):null)||exact[0];
  if(!chosen)return json({error:"No confident TMDB "+(isEpisode?"series":"movie")+" title match",parsed_title:parsed.title,parsed_year:parsed.year,season:parsed.season,episode:parsed.episode},422);
  const id=chosen.id;
  const videoUrl=videoUrlFor(env,relative);
  if(body.asset_quality!==undefined){
   const quality=String(body.asset_quality);
   const fileSize=Number(body.file_size||0);
   if(!["720p","1080p"].includes(quality)||!Number.isSafeInteger(fileSize)||fileSize<=0)return json({error:"Invalid asset_quality or file_size"},400);
   const common={p_tmdb_id:id,p_quality:quality,p_object_key:relative,p_public_url:videoUrl,p_mime_type:String(body.mime_type||"video/mp4"),p_file_size:fileSize};
   const assetResult=isEpisode
    ?await saveQualityAsset(env,"cineverse_import_server_episode_asset",{...common,p_season:parsed.season,p_episode:parsed.episode})
    :await saveQualityAsset(env,"cineverse_import_server_movie_asset",common);
   return json({ok:true,type:isEpisode?"series_episode_asset":"movie_asset",...assetResult,tmdb_id:id,quality,video_url:videoUrl});
  }
  if(isEpisode){
   const [show,credits,videos,seasonData]=await Promise.all([
    tmdb("/tv/"+id+"?language=en-US",headers),
    tmdb("/tv/"+id+"/credits?language=en-US",headers).catch(()=>({cast:[]})),
    tmdb("/tv/"+id+"/videos?language=en-US",headers).catch(()=>({results:[]})),
    tmdb("/tv/"+id+"/season/"+parsed.season+"?language=en-US",headers).catch(()=>({episodes:[]}))
   ]);
   const ep=(seasonData.episodes||[]).find(x=>Number(x.episode_number)===parsed.episode)||{};
   const trailer=(videos.results||[]).find(x=>x.site==="YouTube"&&x.type==="Trailer");
   const series={title:show.name||parsed.title,release_year:Number((show.first_air_date||"").slice(0,4))||null,genre:(show.genres||[]).map(x=>x.name).join(", "),language:(show.original_language||"").toUpperCase(),quality:"1080p",description:show.overview||"",poster_url:img(show.poster_path,"w500"),backdrop_url:img(show.backdrop_path,"w1280"),trailer_url:trailer?"https://www.youtube.com/embed/"+trailer.key:null,rating:show.vote_average||null,cast_members:(credits.cast||[]).slice(0,12).map(x=>x.name).join(", "),tmdb_id:id,media_type:"series",published:true,content_status:show.status||"Ongoing",seasons:show.number_of_seasons||null,episodes:show.number_of_episodes||null};
   const episode={season_number:parsed.season,episode_number:parsed.episode,title:ep.name||("Episode "+parsed.episode),overview:ep.overview||"",still_url:img(ep.still_path,"w500"),air_date:ep.air_date||null,runtime_minutes:ep.runtime||null,video_url:videoUrl,watch_url:videoUrl,download_url:videoUrl};
   const result=await saveEpisode(env,sourceKey,series,episode);
   return json({ok:true,type:"series_episode",...result,series_title:series.title,season:parsed.season,episode:parsed.episode,episode_title:episode.title,video_url:videoUrl});
  }
  const [m,c,v]=await Promise.all([
   tmdb("/movie/"+id+"?language=en-US",headers),
   tmdb("/movie/"+id+"/credits?language=en-US",headers).catch(()=>({cast:[]})),
   tmdb("/movie/"+id+"/videos?language=en-US",headers).catch(()=>({results:[]}))
  ]);
  const trailer=(v.results||[]).find(x=>x.site==="YouTube"&&x.type==="Trailer");
  const movie={title:m.title||parsed.title,release_year:Number((m.release_date||"").slice(0,4))||parsed.year,genre:(m.genres||[]).map(x=>x.name).join(", "),language:(m.original_language||"").toUpperCase(),quality:"1080p",description:m.overview||"",poster_url:img(m.poster_path,"w500"),backdrop_url:img(m.backdrop_path,"w1280"),trailer_url:trailer?"https://www.youtube.com/embed/"+trailer.key:null,rating:m.vote_average||null,runtime_minutes:m.runtime||null,cast_members:(c.cast||[]).slice(0,12).map(x=>x.name).join(", "),tmdb_id:id,media_type:"movie",video_url:videoUrl,watch_url:videoUrl,download_url:videoUrl,published:true,content_status:m.status||"Released"};
  const result=await saveMovie(env,sourceKey,movie);
  return json({ok:true,type:"movie",...result,title:movie.title,tmdb_id:id,video_url:videoUrl});
 }catch(e){return json({error:"Import failed",details:String(e.message||e)},502)}
}
