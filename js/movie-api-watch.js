(() => {
 "use strict";
 const $=s=>document.querySelector(s),esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const safeImage=s=>/^https:\/\//i.test(s||"")?s:"";
 const params=new URLSearchParams(location.search),path=params.get("path")||"",root=$("#movieWatchRoot"),status=$("#movieWatchStatus");
 let episodes=[],playerApi=null,selected=-1,currentSources=[],currentDubs=[],watchDetail=null,streamRequest=0,currentSubtitles=[],currentSuggestedMarkup="";
 let embedFrame=null;
 function validEmbedUrl(value){try{const u=new URL(String(value||""));return u.protocol==="https:"?u.href:"";}catch{return "";}}
 function findEmbedUrl(value,depth=0){if(!value||typeof value!=="object"||depth>6)return "";if(Array.isArray(value)){for(const item of value){const found=findEmbedUrl(item,depth+1);if(found)return found;}return "";}for(const key of ["embedPlayerUrl","embed_player_url","embedUrl","embed_url","playerUrl","player_url"]){const found=validEmbedUrl(value[key]);if(found)return found;}for(const key of Object.keys(value)){const child=value[key];if(child&&typeof child==="object"){const found=findEmbedUrl(child,depth+1);if(found)return found;}}return "";}
 function showEmbedPlayer(value){
  const src=validEmbedUrl(value);if(!src)return false;
  const video=$("#movieWatchVideo"),message=$("#movieWatchMessage");
  if(!embedFrame){
   embedFrame=document.createElement("iframe");embedFrame.id="movieWatchEmbed";embedFrame.title="Movie and episode player";
   embedFrame.allow="autoplay; fullscreen; encrypted-media; picture-in-picture";embedFrame.allowFullscreen=true;
   embedFrame.referrerPolicy="strict-origin-when-cross-origin";
   embedFrame.style.cssText="display:block;width:100%;aspect-ratio:16/9;min-height:240px;border:0;border-radius:14px;background:#000";
   video?.parentNode?.insertBefore(embedFrame,video);
  }
  embedFrame.src=src;embedFrame.hidden=false;
  if(video){
   video.pause();video.removeAttribute("src");video.load();
   video.hidden=true;video.setAttribute("hidden","");
   video.style.setProperty("display","none","important");
   const ownPlayer=video.closest(".cv-player");
   if(ownPlayer){ownPlayer.hidden=true;ownPlayer.setAttribute("hidden","");ownPlayer.style.setProperty("display","none","important");}
  }
  // Hard-disable every CineVerse-built player surface; only the provider iframe remains visible.
  document.querySelectorAll(".cv-player, #movieWatchVideo, video.movie-player").forEach(el=>{
   el.hidden=true;el.setAttribute("hidden","");el.style.setProperty("display","none","important");
  });
  if(playerApi?.wrap){playerApi.wrap.hidden=true;playerApi.wrap.setAttribute("hidden","");playerApi.wrap.style.setProperty("display","none","important");}
  if(message)message.textContent="Universal HD player loaded · Use Next Server inside the player to switch servers.";
  return true;
 }
 function hideEmbedPlayer(){
  if(embedFrame){embedFrame.src="about:blank";embedFrame.hidden=true;}
  const video=$("#movieWatchVideo");if(video)video.hidden=false;
  if(playerApi?.wrap)playerApi.wrap.hidden=false;
 }
 const getLang=o=>String(o?.audioLanguage||o?.dubLanguage||o?.language||o?.lang||o?.audio||o?.label||o?.name||"").trim();
 const isHindi=s=>/^(hi|hin|hindi)([-_ ]|$)/i.test(String(s||"").trim())||/hindi|हिन्दी|हिंदी/i.test(String(s||""));
 const isHindiDubbed=item=>item?._hindiCatalog===true||[item?.language,item?.audioLanguage,item?.audioLanguages,item?.dubLanguage,item?.dubLanguages,item?.availableLanguages,item?.languages,item?.audio].some(v=>Array.isArray(v)?v.some(x=>isHindi(getLang(x)||x?.code)):isHindi(v));
 function getSources(ep){
  return (Array.isArray(ep.sources)?ep.sources:[]).map(s=>{
   try{const u=new URL(s.url||s.playUrl||s.play_url);if(u.protocol!=="https:"||u.username||u.password)return null;
    const raw=String(s.quality||s.resolution||s.resolutions?.[0]||"");const q=raw.match(/\d{3,4}/)?.[0]||"";
    const type=String(s.type||s.format||"");if(!q&&!/m3u8|mpegurl|hls/i.test(type))return null;
    return {url:u.href,quality:q?(q+"p"):"Auto",provider:String(s.provider||"MovieBox"),mime:/m3u8|mpegurl|hls/i.test(type)?"application/vnd.apple.mpegurl":"video/mp4",audioLanguage:getLang(s)};
   }catch{return null;}
  }).filter(Boolean).sort((a,b)=>Number(isHindi(b.audioLanguage))-Number(isHindi(a.audioLanguage)));
 }
 function sourcesForLanguage(sources,language){
  const chosen=String(language||"").trim();
  const matched=chosen&&chosen!=="auto"?sources.filter(s=>String(s.audioLanguage||"").trim()===chosen):[];
  return matched.length?matched:sources;
 }
 function getSubtitles(...objects){
  const found=[],seen=new Set();
  const add=value=>{if(!value)return;const list=Array.isArray(value)?value:[value];list.forEach((item,i)=>{
   if(typeof item==="string"){if(/^https?:\/\//i.test(item)&&/\.(?:vtt|srt)(?:$|[?#])/i.test(item))push({url:item,label:"Subtitle "+(i+1),language:"und"});return;}
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
   if(detail.subjectId||detail.id)query.set("subjectId",String(detail.subjectId||detail.id));
   if(detail.detailPath)query.set("detailPath",String(detail.detailPath));
   query.set("path",path);
   const response=await fetch("/api/movie-api/stream?"+query.toString(),{cache:"no-store"});
   const payload=await response.json();
   if(requestId!==streamRequest)return;
   const streamRoot=payload.stream||payload.data||payload.result||payload;
   const embedUrl=findEmbedUrl(payload)||findEmbedUrl(watchDetail);
   // Restore the provider's universal embedded player as the primary player.
   // Keep the built-in CineVerse video player hidden.
   if(embedUrl&&showEmbedPlayer(embedUrl)){
    currentSources=[];currentSubtitles=getSubtitles(streamRoot,payload,ep,detail);
    $("#movieWatchNow").textContent=ep.label||("Episode "+(ep.number||index+1));
    root.querySelectorAll("[data-watch-episode]").forEach((b,i)=>b.classList.toggle("active",i===index));
    const dl=$("#movieWatchDownload");if(dl)dl.href="download.html?path="+encodeURIComponent(path)+"&episode="+index;
    const audioBox=$("#movieWatchAudioBox");if(audioBox)audioBox.hidden=true;
    const unmute=$("#movieWatchUnmute");if(unmute)unmute.hidden=true;
    return;
   }
   const streamItems=Array.isArray(streamRoot.sources)?streamRoot.sources:Array.isArray(streamRoot.streams)?streamRoot.streams:Array.isArray(streamRoot.urls)?streamRoot.urls:[];
   currentSubtitles=getSubtitles(streamRoot,payload,ep,detail);
   const normalized=streamItems.map(s=>({url:s.url||s.playUrl||s.play_url||s.src||s.file||s.streamUrl||s.stream_url,quality:s.quality||s.resolution||s.label||"720p",provider:s.provider||s.name||"Movie API",type:s.type||s.format||s.mimeType||"",audioLanguage:getLang(s)})).filter(s=>{try{const u=new URL(s.url);const kind=String(s.type||"").toLowerCase();return u.protocol==="https:"&&(u.hostname==="hd-w0l1.onrender.com"||u.hostname==="hd-hcfs.onrender.com"||u.hostname==="mb-stream.rahamanabduar2.workers.dev")&&(kind==="mp4"||kind==="m3u8"||kind.includes("mpegurl")||/\/api\/mb-stream\.mp4|\.m3u8(?:$|[?#])/i.test(u.pathname+u.search));}catch{return false;}});
   if(normalized.length)sources=normalized.map(s=>({url:s.url,quality:(String(s.quality).match(/\d+/)?.[0]||"720")+"p",provider:s.provider,mime:/m3u8|hls/i.test(s.type+" "+s.url)?"application/vnd.apple.mpegurl":"video/mp4",audioLanguage:s.audioLanguage}));
   // Direct sources are not used while the provider embed is available.
   if(sources.length){
    currentSources=sources;
    currentSubtitles=getSubtitles(streamRoot,payload,ep,detail);
    hideEmbedPlayer();
    video.hidden=false;
    const titleText=detail.title||"Now Playing";
    if(playerApi){
     playerApi.setSources(sourcesForLanguage(sources,sources.find(s=>isHindi(s.audioLanguage))?.audioLanguage||sources[0]?.audioLanguage));
     playerApi.setSubtitles(currentSubtitles);
    }else{
     playerApi=window.CineVersePlayer?.mount({video,sources,storageKey:"cv-moviebox-"+String(detail.subjectId||detail.id||path)+"-"+season+"-"+episodeNumber,subtitles:currentSubtitles,title:titleText,backUrl:"./"});
    }
    $("#movieWatchNow").textContent=ep.label||("Episode "+(ep.number||index+1));
    root.querySelectorAll("[data-watch-episode]").forEach((b,i)=>b.classList.toggle("active",i===index));
    const dl=$("#movieWatchDownload");if(dl)dl.href="download.html?path="+encodeURIComponent(path)+"&episode="+index;
    const audioBox=$("#movieWatchAudioBox");if(audioBox)audioBox.hidden=true;
    const unmute=$("#movieWatchUnmute");if(unmute)unmute.hidden=true;
    message.textContent="CineVerse Player · "+sources.map(s=>s.quality).join(" · ")+" · "+(sources.some(s=>isHindi(s.audioLanguage))?"Hindi Dub":"Direct stream");
    return;
   }
   // No direct file source: use the provider embed as a fallback.
   if(embedUrl&&showEmbedPlayer(embedUrl)){
    currentSources=[];currentSubtitles=getSubtitles(payload,streamRoot,ep,detail);
    $("#movieWatchNow").textContent=ep.label||("Episode "+(ep.number||index+1));
    root.querySelectorAll("[data-watch-episode]").forEach((b,i)=>b.classList.toggle("active",i===index));
    const dl=$("#movieWatchDownload");if(dl)dl.href="download.html?path="+encodeURIComponent(path)+"&episode="+index;
    const audioBox=$("#movieWatchAudioBox");if(audioBox)audioBox.hidden=true;
    const unmute=$("#movieWatchUnmute");if(unmute)unmute.hidden=true;
    return;
   }
  }catch(err){console.warn("Stream endpoint unavailable",err);}
  if(requestId!==streamRequest)return;
  // If the stream endpoint failed, still try the embed URL returned by details.
  const fallbackEmbed=findEmbedUrl(watchDetail);
  if(fallbackEmbed&&showEmbedPlayer(fallbackEmbed)){
   currentSources=[];currentSubtitles=getSubtitles(ep,watchDetail);
   $("#movieWatchNow").textContent=ep.label||("Episode "+(ep.number||index+1));
   root.querySelectorAll("[data-watch-episode]").forEach((b,i)=>b.classList.toggle("active",i===index));
   const dl=$("#movieWatchDownload");if(dl)dl.href="download.html?path="+encodeURIComponent(path)+"&episode="+index;
   const audioBox=$("#movieWatchAudioBox");if(audioBox)audioBox.hidden=true;
   const unmute=$("#movieWatchUnmute");if(unmute)unmute.hidden=true;
   return;
  }
  if(!sources.length){message.textContent="Universal embedded player URL was not returned by the API. The built-in CineVerse player is disabled as requested.";video.hidden=true;return;}
  if(!currentSubtitles.length)currentSubtitles=getSubtitles(ep,detail);
  currentSources=sources;
  const downloadLink=$("#movieWatchDownload");if(downloadLink)downloadLink.href="download.html?path="+encodeURIComponent(path)+"&episode="+index;
  $("#movieWatchNow").textContent=ep.label||("Episode "+(ep.number||index+1));
  root.querySelectorAll("[data-watch-episode]").forEach((b,i)=>b.classList.toggle("active",i===index));
  const audioBox=$("#movieWatchAudioBox");
  const serverGroups=[...new Map(sources.map(s=>[String(s.provider||"Server").trim()||"Server",sources.filter(x=>(String(x.provider||"Server").trim()||"Server")===(String(s.provider||"Server").trim()||"Server"))])).entries()];
  serverGroups.sort((a,b)=>Number(b[1].some(s=>isHindi(s.audioLanguage)))-Number(a[1].some(s=>isHindi(s.audioLanguage))));
  let activeProvider=serverGroups[0]?.[0]||"Server";
  message.textContent=serverGroups.length+" server"+(serverGroups.length===1?"":"s")+" available · Quality: "+sources.map(s=>s.quality).join(" · ")+(sources.some(s=>isHindi(s.audioLanguage))?" · Hindi audio available":"");
  const renderServerControls=(applySource=true)=>{
   const group=serverGroups.find(([name])=>name===activeProvider)?.[1]||sources;
   if(audioBox){
    const serverHtml='<div class="ms-server-picker"><span class="ms-server-label">STREAM SERVERS</span><div class="ms-server-buttons">'+serverGroups.map(([name,items],i)=>'<button type="button" class="ms-server-button '+(name===activeProvider?'active':'')+'" data-server="'+esc(name)+'"><small>SERVER '+(i+1)+'</small><b>'+esc(name)+'</b><em>'+items.length+' source'+(items.length===1?'':'s')+'</em></button>').join("")+'</div></div>';
    audioBox.innerHTML=serverHtml+(audioOptions(group)||'<span class="muted">Audio track information not supplied by provider.</span>');
   }
   const audioSelect=$("#movieWatchAudio");
   const chosenLang=group.find(s=>isHindi(s.audioLanguage))?.audioLanguage||group.find(s=>s.audioLanguage)?.audioLanguage||"auto";
   if(audioSelect&&chosenLang!=="auto")audioSelect.value=chosenLang;
   const active=sourcesForLanguage(group,audioSelect?.value||chosenLang);
   if(playerApi&&applySource)playerApi.setSources(active);
   if(audioSelect&&playerApi?.wrap){
    const topRight=playerApi.wrap.querySelector(".cv-top-right");
    topRight?.querySelector(".cv-audio-choice")?.remove();
    const label=audioSelect.closest("label")||audioSelect;label.classList.add("cv-audio-choice");topRight?.appendChild(label);
    audioSelect.addEventListener("change",()=>playerApi?.setSources(sourcesForLanguage(group,audioSelect.value)));
   }
  };
  if(audioBox&&!audioBox.dataset.serverBound){
   audioBox.dataset.serverBound="1";
   audioBox.addEventListener("click",event=>{
    const button=event.target.closest("[data-server]");if(!button)return;
    activeProvider=button.dataset.server;renderServerControls();
   });
  }
  const initialGroup=serverGroups.find(([name])=>name===activeProvider)?.[1]||sources;
  const selectedLang=initialGroup.find(s=>isHindi(s.audioLanguage))?.audioLanguage||initialGroup.find(s=>s.audioLanguage)?.audioLanguage||"auto";
  const activeSources=sourcesForLanguage(initialGroup,selectedLang);
  // The native CineVerse player is intentionally not mounted or shown.
  video.pause();video.removeAttribute("src");video.load();video.hidden=true;
  if(audioBox)audioBox.hidden=true;
  $("#movieWatchUnmute").hidden=true;
  message.textContent="Universal embedded player URL was not returned by the API. Please check the provider's stream response.";
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
   const usable=relatedItems.filter(x=>x&&typeof x==="object"&&String(x.path||"").startsWith("/mb/")&&x.path!==path&&!/nigeria|nollywood/i.test(String(x.country||"")+" "+String(x.language||""))).slice(0,12);
   if(usable.length){
    title.textContent="Related to "+(detail.title||"this title");
    grid.innerHTML=usable.map(x=>'<a class="ms-suggested-card" href="watch.html?path='+encodeURIComponent(x.path)+'"><img loading="lazy" decoding="async" src="'+esc(safeImage(x.poster||x.previewImage))+'" alt="'+esc(x.title||"")+'"><span><b>'+esc(x.title||"Untitled")+'</b><small>'+esc(x.language||x.typeBadge||"")+'</small></span></a>').join("");
    box.hidden=false;currentSuggestedMarkup=grid.innerHTML;playerApi?.setSuggestions?.(currentSuggestedMarkup);return;
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
  let list=[...map.values()].filter(x=>x.path!==path&&!/nigeria|nollywood/i.test(String(x.country||"")+" "+String(x.language||"")));
  if(group==="section")list=list.filter(x=>x._sections.includes(label));
  else if(group)list=list.filter(x=>suggestedGroup(x)[0]===group);
  if(!list.length&&current?._sections?.length)list=[...map.values()].filter(x=>x.path!==path&&!/nigeria|nollywood/i.test(String(x.country||"")+" "+String(x.language||""))&&x._sections.some(s=>current._sections.includes(s)));
  const hindi=x=>/hindi dubbed/i.test(String(x.language||""))||(/hindi/i.test(String(x.language||""))&&(x._sections||[]).some(s=>/south indian.*hindi dubbed|anime in hindi/i.test(s)));
  list.sort((a,b)=>Number(hindi(b))-Number(hindi(a))||(Number(b.uploadedAtMs)||0)-(Number(a.uploadedAtMs)||0));
  list.sort((a,b)=>Number(isHindiDubbed(b))-Number(isHindiDubbed(a))||(Number(b.uploadedAtMs)||0)-(Number(a.uploadedAtMs)||0));
  list=list.slice(0,12);if(!list.length)return;
  title.textContent="More "+label;
  grid.innerHTML=list.map(x=>'<a class="ms-suggested-card" href="watch.html?path='+encodeURIComponent(x.path)+'"><img loading="lazy" decoding="async" src="'+esc(safeImage(x.poster||x.previewImage))+'" alt="'+esc(x.title||"")+'"><span><b>'+esc(x.title||"Untitled")+'</b><small>'+esc(x.language||x.typeBadge||"")+'</small></span></a>').join("");
  box.hidden=false;currentSuggestedMarkup=grid.innerHTML;playerApi?.setSuggestions?.(currentSuggestedMarkup);
 }

 async function downloadSeasonZip(items,seasonName){
  const progress=root.querySelector("#msZipProgress");
  const setProgress=label=>{if(progress)progress.textContent=label;};
  if(!items?.length)return;
  const entries=[],failures=[],safeName=s=>String(s||"").replace(/[\\/:*?"<>|]/g," ").replace(/\s+/g," ").trim().slice(0,100)||"Episode";
  const folder=safeName(seasonName),seasonFallback=items[0]?.ep?.seasonNumber??items[0]?.ep?.season??1;
  for(let n=0;n<items.length;n++){
   const {ep,index}=items[n],number=String(ep.number||ep.episodeNumber||index+1).padStart(2,"0");
   setProgress("Downloading "+(n+1)+"/"+items.length+" episodes…");
   try{
    const query=new URLSearchParams({se:String(Number(ep.seasonNumber??ep.season??seasonFallback)||0),ep:String(Number(ep.number??ep.episodeNumber??(index+1))||index+1),quality:"best"});
    const sid=watchDetail?.subjectId||watchDetail?.subject_id||watchDetail?.commentSubjectId||watchDetail?.comment_subject_id||watchDetail?.contentId||watchDetail?.id||watchDetail?._id;
    if(sid!=null)query.set("subjectId",String(sid));if(watchDetail?.detailPath)query.set("detailPath",String(watchDetail.detailPath));if(watchDetail?.title)query.set("title",String(watchDetail.title));
    const response=await fetch("/api/movie-api/download-file?"+query.toString(),{cache:"no-store"});
    if(!response.ok)throw new Error("HTTP "+response.status);
    const blob=await response.blob();if(!blob.size)throw new Error("Empty file");
    entries.push({name:folder+"/E"+number+" - "+safeName(ep.title||ep.label||("Episode "+number))+".mp4",data:new Uint8Array(await blob.arrayBuffer())});
   }catch(error){failures.push("Episode "+number+": "+(error.message||"Unavailable"));}
  }
  if(!entries.length){setProgress("No downloadable MP4 files were available for this season.");return;}
  const table=downloadSeasonZip.crcTable||(downloadSeasonZip.crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let x=n;for(let k=0;k<8;k++)x=(x&1)?(0xedb88320^(x>>>1)):(x>>>1);t[n]=x>>>0;}return t;})());
  const crc32=data=>{let x=0xffffffff;for(const b of data)x=table[(x^b)&255]^(x>>>8);return (x^0xffffffff)>>>0;};
  const enc=new TextEncoder(),locals=[],centrals=[];let offset=0;
  for(const entry of entries){
   const name=enc.encode(entry.name),data=entry.data,crc=crc32(data),local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);
   lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x0800,true);lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,name.length,true);local.set(name,30);locals.push(local,data);
   const central=new Uint8Array(46+name.length),cv=new DataView(central.buffer);
   cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x0800,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);central.set(name,46);centrals.push(central);offset+=local.length+data.length;
  }
  const centralSize=centrals.reduce((n,x)=>n+x.length,0),end=new Uint8Array(22),ev=new DataView(end.buffer);
  ev.setUint32(0,0x06054b50,true);ev.setUint16(8,entries.length,true);ev.setUint16(10,entries.length,true);ev.setUint32(12,centralSize,true);ev.setUint32(16,offset,true);
  const zip=new Blob([...locals,...centrals,end],{type:"application/zip"}),url=URL.createObjectURL(zip),a=document.createElement("a");
  a.href=url;a.download=safeName((watchDetail?.title||"Series")+" - "+folder)+".zip";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  setProgress("ZIP ready: "+entries.length+" episode(s)"+(failures.length?" · "+failures.length+" unavailable":"")+".");
  if(failures.length)alert("ZIP তৈরি হয়েছে, তবে কিছু Episode পাওয়া যায়নি:\n"+failures.join("\n"));
 }

 async function load(){
  if(!/^\/mb\/[a-zA-Z0-9_./~-]{1,360}$/.test(path)){status.textContent="Invalid title link.";return;}
  try{
   const response=await fetch("/api/movie-api/details?path="+encodeURIComponent(path),{cache:"no-store",signal:AbortSignal.timeout(25000)});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||("Details API HTTP "+response.status));
   // Accept both proxy-normalized {detail:{...}} and the original MovieBox
   // top-level {ok:true, subjectId, embedPlayerUrl, ...} response.
   const d=data.detail||data.data?.detail||data.data||data.result||data;
   if(!d||typeof d!=="object"||(!d.title&&!d.subjectId&&!d.embedPlayerUrl&&!d.episodes&&!d.totalEpisodes))throw new Error(data.error||"Details API returned no usable title data.");
   watchDetail=d;episodes=Array.isArray(d.episodes)?d.episodes:[];if(!episodes.length&&findEmbedUrl(d))episodes=[{label:"Play Movie",number:1,seasonNumber:0}];currentDubs=Array.isArray(d.dubs)?d.dubs:[];
   const poster=safeImage(d.poster),typeHint=[d.type,d.mediaType,d.typeBadge,d.category,d.categoryPath].join(" ").toLowerCase();
   const isDrama=/series|tv|drama|show|serial|web\s*series/.test(typeHint)||episodes.some(e=>/episode|season|ep\s*\d|s\d+\s*e\d+/i.test(String(e.kind||e.label||"")));
   const listTitle=isDrama?"Episodes":"Available Versions";
   const seasonKey=ep=>String(ep.seasonName||ep.seasonTitle||(ep.seasonNumber!=null?"Season "+ep.seasonNumber:(ep.season!=null?(typeof ep.season==="number"?"Season "+ep.season:String(ep.season)):"Season 1")));
   const seasonMap=new Map();episodes.forEach((ep,i)=>{const key=seasonKey(ep);if(!seasonMap.has(key))seasonMap.set(key,[]);seasonMap.get(key).push({ep,i});});
   const episodeRows=[...seasonMap.entries()].map(([season,items],si)=>'<section class="ms-season-card"><div class="ms-season-heading" role="button" tabindex="0" aria-expanded="'+(si===0?"true":"false")+'"><span class="ms-season-name">'+esc(season)+'</span><small>'+items.length+' Episodes</small><button type="button" class="ms-season-download" data-download-season="'+si+'">⬇ Download Season ZIP</button><b class="ms-season-chevron">⌄</b></div><div class="ms-season-episodes ms-episode-strip" '+(si===0?"":"hidden")+'>'+items.map(({ep,i})=>{const number=String(ep.number||i+1).padStart(2,"0"),image=safeImage(ep.thumbnail||ep.image||ep.poster||ep.cover||poster),label=ep.label||("Episode "+(ep.number||i+1)),quality=getSources(ep).map(s=>s.quality).join(" · ");return '<button class="movie-api-episode ms-episode-button" type="button" data-watch-episode="'+i+'" aria-label="Play '+esc(label)+'"><span class="ms-episode-thumb">'+(image?'<img loading="lazy" decoding="async" src="'+esc(image)+'" alt="">':'<span class="ms-episode-thumb-fallback">EP</span>')+'<span class="ms-episode-play">▶</span><span class="ms-episode-number">EP '+number+'</span></span><span class="ms-episode-info"><b>'+esc(label)+'</b><small>'+(quality?esc(quality):esc(ep.kind||"Episode "+number))+'</small></span></button>';}).join("")+'</div></section>').join("")||'<p class="muted">No episodes or video versions were returned.</p>';
   const dubLabels=currentDubs.map(x=>getLang(x)).filter(Boolean);
   const hindiDub=dubLabels.some(isHindi)||episodes.some(e=>isHindi(getLang(e))||getSources(e).some(s=>isHindi(s.audioLanguage)));
   document.title=(d.title||"Watch")+" — MovieStream BD";
   root.innerHTML='<section class="ms-title-detail">'+(poster?'<img class="ms-title-poster" src="'+esc(poster)+'" alt="'+esc(d.title||"Poster")+'">':'')+'<div class="ms-title-copy"><p class="eyebrow">MOVIESTREAM BD · '+(isDrama?"DRAMA SERIES":"MOVIE")+'</p><h1>'+esc(d.title||"Untitled")+'</h1><p class="muted">'+esc(d.releaseDate||"")+' · '+esc(d.quality||d.resolution||"")+' · '+esc(d.language||"")+'</p><p>'+esc(d.storyline||"")+'</p><p><b>Genre:</b> '+esc(d.genre||"Not specified")+'</p><p><b>Audio Languages:</b> '+esc(dubLabels.join(", ")||d.language||"Not listed")+'</p><p><b>Hindi Audio:</b> '+(hindiDub?"Available":"Not confirmed by source metadata")+'</p></div></section><section class="ms-watch-player"><div class="video-heading"><div><p class="eyebrow">NOW PLAYING</p><h2 id="movieWatchNow">Loading first '+(isDrama?"episode":"version")+'…</h2></div><button class="btn ghost" id="movieWatchUnmute" type="button" hidden>🔊 Turn Sound On</button></div><div id="movieWatchAudioBox" class="ms-audio-box"></div><p id="movieWatchMessage" class="muted" aria-live="polite">Preparing video…</p><video id="movieWatchVideo" class="movie-player" hidden controls playsinline preload="none" '+(poster?'poster="'+esc(poster)+'"':'')+'></video><a id="movieWatchDownload" class="ms-download-entry" href="download.html?path='+encodeURIComponent(path)+'&episode=0"><span>⬇</span><span><b>Download</b><small>Select quality and download</small></span><span class="ms-download-arrow">›</span></a></section><section class="ms-episode-section" '+(isDrama?'':'hidden')+'><div class="section-head"><div><p class="eyebrow">'+(isDrama?"SEASON & EPISODE GUIDE":"PLAYBACK OPTIONS")+'</p><h2>'+listTitle+' <em>('+episodes.length+')</em></h2></div></div><div id="msZipProgress" class="muted" aria-live="polite"></div><div class="movie-api-episodes">'+episodeRows+'</div></section><section id="movieWatchSuggested" class="ms-suggested-section" hidden><div class="section-head"><div><p class="eyebrow">KEEP WATCHING</p><h2 id="movieWatchSuggestedTitle">Suggested for you</h2></div></div><div id="movieWatchSuggestedGrid" class="ms-suggested-grid"></div></section>';
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
   root.addEventListener("click",e=>{const zipButton=e.target.closest("[data-download-season]");if(zipButton){e.preventDefault();e.stopPropagation();const group=[...seasonMap.values()][Number(zipButton.dataset.downloadSeason)];if(group?.length){zipButton.disabled=true;zipButton.textContent="Preparing ZIP…";downloadSeasonZip(group,seasonKey(group[0].ep)).finally(()=>{zipButton.disabled=false;zipButton.textContent="⬇ Download Season ZIP";});}return;}const season=e.target.closest(".ms-season-heading");if(season){const panel=season.nextElementSibling,open=season.getAttribute("aria-expanded")==="true";season.setAttribute("aria-expanded",String(!open));panel.hidden=open;return;}const b=e.target.closest("[data-watch-episode]");if(b)start(Number(b.dataset.watchEpisode));});
   $("#movieWatchUnmute").addEventListener("click",()=>{const v=$("#movieWatchVideo");v.muted=false;v.volume=1;$("#movieWatchUnmute").textContent="Sound On";});
   if(episodes.length){
    const hindiIndex=episodes.findIndex(ep=>isHindi(getLang(ep))||getSources(ep).some(s=>isHindi(s.audioLanguage)));
    start(hindiIndex>=0?hindiIndex:0);
   }else status.textContent="Details loaded, but no playable episodes were found.";
  }catch(error){console.error("Movie details loading failed:",error);status.textContent=(error.name==="TimeoutError"||error.name==="AbortError")?"Movie details request timed out. Check the Movie API server and Cloudflare deployment.":(error.message||"Could not load this title.");}
 }
 load();
})();