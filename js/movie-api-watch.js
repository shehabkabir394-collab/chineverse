(() => {
 "use strict";
 const $=s=>document.querySelector(s),esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const safeImage=s=>/^https:\/\//i.test(s||"")?s:"";
 const params=new URLSearchParams(location.search),path=params.get("path")||"",root=$("#movieWatchRoot"),status=$("#movieWatchStatus");
 let episodes=[],playerApi=null,selected=-1,currentSources=[],currentDubs=[],watchDetail=null,streamRequest=0,currentSubtitles=[];
 const getLang=o=>String(o?.audioLanguage||o?.dubLanguage||o?.language||o?.lang||o?.audio||o?.label||o?.name||"").trim();
 const isHindi=s=>/^(hi|hin|hindi)([-_ ]|$)/i.test(String(s||"").trim())||/hindi|हिन्दी|हिंदी/i.test(String(s||""));
 const isHindiDubbed=item=>item?._hindiCatalog===true||[item?.language,item?.audioLanguage,item?.audioLanguages,item?.dubLanguage,item?.dubLanguages,item?.availableLanguages,item?.languages,item?.audio].some(v=>Array.isArray(v)?v.some(x=>isHindi(getLang(x)||x?.code)):isHindi(v));
 function getSources(ep){
  return (Array.isArray(ep.sources)?ep.sources:[]).filter(s=>{try{const u=new URL(s.url);return u.protocol==="https:"&&u.hostname==="hd-w0l1.onrender.com"&&Number(s.quality)>0;}catch{return false;}})
   .map(s=>({url:s.url,quality:Number(s.quality)+"p",provider:String(s.provider||"Movie API"),mime:s.type==="m3u8"?"application/vnd.apple.mpegurl":"video/mp4",audioLanguage:getLang(s)}))
   .sort((a,b)=>Number(isHindi(b.audioLanguage))-Number(isHindi(a.audioLanguage)));
 }
 function sourcesForLanguage(sources,language){
  const chosen=String(language||"").trim();
  const matched=chosen&&chosen!=="auto"?sources.filter(s=>String(s.audioLanguage||"").trim()===chosen):[];
  return matched.length?matched:sources;
 }
 function getSubtitles(...objects){
  const found=[],seen=new Set();
  const add=value=>{if(!value)return;const list=Array.isArray(value)?value:[value];list.forEach((item,i)=>{
   if(typeof item==="string"){if(/^https?:\/\//i.test(item)&&/\.(?:vtt|srt|ass|ssa)(?:$|[?#])/i.test(item))push({url:item,label:"Subtitle "+(i+1),language:"und"});return;}
   if(!item||typeof item!=="object")return;
   const url=item.url||item.src||item.file||item.subtitleUrl||item.subtitle_url||item.captionUrl||item.caption_url||item.downloadUrl||item.download_url||item.webvtt||item.vtt||item.link;
   if(!url)return;push({url,label:String(item.label||item.name||item.language||item.lang||item.title||("Subtitle "+(i+1))),language:String(item.language||item.lang||item.srclang||item.locale||"und")});
  });};
  const push=x=>{let absolute;try{absolute=new URL(x.url,location.origin).href;if(new URL(absolute).protocol!=="https:"&&location.protocol==="https:")return;}catch{return;}if(seen.has(absolute))return;seen.add(absolute);found.push({...x,url:absolute});};
  const keys=["subtitles","subtitle","subtitleList","subtitle_list","subtitleTracks","subtitle_tracks","captions","caption","captionList","caption_tracks","tracks"];
  objects.forEach(o=>{if(!o||typeof o!=="object")return;keys.forEach(k=>add(o[k]));["stream","data","result","detail","episode"].forEach(k=>{const nested=o[k];if(nested&&typeof nested==="object")keys.forEach(key=>add(nested[key]));});});
  return found;
 }
 function audioOptions(sources){
  const langs=[...new Set(sources.map(s=>s.audioLanguage).filter(Boolean))];
  if(!langs.length)return "";
  langs.sort((a,b)=>Number(isHindi(b))-Number(isHindi(a)));
  const preferred=langs.find(isHindi)||langs[0];
  return '<label class="ms-audio-choice">Audio Track <select id="movieWatchAudio">'+langs.map(l=>'<option value="'+esc(l)+'" '+(l===preferred?"selected":"")+'>'+esc(l)+'</option>').join("")+'</select></label>';
 }
 async function start(index){
  const ep=episodes[index];if(!ep)return;
  const video=$("#movieWatchVideo"),message=$("#movieWatchMessage");
  selected=index;const requestId=++streamRequest;
  message.textContent="Loading available stream sources…";
  let sources=getSources(ep);
  const detail=watchDetail||{};
  currentSubtitles=getSubtitles(ep,detail);
  const season=Number(ep.seasonNumber??ep.season??0)||0;
  const episodeNumber=Number(ep.number??ep.episodeNumber??(index+1))||index+1;
  try{
   const query=new URLSearchParams({title:String(detail.title||""),se:String(season),ep:String(episodeNumber)});
   if(!detail.title&&(detail.subjectId||detail.id))query.set("subjectId",String(detail.subjectId||detail.id));
   const response=await fetch("/api/movie-api/stream?"+query.toString(),{cache:"no-store"});
   const payload=await response.json();
   if(requestId!==streamRequest)return;
   const streamRoot=payload.stream||payload.data||payload.result||payload;
   const streamItems=Array.isArray(streamRoot.sources)?streamRoot.sources:Array.isArray(streamRoot.streams)?streamRoot.streams:Array.isArray(streamRoot.urls)?streamRoot.urls:[];
   currentSubtitles=getSubtitles(streamRoot,payload,ep,detail);
   const normalized=streamItems.map(s=>({url:s.url||s.playUrl||s.src||s.file,quality:s.quality||s.resolution||s.label||"720p",provider:s.provider||s.name||"Movie API",type:s.type||s.format||"",audioLanguage:getLang(s)})).filter(s=>{try{const u=new URL(s.url);return u.protocol==="https:"&&u.hostname==="hd-w0l1.onrender.com";}catch{return false;}});
   if(normalized.length)sources=normalized.map(s=>({url:s.url,quality:/^\\d+$/.test(String(s.quality))?String(s.quality)+"p":String(s.quality),provider:s.provider,mime:/m3u8|hls/i.test(s.type)?"application/vnd.apple.mpegurl":"video/mp4",audioLanguage:s.audioLanguage}));
  }catch(err){console.warn("Stream endpoint unavailable; using detail sources",err);}
  if(requestId!==streamRequest)return;
  if(!sources.length){message.textContent="No playable source is available for this episode or version.";return;}
  if(!currentSubtitles.length)currentSubtitles=getSubtitles(ep,detail);
  currentSources=sources;
  const downloadLink=$("#movieWatchDownload");if(downloadLink)downloadLink.href="download.html?path="+encodeURIComponent(path)+"&episode="+index;
  $("#movieWatchNow").textContent=ep.label||("Episode "+(ep.number||index+1));
  root.querySelectorAll("[data-watch-episode]").forEach((b,i)=>b.classList.toggle("active",i===index));
  const languageOptions=audioOptions(sources),audioBox=$("#movieWatchAudioBox");
  if(audioBox)audioBox.innerHTML=languageOptions||'<span class="muted">Hindi audio is preferred when available; otherwise other available audio is used.</span>';
  message.textContent="Available quality: "+sources.map(s=>s.quality).join(" · ")+(sources.some(s=>isHindi(s.audioLanguage))?" · Hindi audio available":"");
  const selectedLang=sources.find(s=>isHindi(s.audioLanguage))?.audioLanguage||sources.find(s=>s.audioLanguage)?.audioLanguage||"auto";
  const activeSources=sourcesForLanguage(sources,selectedLang);
  if(!playerApi){
   playerApi=window.CineVersePlayer?.mount({video,sources:activeSources,subtitles:currentSubtitles,storageKey:"msbd-"+encodeURIComponent(path)+"-"+encodeURIComponent(ep.id||index),title:document.querySelector("#movieWatchRoot .ms-title-copy h1")?.textContent||"Now Playing",backUrl:"./"});
   const audioSelect=$("#movieWatchAudio");if(audioSelect&&playerApi?.wrap){const audioLabel=audioSelect.closest("label")||audioSelect;audioLabel.classList.add("cv-audio-choice");playerApi.wrap.querySelector(".cv-top-right")?.appendChild(audioLabel);}
   if(!playerApi){video.controls=true;video.src=activeSources[0].url;video.load();video.play().catch(()=>{message.textContent="Tap the video to start playback.";});}
  }else playerApi.setSources(activeSources);
  playerApi?.setSubtitles?.(currentSubtitles);
  const audioSelect=$("#movieWatchAudio");if(audioSelect&&playerApi?.wrap){const audioLabel=audioSelect.closest("label")||audioSelect;audioLabel.classList.add("cv-audio-choice");playerApi.wrap.querySelector(".cv-top-right")?.appendChild(audioLabel);}
  if(audioSelect)audioSelect.addEventListener("change",()=>{const chosen=sourcesForLanguage(currentSources,audioSelect.value);playerApi?.setSources(chosen);});
  $("#movieWatchUnmute").hidden=false;
 }
 const clean=s=>String(s||"").toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
 function suggestedGroup(item){
  const sections=(item?._sections||[]).map(clean),type=clean(item?.typeBadge||item?.type),country=clean(item?.country);
  if(sections.some(s=>s.includes("k drama")||s.includes("k-drama")))return ["kdrama","K-Drama"];
  if(sections.some(s=>s.includes("c drama")||s.includes("c-drama")))return ["cdrama","C-Drama"];
  if(sections.some(s=>s.includes("south indian")||s.includes("south movie")))return ["south","South Indian Movies"];
  if(sections.some(s=>s.includes("bollywood")))return ["bollywood","Bollywood"];
  if(sections.some(s=>s.includes("hollywood")))return ["hollywood","Hollywood"];
  if(["united states","usa","us","united kingdom","uk","britain","american","british"].includes(country))return ["hollywood","Hollywood"];
  if(type==="anime"||sections.some(s=>s.includes("anime")))return ["anime","Anime"];
  if(type==="series"||type==="drama"||sections.some(s=>s.includes("drama")||s.includes("series")))return ["drama","Drama"];
  if(type==="movie")return ["movie","Movies"];
  return ["","More titles"];
 }
 async function loadSuggested(detail){
  const box=$("#movieWatchSuggested"),grid=$("#movieWatchSuggestedGrid"),title=$("#movieWatchSuggestedTitle");
  try{
   const relatedResponse=await fetch("/api/movie-api/related?title="+encodeURIComponent(detail.title||""));
   const relatedPayload=await relatedResponse.json();
   const relatedItems=Array.isArray(relatedPayload.items)?relatedPayload.items:Array.isArray(relatedPayload.related)?relatedPayload.related:Array.isArray(relatedPayload.results)?relatedPayload.results:[];
   const usable=relatedItems.filter(x=>x&&typeof x==="object"&&String(x.path||"").startsWith("/mb/")&&x.path!==path&&isHindiDubbed(x)).slice(0,12);
   if(usable.length){
    title.textContent="Related to "+(detail.title||"this title");
    grid.innerHTML=usable.map(x=>'<a class="ms-suggested-card" href="watch.html?path='+encodeURIComponent(x.path)+'"><img loading="lazy" decoding="async" src="'+esc(safeImage(x.poster||x.previewImage))+'" alt="'+esc(x.title||"")+'"><span><b>'+esc(x.title||"Untitled")+'</b><small>'+esc(x.language||x.typeBadge||"")+'</small></span></a>').join("");
    box.hidden=false;return;
   }
  }catch{}
  const response=await fetch("/api/movie-api/home");if(!response.ok)throw new Error("Catalog API unavailable");
  const api=await response.json();if(!api.ok)return;
  const map=new Map();
  const add=(x,section)=>{if(!x||typeof x!=="object")return;const p=String(x.path||"");if(!p.startsWith("/mb/"))return;const k=p;if(!map.has(k))map.set(k,{...x,_sections:[]});if(section&&!map.get(k)._sections.includes(section))map.get(k)._sections.push(section);};
  ["sections","allOfficialSections"].forEach(key=>(api[key]||[]).forEach(s=>(s.items||[]).forEach(x=>add(x,s.title))));
  ["trending","comingSoon","banners"].forEach(key=>(api[key]||[]).forEach(x=>add(x,key)));
  const current=[...map.values()].find(x=>x.path===path);
  const synthetic={...detail,_sections:current?current._sections:[]};
  let [group,label]=suggestedGroup(synthetic);
  if(!group&&current){
   const best=current._sections.find(s=>!/(trending|coming soon|featured)/i.test(s));
   if(best){group="section";label=best;}
  }
  let list=[...map.values()].filter(x=>x.path!==path&&isHindiDubbed(x));
  if(group==="section")list=list.filter(x=>x._sections.includes(label));
  else if(group)list=list.filter(x=>suggestedGroup(x)[0]===group);
  if(!list.length&&current?._sections?.length)list=[...map.values()].filter(x=>x.path!==path&&isHindiDubbed(x)&&x._sections.some(s=>current._sections.includes(s)));
  const hindi=x=>/hindi dubbed/i.test(String(x.language||""))||(/hindi/i.test(String(x.language||""))&&(x._sections||[]).some(s=>/south indian.*hindi dubbed|anime in hindi/i.test(s)));
  list.sort((a,b)=>Number(hindi(b))-Number(hindi(a))||(Number(b.uploadedAtMs)||0)-(Number(a.uploadedAtMs)||0));
  list=list.slice(0,12);if(!list.length)return;
  title.textContent="More "+label;
  grid.innerHTML=list.map(x=>'<a class="ms-suggested-card" href="watch.html?path='+encodeURIComponent(x.path)+'"><img loading="lazy" decoding="async" src="'+esc(safeImage(x.poster||x.previewImage))+'" alt="'+esc(x.title||"")+'"><span><b>'+esc(x.title||"Untitled")+'</b><small>'+esc(x.language||x.typeBadge||"")+'</small></span></a>').join("");
  box.hidden=false;
 }
 async function load(){
  if(!/^\/mb\/[a-zA-Z0-9_./-]{1,300}$/.test(path)){status.textContent="Invalid title link.";return;}
  try{
   const response=await fetch("/api/movie-api/details?path="+encodeURIComponent(path),{cache:"no-store"}),data=await response.json();
   if(!response.ok||!data.detail)throw new Error(data.error||"Details unavailable.");
   const d=data.detail;watchDetail=d;episodes=Array.isArray(d.episodes)?d.episodes:[];currentDubs=Array.isArray(d.dubs)?d.dubs:[];
   const poster=safeImage(d.poster),typeHint=[d.type,d.mediaType,d.typeBadge,d.category,d.categoryPath].join(" ").toLowerCase();
   const isDrama=/series|tv|drama|show|serial|web\s*series/.test(typeHint)||episodes.some(e=>/episode|season|ep\s*\d|s\d+\s*e\d+/i.test(String(e.kind||e.label||"")));
   const listTitle=isDrama?"Episodes":"Available Versions";
   const seasonKey=ep=>String(ep.seasonName||ep.seasonTitle||(ep.seasonNumber!=null?"Season "+ep.seasonNumber:(ep.season!=null?(typeof ep.season==="number"?"Season "+ep.season:String(ep.season)):"Season 1")));
   const seasonMap=new Map();episodes.forEach((ep,i)=>{const key=seasonKey(ep);if(!seasonMap.has(key))seasonMap.set(key,[]);seasonMap.get(key).push({ep,i});});
   const episodeRows=[...seasonMap.entries()].map(([season,items],si)=>'<section class="ms-season-card"><button class="ms-season-heading" type="button" aria-expanded="'+(si===0?"true":"false")+'"><span class="ms-season-name">'+esc(season)+'</span><small>'+items.length+' Episodes</small><b class="ms-season-chevron">⌄</b></button><div class="ms-season-episodes ms-episode-strip" '+(si===0?"":"hidden")+'>'+items.map(({ep,i})=>{const number=String(ep.number||i+1).padStart(2,"0"),image=safeImage(ep.thumbnail||ep.image||ep.poster||ep.cover||poster),label=ep.label||("Episode "+(ep.number||i+1)),quality=getSources(ep).map(s=>s.quality).join(" · ");return '<button class="movie-api-episode ms-episode-button" type="button" data-watch-episode="'+i+'" aria-label="Play '+esc(label)+'"><span class="ms-episode-thumb">'+(image?'<img loading="lazy" decoding="async" src="'+esc(image)+'" alt="">':'<span class="ms-episode-thumb-fallback">EP</span>')+'<span class="ms-episode-play">▶</span><span class="ms-episode-number">EP '+number+'</span></span><span class="ms-episode-info"><b>'+esc(label)+'</b><small>'+(quality?esc(quality):esc(ep.kind||"Episode "+number))+'</small></span></button>';}).join("")+'</div></section>').join("")||'<p class="muted">No episodes or video versions were returned.</p>';
   const dubLabels=currentDubs.map(x=>getLang(x)).filter(Boolean);
   const hindiDub=dubLabels.some(isHindi)||episodes.some(e=>isHindi(getLang(e))||getSources(e).some(s=>isHindi(s.audioLanguage)));
   document.title=(d.title||"Watch")+" — MovieStream BD";
   root.innerHTML='<section class="ms-title-detail">'+(poster?'<img class="ms-title-poster" src="'+esc(poster)+'" alt="'+esc(d.title||"Poster")+'">':'')+'<div class="ms-title-copy"><p class="eyebrow">MOVIESTREAM BD · '+(isDrama?"DRAMA SERIES":"MOVIE")+'</p><h1>'+esc(d.title||"Untitled")+'</h1><p class="muted">'+esc(d.releaseDate||"")+' · '+esc(d.quality||d.resolution||"")+' · '+esc(d.language||"")+'</p><p>'+esc(d.storyline||"")+'</p><p><b>Genre:</b> '+esc(d.genre||"Not specified")+'</p><p><b>Audio Languages:</b> '+esc(dubLabels.join(", ")||d.language||"Not listed")+'</p><p><b>Hindi Audio:</b> '+(hindiDub?"Available":"Not confirmed by source metadata")+'</p></div></section><section class="ms-watch-player"><div class="video-heading"><div><p class="eyebrow">NOW PLAYING</p><h2 id="movieWatchNow">Loading first '+(isDrama?"episode":"version")+'…</h2></div><button class="btn ghost" id="movieWatchUnmute" type="button" hidden>🔊 Turn Sound On</button></div><div id="movieWatchAudioBox" class="ms-audio-box"></div><p id="movieWatchMessage" class="muted" aria-live="polite">Preparing video…</p><video id="movieWatchVideo" class="movie-player" controls playsinline preload="metadata" '+(poster?'poster="'+esc(poster)+'"':'')+'></video><a id="movieWatchDownload" class="ms-download-entry" href="download.html?path='+encodeURIComponent(path)+'&episode=0"><span>⬇</span><span><b>Download</b><small>Select quality and download</small></span><span class="ms-download-arrow">›</span></a></section><section class="ms-episode-section" '+(isDrama?'':'hidden')+'><div class="section-head"><div><p class="eyebrow">'+(isDrama?"SEASON & EPISODE GUIDE":"PLAYBACK OPTIONS")+'</p><h2>'+listTitle+' <em>('+episodes.length+')</em></h2></div></div><div class="movie-api-episodes">'+episodeRows+'</div></section><section id="movieWatchSuggested" class="ms-suggested-section" hidden><div class="section-head"><div><p class="eyebrow">KEEP WATCHING</p><h2 id="movieWatchSuggestedTitle">Suggested for you</h2></div></div><div id="movieWatchSuggestedGrid" class="ms-suggested-grid"></div></section>';
   status.textContent="Details loaded successfully.";
   const extras=document.createElement("section");extras.className="cv-watch-community";extras.innerHTML='<section id="cvComments"><h2>Comments</h2><p class="muted">Loading comments…</p></section><section id="cvCast"><h2>Cast &amp; Crew</h2><p class="muted">Loading cast…</p></section>';root.appendChild(extras);
   const safeText=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
   const subjectId=d.subjectId||d.subject_id||d.commentSubjectId||d.comment_subject_id||d.contentId||d.id||d._id;
   if(subjectId!=null){
    fetch("/api/movie-api/comments?subjectId="+encodeURIComponent(subjectId)+"&page=1").then(r=>r.json()).then(payload=>{
     const rows=Array.isArray(payload.comments)?payload.comments:Array.isArray(payload.items)?payload.items:Array.isArray(payload.list)?payload.list:[];
     $("#cvComments").innerHTML='<h2>Comments</h2>'+(rows.length?rows.slice(0,20).map(x=>'<article class="cv-comment"><b>'+safeText(x.userName||x.username||x.user||"Viewer")+'</b><p>'+safeText(x.content||x.comment||x.text||"")+'</p><small>'+safeText(x.createdAt||x.time||"")+'</small></article>').join(""):'<p class="muted">No comments available.</p>');
    }).catch(()=>{$("#cvComments").innerHTML='<h2>Comments</h2><p class="muted">Comments are unavailable right now.</p>';});
   }else $("#cvComments").innerHTML='<h2>Comments</h2><p class="muted">Comments are not available for this title.</p>';
   const staffList=[...(Array.isArray(d.staff)?d.staff:[]),...(Array.isArray(d.cast)?d.cast:[]),...(Array.isArray(d.actors)?d.actors:[]),...(Array.isArray(d.crew)?d.crew:[])];
   const uniqueStaff=[...new Map(staffList.filter(x=>x&&typeof x==="object"&&(x.staffId||x.staff_id||x.personId||x.actorId||x.id)).map(x=>[String(x.staffId||x.id),x])).values()].slice(0,10);
   if(uniqueStaff.length){
    $("#cvCast").innerHTML='<h2>Cast &amp; Crew</h2><div class="cv-cast-grid">'+uniqueStaff.map(x=>'<button type="button" class="cv-cast-person" data-staff-id="'+safeText(x.staffId||x.id)+'"><b>'+safeText(x.name||x.title||"Cast member")+'</b><small>'+safeText(x.role||x.character||x.job||"")+'</small></button>').join("")+'</div>';
    $("#cvCast").addEventListener("click",async e=>{const b=e.target.closest("[data-staff-id]");if(!b)return;try{const r=await fetch("/api/movie-api/staff?staffId="+encodeURIComponent(b.dataset.staffId)+"&page=1");const payload=await r.json();const detail=payload.staff||payload.person||payload.data||{};b.insertAdjacentHTML("afterend",'<p class="cv-staff-detail">'+safeText(detail.biography||detail.description||detail.name||"No additional biography available.")+'</p>');b.disabled=true;}catch{}});
   }else $("#cvCast").innerHTML='<h2>Cast &amp; Crew</h2><p class="muted">No cast details supplied for this title.</p>';

   loadSuggested(d).catch(e=>console.warn("Suggested titles unavailable",e));
   root.addEventListener("click",e=>{const season=e.target.closest(".ms-season-heading");if(season){const panel=season.nextElementSibling,open=season.getAttribute("aria-expanded")==="true";season.setAttribute("aria-expanded",String(!open));panel.hidden=open;return;}const b=e.target.closest("[data-watch-episode]");if(b)start(Number(b.dataset.watchEpisode));});
   $("#movieWatchUnmute").addEventListener("click",()=>{const v=$("#movieWatchVideo");v.muted=false;v.volume=1;$("#movieWatchUnmute").textContent="Sound On";});
   if(episodes.length){
    const hindiIndex=episodes.findIndex(ep=>isHindi(getLang(ep))||getSources(ep).some(s=>isHindi(s.audioLanguage)));
    start(hindiIndex>=0?hindiIndex:0);
   }else status.textContent="Details loaded, but no playable episodes were found.";
  }catch(error){status.textContent=error.message||"Could not load this title.";}
 }
 load();
})();