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

  const poster=safe(s.poster_url),backdrop=safe(s.backdrop_url),providerId=new URLSearchParams(location.search).get("imdbId")||new URLSearchParams(location.search).get("8streamId")||"",groups=new Map();
  playable.forEach(a=>{const key=a.season_number+":"+a.episode_number;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(a);});
  const seasons=new Map();
  for(const [key,variants] of groups){const [season,episode]=key.split(":").map(Number);if(!seasons.has(season))seasons.set(season,[]);seasons.get(season).push({episode,variants});}
  document.title=s.title+" — MovieStream BD";
  root.innerHTML=`<section class="detail-hero" ${backdrop?`style="--detail-backdrop:url('${esc(backdrop)}')"`:""}><div>${poster?`<img class="detail-poster" src="${esc(poster)}" alt="${esc(s.title)} poster">`:'<div class="detail-poster poster-placeholder">MS</div>'}</div><div class="detail-copy"><p class="eyebrow">CLOUDFLARE R2 VIDEO</p><h1>${esc(s.title)}</h1><div class="detail-meta"><span>${esc(s.release_year||"Year unknown")}</span><span>${esc(s.language||"Language unknown")}</span>${s.rating!=null?`<span>★ ${esc(s.rating)}/10</span>`:""}</div><p class="detail-genres">${esc(s.genre||"")}</p><p class="description">${esc(s.description||"No synopsis available.")}</p>${s.cast_members?`<p><b>Cast</b><br>${esc(s.cast_members)}</p>`:""}</div></section><section class="video-section" id="episodePlayerSection"><div class="video-heading"><div><p class="eyebrow">YOUR CLOUDFLARE R2 VIDEO</p><h2 id="episodeNowTitle">Select an episode</h2></div></div><video id="episodePlayer" class="movie-player" controls playsinline preload="metadata" poster="${esc(poster)}"></video></section>${providerId?`<section class="video-section" id="eightStreamSection"><div class="video-heading"><div><p class="eyebrow">AUTHORIZED 8STREAM PROVIDER</p><h2 id="eightStreamTitle">8Stream catalogue information</h2></div></div><p class="muted">IMDb ID: ${esc(providerId)}</p><div id="eightStreamInfo" class="muted">Loading provider information…</div><label for="eightStreamLanguage">Available audio language</label><select id="eightStreamLanguage" class="form-control"></select><button class="btn primary" id="playEightStream" type="button">▶ Play selected language</button><video id="eightStreamPlayer" class="movie-player" controls playsinline preload="none" poster="${esc(poster)}"></video><p class="muted" id="eightStreamStatus">Loading 8Stream data…</p></section>`:`<section class="video-section"><p class="muted">8Stream source: add <code>&amp;imdbId=tt1234567</code> to this series URL to load provider data.</p></section>`}<section class="episode-browser"><div class="video-heading"><div><p class="eyebrow">FULL EPISODE GUIDE</p><h2>Seasons & Episodes</h2></div><span class="watch-quality">${playable.length} video files</span></div>${[...seasons.entries()].sort((a,b)=>a[0]-b[0]).map(([season,episodes])=>`<section class="episode-season"><h2>Season ${season}</h2><div class="episode-list">${episodes.sort((a,b)=>a.episode-b.episode).map(({episode,variants})=>`<article class="episode-card"><div class="episode-thumb">▶</div><div class="episode-copy"><b>Episode ${episode}</b><p>${variants.map(v=>esc(v.quality)).join(" · ")}</p></div><div class="episode-actions"><button class="btn primary play-r2-episode" data-key="${season}:${episode}">▶ Watch</button></div></article>`).join("")}</div></section>`).join("")}</section>`;
  if(providerId){
   const provider=window.OnlyDramaProviders&&window.OnlyDramaProviders.eightStream;
   const streamPlayer=$("#eightStreamPlayer"),status=$("#eightStreamStatus"),playButton=$("#playEightStream");
   const info=$("#eightStreamInfo"),languageSelect=$("#eightStreamLanguage");
   let providerMedia=null;
   const escText=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
   (async()=>{
    if(!provider||!provider.isAvailable()){status.textContent="8Stream provider is unavailable.";return;}
    try{
     const [media,seasons]=await Promise.all([provider.getMediaInfo(providerId),provider.getSeasonList(providerId)]);
     if(!media.success)throw new Error(media.message||media.error||"Could not load media information.");
     providerMedia=media.data;
     const tracks=Array.isArray(providerMedia.playlist)?providerMedia.playlist:[];
     languageSelect.innerHTML=tracks.map((track,index)=>'<option value="'+index+'">'+escText(track.title||"Unknown language")+'</option>').join("");
     const seasonData=seasons.success&&seasons.data?seasons.data:null;
     const seasonMarkup=seasonData&&Array.isArray(seasonData.seasons)?seasonData.seasons.map(item=>'<li>'+escText(item.season||"Season")+' — '+escText(item.totalEpisodes??"Unknown")+' episodes; languages: '+escText((item.lang||[]).join(", "))+'</li>').join(""):"<li>Season information is not available for this title.</li>";
     info.innerHTML='<p><b>Available audio tracks:</b> '+tracks.length+'</p><ul>'+tracks.map(track=>'<li>'+escText(track.title||"Unknown language")+'</li>').join("")+'</ul><p><b>Seasons & episodes</b></p><ul>'+seasonMarkup+'</ul><p class="muted">Only fields returned by the provider are displayed.</p>';
     const preferred=tracks.findIndex(track=>provider.normalizeLanguage(track.title)==="hindi");
     if(preferred>=0)languageSelect.value=String(preferred);
     status.textContent=tracks.length?"Provider data loaded. Choose a language and play.":"No audio tracks were returned.";
     playButton.disabled=!tracks.length;
    }catch(error){info.textContent="Could not load 8Stream data.";status.textContent="8Stream error: "+error.message;playButton.disabled=true;}
   })();
   playButton.addEventListener("click",async()=>{
    if(!providerMedia)return;
    const track=providerMedia.playlist[Number(languageSelect.value)];
    if(!track||!track.file||!providerMedia.key){status.textContent="The selected track is missing stream parameters.";return;}
    playButton.disabled=true;status.textContent="Requesting selected 8Stream track…";
    try{
     const result=await provider.getStream(track.file,providerMedia.key);
     if(!result.success||!result.data||!result.data.link)throw new Error(result.message||result.error||"No playable stream returned.");
     streamPlayer.src=result.data.link;streamPlayer.load();await streamPlayer.play();
     $("#eightStreamTitle").textContent="8Stream · "+(track.title||"Selected audio");
     status.textContent="Stream loaded.";
    }catch(error){status.textContent="8Stream playback failed: "+error.message;}
    finally{playButton.disabled=false;}
   });
  }
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