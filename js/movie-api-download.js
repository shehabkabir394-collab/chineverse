(()=> {
"use strict";
const $=s=>document.querySelector(s),params=new URLSearchParams(location.search),path=params.get("path")||"",requested=Math.max(0,Number(params.get("episode"))||0);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const safeName=s=>String(s||"MovieStreamBD").replace(/[\\/:*?"<>|]+/g," ").replace(/\s+/g," ").trim().slice(0,100)||"MovieStreamBD";
let episodes=[],selected=requested,detail=null,downloadable=[],busy=false;
const seasonKey=item=>String(item?.seasonName||item?.seasonTitle||item?.seasonNumber||item?.season||"1");
function episodeCoords(item,index){
 const same=episodes.slice(0,index).filter(x=>seasonKey(x)===seasonKey(item)).length;
 const rawSeason=item?.se??item?.seasonIndex, rawEpisode=item?.ep??item?.episodeIndex;
 const se=rawSeason!=null?Number(rawSeason):item?.seasonNumber!=null?Math.max(0,Number(item.seasonNumber)-1):0;
 const ep=rawEpisode!=null?Number(rawEpisode):item?.episodeNumber!=null?Math.max(0,Number(item.episodeNumber)-1):item?.number!=null?Math.max(0,Number(item.number)-1):same;
 return {se:Math.max(0,Math.floor(se)||0),ep:Math.max(0,Math.floor(ep)||0)};
}
function getSources(ep){
 const raw=[...(Array.isArray(ep?.sources)?ep.sources:[])];
 raw.push(...(Array.isArray(ep?.downloadButtons)?ep.downloadButtons.map(b=>({url:b.downloadUrl||b.url,quality:b.quality||b.label,type:b.type||"mp4",audioLanguage:b.audioLanguage||b.language})):[]));
 return raw.filter(s=>{try{const u=new URL(s.downloadUrl||s.url);return u.protocol==="https:"&&Number.parseInt(String(s.quality||s.resolution||s.label||"").match(/\d{3,4}/)?.[0]||0)>0;}catch{return false;}})
 .map(s=>({url:s.downloadUrl||s.url,quality:(String(s.quality||s.resolution||s.label||"").match(/\d{3,4}/)||[])[0]+"p",language:String(s.audioLanguage||s.dubLanguage||s.language||s.lang||s.audio||""),type:String(s.type||"")}))
 .filter(s=>s.quality!=="p"&&!/m3u8/i.test(s.type)&&!/\.m3u8(?:$|[?#])/i.test(s.url))
 .sort((a,b)=>Number(b.quality.replace("p",""))-Number(a.quality.replace("p","")));
}
function selectedQuality(){return downloadable[Number($("#downloadQuality").value)]?.quality?.replace("p","")||"";}
function updateSources(){
 const ep=episodes[selected];downloadable=getSources(ep);
 const quality=$("#downloadQuality"),action=$("#downloadAction"),status=$("#downloadStatus");
 quality.innerHTML=downloadable.length?downloadable.map((s,i)=>'<option value="'+i+'">'+esc(s.quality)+(s.language?" · "+esc(s.language):"")+'</option>').join(""):'<option value="">No direct MP4 quality</option>';
 quality.disabled=!downloadable.length;
 if(downloadable.length){
  action.href=downloadable[0].url;action.setAttribute("aria-disabled","false");action.textContent="⬇ Download "+downloadable[0].quality;
  action.setAttribute("download",safeName(detail?.title)+"-"+safeName(ep?.label||("Episode "+(selected+1)))+"-"+downloadable[0].quality+".mp4");
  status.textContent="Available direct download quality: "+downloadable.map(s=>s.quality).join(" · ");
 }else{
  action.href="#";action.removeAttribute("download");action.setAttribute("aria-disabled","true");action.textContent="Download unavailable";
  status.textContent="এই Episode/Version-এর জন্য সরাসরি MP4 download source পাওয়া যায়নি।";
 }
 $("#downloadZip").hidden=episodes.length<2||!detail?.subjectId&&!detail?.subject_id&&!detail?.id&&!detail?.subject?.subjectId;
}
async function loadStreamSources(index){
 const ep=episodes[index],subjectId=detail?.subjectId||detail?.subject_id||detail?.subject?.subjectId||detail?.subject?.id||detail?.id;
 if(!subjectId)return;
 try{const r=await fetch("/api/movie-api/stream?subjectId="+encodeURIComponent(subjectId)+"&se="+encodeURIComponent(episodeCoords(ep,index).se)+"&ep="+encodeURIComponent(episodeCoords(ep,index).ep),{cache:"no-store"});const data=await r.json();if(!r.ok||data?.ok===false)throw new Error(data?.error||"Stream sources unavailable");
 ep.downloadButtons=Array.isArray(data.downloadButtons)?data.downloadButtons:[];
 ep.sources=[...(ep.sources||[]),...(Array.isArray(data.sources)?data.sources.map(s=>({...s,url:s.downloadUrl||s.url})):[])];
 }catch(e){console.warn("Download source lookup:",e.message);}
}
$("#downloadQuality").addEventListener("change",()=>{
 const s=downloadable[Number($("#downloadQuality").value)];if(!s)return;
 const ep=episodes[selected],action=$("#downloadAction");
 action.href=s.url;action.setAttribute("aria-disabled","false");action.textContent="⬇ Download "+s.quality;
 action.setAttribute("download",safeName(detail?.title)+"-"+safeName(ep?.label||("Episode "+(selected+1)))+"-"+s.quality+".mp4");
});
$("#downloadEpisode").addEventListener("change",async()=>{selected=Number($("#downloadEpisode").value)||0;$("#downloadSubtitle").textContent=episodes[selected]?.label||("Episode "+(selected+1));await loadStreamSources(selected);updateSources();});
$("#downloadZip").addEventListener("click",async()=>{
 if(busy)return;
 const subjectId=detail?.subjectId||detail?.subject_id||detail?.subject?.subjectId||detail?.subject?.id||detail?.id,quality="best";
 if(!subjectId||!quality)return;
 if(!window.JSZip){$("#downloadStatus").textContent="ZIP library load হয়নি। Page refresh করে আবার চেষ্টা করুন।";return;}
 busy=true;const btn=$("#downloadZip"),progress=$("#zipProgress"),bar=$("#zipProgressBar"),label=$("#zipProgressText");
 btn.disabled=true;btn.textContent="⏳ ZIP তৈরি হচ্ছে…";progress.hidden=false;
 const zip=new JSZip(),folder=zip.folder(safeName(detail.title||"Drama")),failed=[];
 try{
  for(let i=0;i<episodes.length;i++){
   const item=episodes[i],coords=episodeCoords(item,i),se=coords.se,ep=coords.ep;
   label.textContent="Episode "+(i+1)+" / "+episodes.length+" ডাউনলোড হচ্ছে…";
   const url="/api/movie-api/download-file?subjectId="+encodeURIComponent(subjectId)+"&se="+encodeURIComponent(se)+"&ep="+encodeURIComponent(ep)+"&quality="+encodeURIComponent(quality);
   try{const response=await fetch(url);if(!response.ok)throw new Error("HTTP "+response.status);const blob=await response.blob();if(!blob.size)throw new Error("Empty file");
    const seasonName="Season "+String(se+1).padStart(2,"0"),episodeNo=String(Number(item.number||item.episodeNumber||i+1)).padStart(2,"0"),fileName=safeName(item.label||("Episode "+episodeNo))+"-"+quality+"p.mp4";
    folder.folder(seasonName).file(fileName,blob); 
   }catch(err){failed.push((item.label||"Episode "+(i+1))+": "+err.message);}
   bar.style.width=Math.round((i+1)/episodes.length*75)+"%";
  }
  if(!Object.keys(zip.files).length)throw new Error("কোনো Episode download করা যায়নি।");
  if(failed.length)folder.file("DOWNLOAD-REPORT.txt","যেসব Episode ডাউনলোড হয়নি:\n"+failed.join("\n"));
  label.textContent="ZIP ফাইল তৈরি হচ্ছে…";
  const blob=await zip.generateAsync({type:"blob",compression:"STORE"},meta=>{bar.style.width=(75+Math.round(meta.percent*.25))+"%";});
  const a=document.createElement("a"),objectUrl=URL.createObjectURL(blob);a.href=objectUrl;a.download=safeName(detail.title||"Drama")+"-Full-Drama.zip";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
  label.textContent="সম্পন্ন! "+(episodes.length-failed.length)+" / "+episodes.length+" Episode ZIP-এ যুক্ত হয়েছে"+(failed.length?" · "+failed.length+"টি বাদ গেছে":"");
  $("#downloadStatus").textContent=failed.length?"কিছু Episode source পাওয়া যায়নি। ZIP-এর DOWNLOAD-REPORT.txt দেখুন।":"Full Drama ZIP download শুরু হয়েছে।";
 }catch(err){label.textContent=err.message||"ZIP তৈরি করা যায়নি।";$("#downloadStatus").textContent="ZIP download ব্যর্থ হয়েছে। অন্য quality দিয়ে চেষ্টা করুন।";}
 finally{busy=false;btn.disabled=false;btn.textContent="📦 Download Full Drama ZIP";}
});
$("#downloadAction").addEventListener("click",e=>{if($("#downloadAction").getAttribute("aria-disabled")==="true"){e.preventDefault();return;}});
async function load(){
 if(!/^\/mb\/[a-zA-Z0-9_./-]{1,300}$/.test(path)){$("#downloadStatus").textContent="Invalid title link.";return;}
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
  if(episodes.length>1){const wrap=$("#downloadEpisodeWrap"),select=$("#downloadEpisode");wrap.hidden=false;select.innerHTML=episodes.map((ep,i)=>'<option value="'+i+'" '+(i===selected?"selected":"")+'>'+esc(ep.label||("Episode "+(ep.number||i+1)))+'</option>').join("");}
  await loadStreamSources(selected);updateSources();
 }catch(e){$("#downloadTitle").textContent="Download unavailable";$("#downloadStatus").textContent=e.message||"Could not load download options.";}
}
load();
})();