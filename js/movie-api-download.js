(()=> {
"use strict";
const $=s=>document.querySelector(s),params=new URLSearchParams(location.search),path=params.get("path")||"",requestedTitle=params.get("title")||"",requested=Math.max(0,Number(params.get("episode"))||0);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safeName=s=>String(s||"MovieStreamBD").replace(/[\\/:*?"<>|]+/g," ").replace(/\s+/g," ").trim().slice(0,100)||"MovieStreamBD";
let episodes=[],selected=requested,detail=null,downloadable=[],busy=false;
const subjectIdOf=()=>detail?.subjectId||detail?.subject_id||detail?.subject?.subjectId||detail?.subject?.subject_id||detail?.subject?.id||detail?.id||detail?.subjectId;
const seasonKey=item=>String(item?.seasonName||item?.seasonTitle||item?.seasonNumber||item?.season||"1");
function episodeCoords(item,index){
 const same=episodes.slice(0,index).filter(x=>seasonKey(x)===seasonKey(item)).length;
 const rawSeason=item?.se??item?.seasonIndex??(item?.seasonNumber!=null?Number(item.seasonNumber)-1:0);
 const rawEpisode=item?.ep??item?.episodeIndex??(item?.episodeNumber!=null?Number(item.episodeNumber)-1:(item?.number!=null?Number(item.number)-1:null));
 const primary={se:Math.max(0,Math.floor(Number(rawSeason)||0)),ep:Math.max(0,Math.floor(rawEpisode==null?same:Number(rawEpisode))||0)};
 const out=[primary];
 const label=String(item?.label||item?.name||item?.title||"");
 const match=label.match(/S(?:eason)?\s*0*(\d+)\s*[-._ ]*E(?:pisode)?\s*0*(\d+)/i)||label.match(/Season\s*0*(\d+).*?Episode\s*0*(\d+)/i);
 if(match)out.push({se:Math.max(0,Number(match[1])-1),ep:Math.max(0,Number(match[2])-1)});
 if(item?.seasonNumber!=null&&item?.episodeNumber!=null)out.push({se:Math.max(0,Number(item.seasonNumber)-1),ep:Math.max(0,Number(item.episodeNumber)-1)});
 out.push({se:0,ep:index});
 return out.filter((v,i,a)=>a.findIndex(x=>x.se===v.se&&x.ep===v.ep)===i);
}
function getSources(ep){
 const raw=[...(Array.isArray(ep?.sources)?ep.sources:[])];
 for(const b of Array.isArray(ep?.downloadButtons)?ep.downloadButtons:[])raw.push({...b,url:b.downloadUrl||b.download_url||b.url||b.link||b.fileUrl});
 const rows=raw.map(s=>{const rawUrl=s.downloadUrl||s.download_url||s.url||s.link||s.fileUrl||s.file_url||s.proxyUrl||s.proxy_url;let url=rawUrl;try{const parsed=new URL(String(rawUrl||""));const token=parsed.searchParams.get("t");if(token&&/^cp1[A-Za-z0-9._~-]{8,2048}$/.test(token))url="/api/cinepulse-media?t="+encodeURIComponent(token)+"&download=1";}catch{}const q=String(s.quality||s.resolution||s.label||s.name||s.title||"").match(/\d{3,4}/)?.[0];return {url,quality:q? q+"p":"",language:String(s.audioLanguage||s.dubLanguage||s.language||s.lang||""),type:String(s.type||s.format||"")};});
 return rows.filter(s=>{try{const u=new URL(s.url,location.origin);const allowed=u.protocol==="https:"||u.origin===location.origin&&u.pathname==="/api/cinepulse-media";return !!s.quality&&allowed&&!/m3u8|hls/i.test(s.type)&&!/\.m3u8(?:$|[?#])/i.test(s.url);}catch{return false;}})
 .sort((a,b)=>Number(b.quality.replace("p",""))-Number(a.quality.replace("p","")));
}
function updateSources(){
 const ep=episodes[selected];downloadable=getSources(ep);
 const quality=$("#downloadQuality"),action=$("#downloadAction"),status=$("#downloadStatus");
 quality.innerHTML=downloadable.length?downloadable.map((s,i)=>'<option value="'+i+'">'+esc(s.quality)+(s.language?" · "+esc(s.language):"")+'</option>').join(""):'<option value="">No direct MP4 quality</option>';
 quality.disabled=!downloadable.length;
 $("#downloadLinks").innerHTML=downloadable.map((s,i)=>'<a class="ms-download-link" href="'+esc(s.url)+'" target="_blank" rel="noopener"><span>Download '+esc(s.quality)+'<small>'+(s.language?esc(s.language):"Direct MP4")+'</small></span><b>⬇</b></a>').join("");
 if(downloadable.length){action.href=downloadable[0].url;action.setAttribute("aria-disabled","false");action.textContent="⚡ ONE CLICK DOWNLOAD · "+downloadable[0].quality;action.setAttribute("download",safeName(detail?.title)+"-"+safeName(ep?.label||("Episode "+(selected+1)))+"-"+downloadable[0].quality+".mp4");status.textContent=downloadable.length+"টি MP4 quality পাওয়া গেছে।";}
 else{action.href="#";action.removeAttribute("download");action.setAttribute("aria-disabled","true");action.textContent="Download source unavailable";status.textContent="এই Episode-এর সরাসরি MP4 source পাওয়া যায়নি। অন্য Episode নির্বাচন করে দেখুন।";}
 $("#downloadZip").hidden=episodes.length<2||!subjectIdOf();
 renderEpisodeList();
}
async function loadStreamSources(index){
 const ep=episodes[index],subjectId=subjectIdOf();if(!subjectId&&!detail?.title)return;
 for(const c of episodeCoords(ep,index)){
  try{const r=await fetch("/api/movie-api/stream?"+new URLSearchParams({...(subjectId?{subjectId:String(subjectId)}:{}),title:String(detail?.title||""),detailPath:String(detail?.detailPath||""),source:String(detail?.source||""),se:String(c.se),ep:String(c.ep)}).toString(),{cache:"no-store"});const data=await r.json();if(!r.ok||data?.ok===false)continue;
   const incoming=getSources(data);if(incoming.length){ep.sources=[...(ep.sources||[]),...incoming];ep.downloadButtons=[];return;}
  }catch(e){console.warn("Stream source lookup",e);}
 }
}
$("#downloadQuality").addEventListener("change",()=>{const s=downloadable[Number($("#downloadQuality").value)];if(!s)return;const ep=episodes[selected],a=$("#downloadAction");a.href=s.url;a.setAttribute("aria-disabled","false");a.textContent="⚡ ONE CLICK DOWNLOAD · "+s.quality;a.setAttribute("download",safeName(detail?.title)+"-"+safeName(ep?.label||("Episode "+(selected+1)))+"-"+s.quality+".mp4");});
function renderEpisodeList(){
 const section=$("#downloadEpisodeSection"),list=$("#downloadEpisodeList");
 if(episodes.length<2){section.hidden=true;return;}
 const groups=new Map();
 episodes.forEach((ep,i)=>{const key=String(ep.seasonName||ep.seasonTitle||(ep.seasonNumber!=null?"Season "+ep.seasonNumber:(ep.season!=null?(typeof ep.season==="number"?"Season "+ep.season:String(ep.season)):"Season 1")));if(!groups.has(key))groups.set(key,[]);groups.get(key).push({ep,i});});
 $("#downloadEpisodeCount").textContent="("+episodes.length+")";
 list.innerHTML=[...groups.entries()].map(([season,items],si)=>'<section class="ms-season-card"><button class="ms-season-heading" type="button" aria-expanded="'+(si===0?"true":"false")+'"><span class="ms-season-name">'+esc(season)+'</span><small>'+items.length+' Episodes</small><b class="ms-season-chevron">⌄</b></button><div class="ms-season-episodes" '+(si===0?"":"hidden")+'>'+items.map(({ep,i})=>'<button class="movie-api-episode ms-episode-button '+(i===selected?"active":"")+'" type="button" data-download-episode="'+i+'"><span class="ms-episode-number">EP '+String(ep.number||i+1).padStart(2,"0")+'</span><span class="ms-episode-info"><b>'+esc(ep.label||("Episode "+(ep.number||i+1)))+'</b><small>'+esc(ep.kind||"Episode")+'</small></span><span class="ms-episode-action">'+(i===selected?"● SELECTED":"⬇ DOWNLOAD")+'</span></button>').join("")+'</div></section>').join("");
 section.hidden=false;
}
async function selectEpisode(index){
 selected=index;const ep=episodes[selected];$("#downloadSubtitle").textContent=ep?.label||("Episode "+(selected+1));$("#downloadStatus").textContent="Checking this Episode's download servers…";
 renderEpisodeList();await loadStreamSources(selected);updateSources();renderEpisodeList();
}
$("#downloadEpisodeList").addEventListener("click",async e=>{
 const heading=e.target.closest(".ms-season-heading");if(heading){const panel=heading.nextElementSibling,open=heading.getAttribute("aria-expanded")==="true";heading.setAttribute("aria-expanded",String(!open));panel.hidden=open;return;}
 const button=e.target.closest("[data-download-episode]");if(button)await selectEpisode(Number(button.dataset.downloadEpisode));
});
async function fetchEpisode(subjectId,item,index){
 let last="No downloadable MP4 source";
 await loadStreamSources(index);
 const candidates=getSources(item).filter(s=>s.url);
 for(const source of candidates){
  const url=source.url;
  try{const r=await fetch(url,{cache:"no-store"});if(!r.ok){let msg="HTTP "+r.status;try{const j=await r.json();msg=j.error||msg;}catch{}last=msg;continue;}
   const type=(r.headers.get("content-type")||"").toLowerCase();if(type.includes("json")||type.includes("text/html")){last="Server returned a message instead of video";continue;}
   const blob=await r.blob();if(!blob.size){last="Empty video file";continue;}return {blob,coords:c};
  }catch(e){last=e.message||"Network error";}
 }
 throw new Error(last);
}
$("#downloadZip").addEventListener("click",async()=>{
 if(busy)return;const subjectId=subjectIdOf();if(!subjectId)return;
 if(!window.JSZip){$("#downloadStatus").textContent="ZIP library load হয়নি। ইন্টারনেট চালু রেখে refresh করুন।";return;}
 busy=true;const btn=$("#downloadZip"),progress=$("#zipProgress"),bar=$("#zipProgressBar"),label=$("#zipProgressText");btn.disabled=true;btn.textContent="⏳ ZIP তৈরি হচ্ছে…";progress.hidden=false;bar.style.width="0%";
 const zip=new JSZip(),root=zip.folder(safeName(detail?.title||"Drama")),failed=[];
 try{
  for(let i=0;i<episodes.length;i++){
   const item=episodes[i];label.textContent="Episode "+(i+1)+" / "+episodes.length+" সংগ্রহ হচ্ছে…";
   try{const result=await fetchEpisode(subjectId,item,i),season="Season "+String(result.coords.se+1).padStart(2,"0"),epNo=String(item.episodeNumber||item.number||i+1).padStart(2,"0"),filename=safeName(item.label||("Episode "+epNo))+".mp4";root.folder(season).file(filename,result.blob);}
   catch(e){failed.push((item.label||"Episode "+(i+1))+": "+e.message);}
   bar.style.width=Math.round((i+1)/episodes.length*75)+"%";
  }
  const successes=episodes.length-failed.length;if(!successes)throw new Error("কোনো Episode ডাউনলোড করা যায়নি। "+(failed[0]||""));
  if(failed.length)root.file("DOWNLOAD-REPORT.txt","Download failed for these episodes:\n"+failed.join("\n"));
  label.textContent="ZIP archive তৈরি হচ্ছে…";
  const blob=await zip.generateAsync({type:"blob",compression:"STORE",streamFiles:true},m=>{bar.style.width=(75+Math.round(m.percent*.25))+"%";});
  const a=document.createElement("a"),u=URL.createObjectURL(blob);a.href=u;a.download=safeName(detail?.title||"Drama")+"-Full-Drama.zip";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),120000);
  label.textContent="Complete: "+successes+" / "+episodes.length+" episodes"+(failed.length?" · "+failed.length+" failed":"");$("#downloadStatus").textContent=failed.length?"ZIP তৈরি হয়েছে, তবে কিছু Episode পাওয়া যায়নি। ZIP-এর DOWNLOAD-REPORT.txt দেখুন।":"Full Drama ZIP download শুরু হয়েছে।";
 }catch(e){label.textContent=e.message||"ZIP তৈরি করা যায়নি।";$("#downloadStatus").textContent="ZIP ব্যর্থ: "+(e.message||"Unknown error");}
 finally{busy=false;btn.disabled=false;btn.textContent="📦 DOWNLOAD FULL DRAMA ZIP";}
});
$("#downloadAction").addEventListener("click",e=>{if($("#downloadAction").getAttribute("aria-disabled")==="true")e.preventDefault();});
async function load(){
 if(!/^\/(?:mb|movie|series)\/[a-zA-Z0-9_./-]{1,300}$/.test(path)){$("#downloadStatus").textContent="Invalid title link.";return;}
 try{const r=await fetch("/api/movie-api/details?path="+encodeURIComponent(path)+"&title="+encodeURIComponent(requestedTitle),{cache:"default"}),data=await r.json();if(!r.ok||!data.detail)throw new Error(data.error||"Title details unavailable.");
  detail=data.detail;episodes=Array.isArray(detail.episodes)?detail.episodes:[];if(!episodes.length)throw new Error("No versions or episodes were returned.");
  selected=Math.min(requested,episodes.length-1);$("#downloadTitle").textContent=detail.title||"Download";$("#downloadSubtitle").textContent=episodes[selected].label||("Episode "+(selected+1));
  $("#downloadCount").textContent=episodes.length+" Episodes / Versions";$("#downloadType").textContent=episodes.length>1?"Full Drama":"Single Video";
  if(detail.poster&&/^(?:https?:\/\/|\/api\/)/i.test(detail.poster)){const p=$("#downloadPoster");p.src=detail.poster;p.hidden=false;}
  $("#downloadBack").href="watch.html?path="+encodeURIComponent(path);
  renderEpisodeList();
  await loadStreamSources(selected);updateSources();renderEpisodeList();
 }catch(e){$("#downloadTitle").textContent="Download unavailable";$("#downloadStatus").textContent=e.message||"Could not load download options.";}
}
load();
})();