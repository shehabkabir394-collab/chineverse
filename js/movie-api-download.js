(()=> {
"use strict";
const $=s=>document.querySelector(s),params=new URLSearchParams(location.search),path=params.get("path")||"",requested=Math.max(0,Number(params.get("episode"))||0);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safeName=s=>String(s||"MovieStreamBD").replace(/[\\/:*?"<>|]+/g," ").replace(/\s+/g," ").trim().slice(0,100)||"MovieStreamBD";
let episodes=[],selected=requested,detail=null,downloadable=[];
function getSources(ep){
 return (Array.isArray(ep?.sources)?ep.sources:[]).filter(s=>{
  try{const u=new URL(s.url);return u.protocol==="https:"&&u.hostname==="hd-w0l1.onrender.com"&&Number(s.quality)>0;}
  catch{return false;}
 }).map(s=>({url:s.url,quality:Number(s.quality)+"p",type:String(s.type||""),language:String(s.audioLanguage||s.dubLanguage||s.language||s.lang||s.audio||s.label||""),downloadable:!(/m3u8/i.test(String(s.type||""))||/\.m3u8(?:$|[?#])/i.test(s.url))}))
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
$("#downloadEpisode").addEventListener("change",()=>{selected=Number($("#downloadEpisode").value)||0;updateSources();});
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
  updateSources();
 }catch(e){$("#downloadTitle").textContent="Download unavailable";$("#downloadStatus").textContent=e.message||"Could not load download options.";}
}
$("#downloadAction").addEventListener("click",e=>{if($("#downloadAction").getAttribute("aria-disabled")==="true"){e.preventDefault();return;}});
load();
})();