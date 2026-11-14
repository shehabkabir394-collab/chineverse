(()=> {
 const $=s=>document.querySelector(s), esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])), safe=s=>/^https:\/\//i.test(s||"")?s:"";
 async function load(){
  const id=new URLSearchParams(location.search).get("id"),root=$("#seriesDetail");
  if(!id||!window.cineverseSupabase){root.textContent="Series could not be loaded.";return;}
  const db=window.cineverseSupabase;
  const [{data:s,error},{data:assets,error:assetError}]=await Promise.all([
   db.from("movies").select("id,title,release_year,genre,language,description,poster_url,backdrop_url,rating,cast_members,content_status,seasons,episodes,tags").eq("id",id).eq("media_type","series").eq("published",true).maybeSingle(),
   db.from("movie_media_assets").select("id,quality,public_url,mime_type").eq("movie_id",id).eq("is_active",true).order("quality")
  ]);
  if(error||!s){root.innerHTML="<h2>Series not found</h2><p class='muted'>This series may be unpublished.</p>";return;}
  const r2=(assets||[]).filter(x=>safe(x.public_url));
  if(assetError||!r2.length){root.innerHTML="<h2>No Cloudflare R2 video available</h2><p class='muted'>Only videos uploaded to the site's Cloudflare R2 storage are shown.</p>";return;}
  const poster=safe(s.poster_url),backdrop=safe(s.backdrop_url);
  document.title=s.title+" — Only Drama";
  const qualityButtons=r2.map((x,i)=>`<button class="btn ${i===0?"primary":"ghost"} r2-quality" data-index="${i}">${esc(x.quality||"Original")}</button>`).join("");
  root.innerHTML=`<section class="detail-hero" ${backdrop?`style="--detail-backdrop:url('${esc(backdrop)}')"`:""}><div>${poster?`<img class="detail-poster" src="${esc(poster)}" alt="${esc(s.title)} poster">`:'<div class="detail-poster poster-placeholder">OD</div>'}</div><div class="detail-copy"><p class="eyebrow">CLOUDFLARE R2 VIDEO</p><h1>${esc(s.title)}</h1><div class="detail-meta"><span>${esc(s.release_year||"Year unknown")}</span><span>${esc(s.language||"Language unknown")}</span>${s.rating!=null?`<span>★ ${esc(s.rating)}/10</span>`:""}</div><p class="detail-genres">${esc(s.genre||"")}</p><p class="description">${esc(s.description||"No synopsis available.")}</p>${s.cast_members?`<p><b>Cast</b><br>${esc(s.cast_members)}</p>`:""}</div></section><section class="video-section" id="episodePlayerSection"><div class="video-heading"><div><p class="eyebrow">YOUR CLOUDFLARE R2 VIDEO</p><h2 id="episodeNowTitle">${esc(s.title)}</h2></div></div><video id="episodePlayer" class="movie-player" controls playsinline preload="metadata" poster="${esc(poster)}"></video><div class="row r2-quality-list">${qualityButtons}</div></section>`;
  const player=$("#episodePlayer"),sources=r2.map(x=>({quality:x.quality||"Auto",url:x.public_url,mime:x.mime_type||""}));
  let api=null;
  if(window.CineVersePlayer){api=window.CineVersePlayer.mount({video:player,sources,storageKey:"od-r2-"+id});}
  else {player.src=sources[0].url;player.load();}
  root.querySelectorAll(".r2-quality").forEach(b=>b.addEventListener("click",()=>{const i=Number(b.dataset.index);if(!sources[i])return;root.querySelectorAll(".r2-quality").forEach(x=>x.classList.toggle("primary",x===b));if(api)api.setSource(sources[i],false);else{player.src=sources[i].url;player.load();}}));
 }
 load();
})();