(()=> {
 const BRIDGE="https://coordinate-winston-acer-controller.trycloudflare.com";
 const $=s=>document.querySelector(s),esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const params=new URLSearchParams(location.search),path=params.get("path")||"",title=params.get("title")||"Drama",tmdb=params.get("tmdb")||"";
 const listOf=d=>Array.isArray(d)?d:(d.items||d.entries||d.files||d.results||d.children||[]);
 const nm=x=>x.name||x.filename||x.title||x.label||"";
 const pth=(x,base)=>x.path||x.full_path||x.href||base.replace(/\/$/,"")+"/"+nm(x);
 const dir=x=>x.is_dir===true||x.is_directory===true||x.directory===true||x.type==="directory"||x.type==="dir"||x.kind==="directory"||x.is_dir==="true";
 const vid=x=>/\.(mkv|mp4|m4v|webm|avi|mov)$/i.test(nm(x));
 const root=$("#ftpSeriesDetail");let playerApi=null;
 async function apiList(p){const r=await fetch(BRIDGE+"/api/list?path="+encodeURIComponent(p),{cache:"no-store"});if(!r.ok)throw Error("FTP HTTP "+r.status);return listOf(await r.json())}
 async function load(){
  if(!path){root.textContent="Drama path missing.";return}
  try{
   const [meta,items]=await Promise.all([
    tmdb?fetch("/api/tmdb-tv-search?id="+encodeURIComponent(tmdb)).then(r=>r.ok?r.json():null).catch(()=>null):fetch("/api/tmdb-tv-search?q="+encodeURIComponent(title)).then(r=>r.ok?r.json():null).catch(()=>null),
    apiList(path)
   ]);
   const m=meta?.match||meta||{},poster=m.poster||"",backdrop=m.backdrop||"";
   document.title=(m.title||title)+" — Only Drama";
   const folders=items.filter(dir).sort((a,b)=>nm(a).localeCompare(nm(b),undefined,{numeric:true}));
   const files=items.filter(vid).sort((a,b)=>nm(a).localeCompare(nm(b),undefined,{numeric:true}));
   root.innerHTML='<section class="detail-hero" '+(backdrop?'style="--detail-backdrop:url(\''+esc(backdrop)+'\')"':'')+'><div>'+(poster?'<img class="detail-poster" src="'+esc(poster)+'" alt="'+esc(m.title||title)+' poster">':'<div class="detail-poster poster-placeholder ftp-auto-poster"><b>OD</b><strong>'+esc(m.title||title)+'</strong><small>ONLY DRAMA</small></div>')+'</div><div class="detail-copy"><p class="eyebrow">ONLY DRAMA · FTP STREAMING</p><h1>'+esc(m.title||title)+'</h1><div class="detail-meta"><span>'+esc(m.year||"Year unknown")+'</span>'+(m.rating!=null?'<span>★ '+esc(m.rating)+'/10</span>':'')+'</div><p class="detail-genres">'+esc((m.genres||[]).join(" · ")||"Drama")+'</p><p class="description">'+esc(m.overview||"Drama details from TMDB are not available yet.")+'</p><p class="tiny muted">Video streams directly from your connected FTP bridge.</p></div></section><section class="episode-browser"><div class="video-heading"><div><p class="eyebrow">FULL EPISODE GUIDE</p><h2>Seasons & Episodes</h2></div><span class="watch-quality">'+folders.length+' season folder(s)</span></div><div id="ftpSeasonList" class="ftp-episode-list"></div><div id="ftpEpisodeList"></div></section><section class="video-section" id="ftpEpisodePlayerSection" hidden><div class="video-heading"><div><p class="eyebrow">NOW PLAYING</p><h2 id="ftpEpisodeNow">Select an episode</h2></div></div><video id="ftpEpisodePlayer" class="movie-player" controls playsinline preload="metadata" poster="'+esc(poster)+'"></video><p id="ftpEpisodeNote" class="tiny muted">Select an episode to start watching. Some MKV audio codecs may need AAC conversion for browser sound.</p></section>';
   const seasonHost=$("#ftpSeasonList"),episodeHost=$("#ftpEpisodeList");
   async function showSeason(folder){
    const p=pth(folder,path);episodeHost.innerHTML='<p class="muted">Loading episodes…</p>';
    try{
     const children=await apiList(p),subdirs=children.filter(dir),videos=children.filter(vid);
     let html="";
     if(subdirs.length){html+='<div class="ftp-episode-list">'+subdirs.map(s=>'<article class="ftp-episode-row"><div><b>'+esc(nm(s))+'</b><small>Episode folder</small></div><button class="btn primary" data-sub="'+esc(pth(s,p))+'">Open</button></article>').join("")+'</div>';}
     if(videos.length){html+='<div class="ftp-episode-heading"><p class="eyebrow">EPISODES</p><h2>'+esc(nm(folder))+'</h2></div><div class="ftp-episode-list">'+videos.map((v,i)=>'<article class="ftp-episode-row"><div><b>'+esc(nm(v))+'</b><small>Episode '+(i+1)+'</small></div><button class="btn primary" data-play="'+esc(pth(v,p))+'" data-name="'+esc(nm(v))+'">▶ Watch</button></article>').join("")+'</div>';}
     episodeHost.innerHTML=html||'<p class="muted">এই season-এ কোনো episode পাওয়া যায়নি।</p>';
     episodeHost.querySelectorAll("[data-sub]").forEach(b=>b.onclick=()=>showSeason({name:b.closest(".ftp-episode-row").querySelector("b").textContent,path:b.dataset.sub}));
     episodeHost.querySelectorAll("[data-play]").forEach(b=>b.onclick=()=>play(b.dataset.play,b.dataset.name));
    }catch(e){episodeHost.textContent="Episode load failed: "+e.message}
   }
   seasonHost.innerHTML=folders.map((f,i)=>'<article class="ftp-episode-row"><div><b>'+esc(nm(f))+'</b><small>Season '+(i+1)+'</small></div><button class="btn primary" data-season="'+i+'">View Episodes</button></article>').join("");
   seasonHost.querySelectorAll("[data-season]").forEach(b=>b.onclick=()=>showSeason(folders[Number(b.dataset.season)]));
   if(!folders.length&&files.length)await showSeason({name:"Episodes",path:path});
   if(!folders.length&&!files.length)episodeHost.textContent="No season or episode files found.";
  }catch(e){root.innerHTML='<p class="muted">Drama load failed: '+esc(e.message)+'. Laptop Bridge ও Cloudflare Tunnel চালু আছে কি না দেখো।</p>'}
 }
 function play(p,name){
  const v=$("#ftpEpisodePlayer"),section=$("#ftpEpisodePlayerSection");
  section.hidden=false;
  $("#ftpEpisodeNow").textContent=name;const source={quality:"1080p",url:BRIDGE+"/play?path="+encodeURIComponent(p),mime:"video/mp4"};
  $("#ftpEpisodeNote").textContent="ভিডিও চালু হচ্ছে। ব্রাউজারে MKV বা E-AC-3 অডিও সমর্থিত না হলে শব্দ নাও আসতে পারে।";
  section.scrollIntoView({behavior:"smooth",block:"start"});
  if(window.CineVersePlayer){if(!playerApi)playerApi=window.CineVersePlayer.mount({video:v,sources:[source],storageKey:"od-ftp-"+encodeURIComponent(path)+"-"+encodeURIComponent(p)});else playerApi.setSources([source]);}
  else{v.src=source.url;v.load();}v.play().catch(()=>{$("#ftpEpisodeNote").textContent="Play চাপুন। শব্দ না এলে AAC অডিও সংস্করণ প্রয়োজন হতে পারে।"});
 }
 load();
})();