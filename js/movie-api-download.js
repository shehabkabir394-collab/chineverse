(()=> {
"use strict";
const $=s=>document.querySelector(s),params=new URLSearchParams(location.search),path=params.get("path")||"",requested=Math.max(0,Number(params.get("episode"))||0);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safeName=s=>String(s||"MovieStreamBD").replace(/[\\/:*?"<>|]+/g," ").replace(/\s+/g," ").trim().slice(0,100)||"MovieStreamBD";
let episodes=[],selected=requested,detail=null,downloadable=[];
function getSources(ep){
 const raw=[...(Array.isArray(ep?.sources)?ep.sources:[])];
 const fromButtons=Array.isArray(ep?.downloadButtons)?ep.downloadButtons.map(b=>({url:b.downloadUrl||b.url,quality:b.quality||b.label,type:b.type||"mp4",audioLanguage:b.audioLanguage||b.language})):[];
 raw.push(...fromButtons);
 return raw.filter(s=>{
  try{const rawUrl=s.downloadUrl||s.url;const u=new URL(rawUrl);return u.protocol==="https:"&&Number.parseInt(String(s.quality||s.resolution||s.label||"").match(/\d{3,4}/)?.[0]||0)>0;}
  catch{return false;}
 }).map(s=>({url:s.downloadUrl||s.url,quality:(Number.parseInt(String(s.quality||s.resolution||s.label||"").match(/\d{3,4}/)?.[0]||0))+"p",type:String(s.type||""),language:String(s.audioLanguage||s.dubLanguage||s.language||s.lang||s.audio||s.label||""),downloadable:!(/m3u8/i.test(String(s.type||""))||/\.m3u8(?:$|[?#])/i.test(s.url))}))
 .sort((a,b)=>Number(b.quality.replace("p",""))-Number(a.quality.replace("p","")));
}
function updateSources(){
 const ep=episodes[selected];downloadable=getSources(ep).filter(s=>s.downloadable);
 const quality=$("#downloadQuality"),action=$("#downloadAction"),status=$("#downloadStatus");
 quality.innerHTML=downloadable.length?downloadable.map((s,i)=>'<option value="'+i+'">'+esc(s.quality)+(s.language?" · "+esc(s.language):"")+'</option>').join(""):'<option value="">No direct download quality</option>';
 quality.disabled=!downloadable.length;
 if(downloadable.length){
  action.href=downloadable[0].url;action.setAttribute("aria-disabled","false");action.textContent="⬇ Download "+downloadable[0].quality;
  action.setAttribute("download",safeName(detail?.title)+"-"+safeName(ep?.label||("Episode "+(selected+1)))+"-"+downloadable[0].quality+".mp4");
  status.textContent="Available direct download quality: "+downloadable.map(s=>s.quality).join(" · ");
 }else{
  action.href="#";action.removeAttribute("download");action.setAttribute("aria-disabled","true");action.textContent="Download unavailable";
  status.textContent="এই Episode/Version-এর জন্য সরাসরি MP4 download source পাওয়া যায়নি।";
 }
}
$("#downloadQuality").addEventListener("change",()=>{
 const s=downloadable[Number($("#downloadQuality").value)];if(!s)return;
 const ep=episodes[selected],action=$("#downloadAction");
 action.href=s.url;action.setAttribute("aria-disabled","false");
 action.textContent="⬇ Download "+s.quality;
 action.setAttribute("download",safeName(detail?.title)+"-"+safeName(ep?.label||("Episode "+(selected+1)))+"-"+s.quality+".mp4");
});
$("#downloadEpisode").addEventListener("change",async()=>{selected=Number($("#downloadEpisode").value)||0;await loadStreamSources();updateSources();});
async function loadStreamSources(){
 const ep=episodes[selected],subjectId=detail?.subjectId||detail?.subject_id||detail?.id||detail?.subject?.subjectId;
 if(!subjectId)return;
 try{const r=await fetch("/api/movie-api/stream?subjectId="+encodeURIComponent(subjectId)+"&se="+encodeURIComponent(ep?.se??0)+"&ep="+encodeURIComponent(ep?.ep??selected),{cache:"no-store"});const data=await r.json();if(!r.ok||data?.ok===false)throw new Error(data?.error||"Stream sources unavailable");
  const buttons=Array.isArray(data.downloadButtons)?data.downloadButtons:[];const sources=Array.isArray(data.sources)?data.sources:[];
  ep.downloadButtons=buttons;ep.sources=[...(ep.sources||[]),...sources.map(s=>({...s,url:s.downloadUrl||s.url}))];
 }catch(e){console.warn("Download source lookup:",e.message);}
}
async function load(){
 if(!/^\/mb\/[a-zA-Z0-9_./-]{1,300}$/.test(path)){ $("#downloadStatus").textContent="Invalid title link.";return; }
 try{
  const r=await fetch("/api/movie-api/details?path="+encodeURIComponent(path),{cache:"no-store"}),data=await r.json();
  if(!r.ok||!data.detail)throw new Error(data.error||"Title details unavailable.");
  detail=data.detail;episodes=Array.isArray(detail.episodes)?detail.episodes:[];
  if(!episodes.length)throw new Error("No versions or episodes were returned.");
  selected=Math.min(requested,episodes.length-1);
  $("#downloadTitle").textContent=detail.title||"Download";
  $("#downloadSubtitle").textContent=episodes[selected].label||("Version "+(selected+1));
  if(detail.poster&&/^https:\/\//i.test(detail.poster)){const p=$("#downloadPoster");p.src=detail.poster;p.hidden=false;}
  $("#downloadBack").href="watch.html?path="+encodeURIComponent(path);
  if(episodes.length>1){
   const wrap=$("#downloadEpisodeWrap"),select=$("#downloadEpisode");
   wrap.hidden=false;
   select.innerHTML=episodes.map((ep,i)=>'<option value="'+i+'" '+(i===selected?"selected":"")+'>'+esc(ep.label||("Episode "+(ep.number||i+1)))+'</option>').join("");
  }
  $("#downloadEpisode").addEventListener("change",()=>{$("#downloadSubtitle").textContent=episodes[selected]?.label||("Version "+(selected+1));});
  await loadStreamSources();
  updateSources();
 }catch(e){$("#downloadTitle").textContent="Download unavailable";$("#downloadStatus").textContent=e.message||"Could not load download options.";}
}
$("#downloadAction").addEventListener("click",e=>{if($("#downloadAction").getAttribute("aria-disabled")==="true"){e.preventDefault();return;}});
load();
})();