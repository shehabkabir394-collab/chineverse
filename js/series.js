(()=> {
 const $=s=>document.querySelector(s), esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])), safe=s=>/^https:\/\//i.test(s||"")?s:"";
 async function load(){
  const id=new URLSearchParams(location.search).get("id"),root=$("#seriesDetail");
  if(!id||!window.cineverseSupabase){root.textContent="Series could not be loaded.";return;}
  const db=window.cineverseSupabase;
  const [{data:s,error},{data:assets,error:assetError}]=await Promise.all([
   db.from("movies").select("id,title,release_year,genre,language,description,poster_url,backdrop_url,rating,cast_members,content_status,seasons,episodes,tags").eq("id",id).eq("media_type","series").eq("published",true).maybeSingle(),
   db.from("series_episode_media_assets").select("id,series_id,season_number,episode_number,quality,public_url,mime_type").eq("series_id",id).eq("is_active",true).order("season_number").order("episode_number").order("quality")
  ]);
  if(error||!s){root.innerHTML="<h2>Series not found</h2><p class='muted'>This series may be unpublished.</p>";return;}
  if(assetError){root.innerHTML="<h2>Could not load video list</h2><p class='muted'>"+esc(assetError.message)+"</p>";return;}
  const playable=(assets||[]).filter(x=>safe(x.public_url));
  if(!playable.length){root.innerHTML="<h2>No Cloudflare R2 episode videos available</h2><p class='muted'>This series has no active episode uploads yet.</p>";return;}
  const poster=safe(s.poster_url),backdrop=safe(s.backdrop_url),groups=new Map();
  playable.forEach(a=>{const key=a.season_number+":"+a.episode_number;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a);});
  const seasons=new Map();
  for(const [key,variants] of groups){const [season,episode]=key.split(":").map(Number);if(!seasons.has(season))seasons.set(season,[]);seasons.get(season).push({episode,variants});}
  document.title=s.title+" — Only Drama";
  root.innerHTML=`<section class="detail-hero" ${backdrop?`style="--detail-backdrop:url('${esc(backdrop)}')"`:""}><div>${poster?`<img class="detail-poster" src="${esc(poster)}" alt="${esc(s.title)} poster">`:'<div class="detail-poster poster-placeholder">OD</div>'}</div><div class="detail-copy"><p class="eyebrow">CLOUDFLARE R2 VIDEO</p><h1>${esc(s.title)}</h1><div class="detail-meta"><span>${esc(s.release_year||"Year unknown")}</span><span>${esc(s.language||"Language unknown")}</span>${s.rating!=null?`<span>★ ${esc(s.rating)}/10</span>`:""}</div><p class="detail-genres">${esc(s.genre||"")}</p><p class="description">${esc(s.description||"No synopsis available.")}</p>${s.cast_members?`<p><b>Cast</b><br>${esc(s.cast_members)}</p>`:""}</div></section><section class="video-section" id="episodePlayerSection"><div class="video-heading"><div><p class="eyebrow">YOUR CLOUDFLARE R2 VIDEO</p><h2 id="episodeNowTitle">Select an episode</h2></div></div><video id="episodePlayer" class="movie-player" controls playsinline preload="metadata" poster="${esc(poster)}"></video></section><section class="episode-browser"><div class="video-heading"><div><p class="eyebrow">FULL EPISODE GUIDE</p><h2>Seasons & Episodes</h2></div><span class="watch-quality">${playable.length} video files</span></div>${[...seasons.entries()].sort((a,b)=>a[0]-b[0]).map(([season,episodes])=>`<section class="episode-season"><h2>Season ${season}</h2><div class="episode-list">${episodes.sort((a,b)=>a.episode-b.episode).map(({episode,variants})=>`<article class="episode-card"><div class="episode-thumb">▶</div><div class="episode-copy"><b>Episode ${episode}</b><p>${variants.map(v=>esc(v.quality)).join(" · ")}</p></div><div class="episode-actions"><button class="btn primary play-r2-episode" data-key="${season}:${episode}">▶ Watch</button></div></article>`).join("")}</div></section>`).join("")}</section>`;
  const player=$("#episodePlayer");
  const episodeSources=new Map([...groups.entries()].map(([key,variants])=>[key,variants.map(v=>({quality:v.quality,url:v.public_url,mime:v.mime_type||"video/mp4"}))]));
  let playerApi=null;
  root.querySelectorAll(".play-r2-episode").forEach(btn=>btn.addEventListener("click",()=>{
   const key=btn.dataset.key,sources=episodeSources.get(key)||[];
   if(!sources.length)return;
   const preferred=sources.find(x=>x.quality==="1080p")||sources[0];
   $("#episodeNowTitle").textContent="Season "+key.split(":")[0]+" · Episode "+key.split(":")[1];
   $("#episodePlayerSection").scrollIntoView({behavior:"smooth",block:"start"});
   if(window.CineVersePlayer){if(!playerApi)playerApi=window.CineVersePlayer.mount({video:player,sources,storageKey:"od-r2-"+id+"-"+key});else{playerApi.setSources(sources);playerApi.setSource(preferred,false);}}
   else{player.src=preferred.url;player.load();}
   player.play().catch(()=>{});
  }));
 }
 load();
})();