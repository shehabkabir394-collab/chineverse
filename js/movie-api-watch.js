(() => {
 "use strict";
 const $=s=>document.querySelector(s),esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const safeImage=s=>/^https:\/\//i.test(s||"")?s:"";
 const params=new URLSearchParams(location.search),path=params.get("path")||"",root=$("#movieWatchRoot"),status=$("#movieWatchStatus");
 let episodes=[],playerApi=null,selected=-1;
 function getSources(ep){return (Array.isArray(ep.sources)?ep.sources:[]).filter(s=>{try{const u=new URL(s.url);return u.protocol==="https:"&&u.hostname==="hd-w0l1.onrender.com"&&Number(s.quality)>0;}catch{return false;}}).map(s=>({url:s.url,quality:Number(s.quality)+"p",provider:String(s.provider||"Movie API"),mime:s.type==="m3u8"?"application/vnd.apple.mpegurl":"video/mp4"}));}
 function start(index){
  const ep=episodes[index];if(!ep)return;const sources=getSources(ep),video=$("#movieWatchVideo"),message=$("#movieWatchMessage");
  if(!sources.length){message.textContent="এই Episode/Version-এর playable source পাওয়া যায়নি।";return;}
  selected=index;$("#movieWatchNow").textContent=ep.label||("Episode "+(ep.number||index+1));
  root.querySelectorAll("[data-watch-episode]").forEach((b,i)=>b.classList.toggle("active",i===index));
  message.textContent="Available quality: "+sources.map(s=>s.quality).join(" · ");
  if(!playerApi){
   video.muted=true;
   playerApi=window.CineVersePlayer?.mount({video,sources,storageKey:"msbd-"+encodeURIComponent(path)+"-"+encodeURIComponent(ep.id||index)});
   if(!playerApi){video.controls=true;video.src=sources[0].url;video.load();video.play().catch(()=>{message.textContent="Tap the video to start playback.";});}
  }else playerApi.setSources(sources);
  $("#movieWatchUnmute").hidden=false;
 }
 async function load(){
  if(!/^\/mb\/[a-zA-Z0-9_./-]{1,300}$/.test(path)){status.textContent="Invalid title link.";return;}
  try{
   const response=await fetch("/api/movie-api/details?path="+encodeURIComponent(path),{cache:"no-store"}),data=await response.json();
   if(!response.ok||!data.detail)throw new Error(data.error||"Details unavailable.");
   const d=data.detail;episodes=Array.isArray(d.episodes)?d.episodes:[];
   const poster=safeImage(d.poster),dubs=Array.isArray(d.dubs)?d.dubs:[];
   const isDrama=episodes.length>1||episodes.some(e=>/episode|season|ep\s*\d/i.test(String(e.kind||e.label||"")));
   const listTitle=isDrama?"Episodes":"Available versions";
   document.title=(d.title||"Watch")+" — MovieStream BD";
   root.innerHTML='<section class="ms-title-detail">'+(poster?'<img class="ms-title-poster" src="'+esc(poster)+'" alt="'+esc(d.title||"Poster")+'">':'')+'<div class="ms-title-copy"><p class="eyebrow">MOVIESTREAM BD · '+(isDrama?"DRAMA SERIES":"MOVIE")+'</p><h1>'+esc(d.title||"Untitled")+'</h1><p class="muted">'+esc(d.releaseDate||"")+' · '+esc(d.quality||d.resolution||"")+' · '+esc(d.language||"")+'</p><p>'+esc(d.storyline||"")+'</p><p><b>Genre:</b> '+esc(d.genre||"Not specified")+'</p><p><b>Audio:</b> '+esc(dubs.map(x=>x.label).join(", ")||d.language||"Not listed")+'</p></div></section><section class="ms-watch-player"><div class="video-heading"><div><p class="eyebrow">NOW PLAYING</p><h2 id="movieWatchNow">Loading first '+(isDrama?"episode":"version")+'…</h2></div><button class="btn ghost" id="movieWatchUnmute" type="button" hidden>🔊 Turn sound on</button></div><p id="movieWatchMessage" class="muted" aria-live="polite">Preparing video…</p><video id="movieWatchVideo" class="movie-player" controls playsinline preload="auto" '+(poster?'poster="'+esc(poster)+'"':'')+'></video></section><section class="ms-episode-section"><div class="section-head"><div><p class="eyebrow">'+(isDrama?"SEASON & EPISODE GUIDE":"PLAYBACK OPTIONS")+'</p><h2>'+listTitle+' <em>('+episodes.length+')</em></h2></div></div><div class="movie-api-episodes">'+episodes.map((ep,i)=>'<button class="movie-api-episode ms-episode-button" type="button" data-watch-episode="'+i+'"><span><b>'+esc(ep.label||((isDrama?"Episode ":"Version ")+(ep.number||i+1)))+'</b><small class="muted">'+esc(ep.kind||"")+'</small></span><span class="ms-episode-quality">'+getSources(ep).map(s=>s.quality).join(" · ")+'</span><span class="ms-episode-action">▶ '+(i===0?"Playing first":"Play")+'</span></button>').join("")||'<p class="muted">No episodes or video versions were returned.</p>'+'</div></section>';
   status.textContent="Details loaded successfully.";
   root.addEventListener("click",e=>{const b=e.target.closest("[data-watch-episode]");if(b)start(Number(b.dataset.watchEpisode));});
   $("#movieWatchUnmute").addEventListener("click",()=>{const v=$("#movieWatchVideo");v.muted=false;v.volume=1;$("#movieWatchUnmute").textContent="Sound on";});
   if(episodes.length)start(0);else status.textContent="Details loaded, but no playable episodes were found.";
  }catch(error){status.textContent=error.message||"Could not load this title.";}
 }
 load();
})();