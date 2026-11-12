(()=> {
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const safe=s=>/^https:\/\//i.test(s||"")?s:"";
 async function render(){
  const root=document.querySelector("#detail"),hero=root?.querySelector(".detail-hero"),id=new URLSearchParams(location.search).get("id");
  if(!hero||!id||!window.cineverseSupabase||root.dataset.externalSourcesLoaded)return false;
  root.dataset.externalSourcesLoaded="1";
  const {data,error}=await window.cineverseSupabase.from("movie_video_sources").select("id,source_type,provider,quality,watch_url,download_url,attribution_required,attribution_text").eq("movie_id",id).eq("is_active",true).eq("rights_verified",true).order("created_at",{ascending:false});
  if(error||!data?.length)return true;
  const sources=data.filter(s=>safe(s.watch_url)||safe(s.download_url));if(!sources.length)return true;
  const section=document.createElement("section");section.className="download-options external-video-sources";section.id="externalVideoSources";
  section.innerHTML='<div class="video-heading"><div><p class="eyebrow">AUTHORIZED EXTERNAL SOURCES</p><h2>Watch / Download options</h2></div></div><div class="download-link-list">'+sources.map((s,i)=>'<article class="download-link-card"><div><b>'+esc(s.provider||s.source_type.toUpperCase())+'</b><small>'+esc(s.quality||"Auto")+' · '+esc(s.source_type)+'</small>'+(s.attribution_required&&s.attribution_text?'<small>'+esc(s.attribution_text)+'</small>':"")+'</div><div class="buttons">'+(safe(s.watch_url)?'<button class="btn primary" type="button" data-external-play="'+i+'">▶ Play here</button><a class="btn ghost" href="'+esc(s.watch_url)+'" target="_blank" rel="noopener noreferrer">Open source ↗</a>':"")+(safe(s.download_url)?'<a class="btn ghost" href="'+esc(s.download_url)+'" target="_blank" rel="noopener noreferrer">⬇ Download</a>':"")+'</div></article>').join("")+'</div><div id="externalSourcePlayer" class="video-section hidden"></div>';
  hero.insertAdjacentElement("afterend",section);
  section.querySelectorAll("[data-external-play]").forEach(button=>button.addEventListener("click",()=>{
   const source=sources[Number(button.dataset.externalPlay)],url=safe(source?.watch_url);if(!url)return;
   const host=section.querySelector("#externalSourcePlayer");host.classList.remove("hidden");
   if(source.source_type==="embed"){
    host.innerHTML='<div class="video-heading"><h3>'+esc(source.provider||"External player")+' · '+esc(source.quality||"Auto")+'</h3></div><iframe title="Authorized external video player" src="'+esc(url)+'" loading="lazy" referrerpolicy="no-referrer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;border-radius:14px;background:#000"></iframe>';
   }else{
    host.innerHTML='<div class="video-heading"><h3>'+esc(source.provider||"Video source")+' · '+esc(source.quality||"Auto")+'</h3></div><video controls playsinline preload="metadata" style="width:100%;max-height:70vh;border-radius:14px;background:#000" src="'+esc(url)+'">Your browser cannot play this video. Use Open source instead.</video>';
   }
   host.scrollIntoView({behavior:"smooth",block:"center"});
  }));
  return true;
 }
 const start=()=>{const root=document.querySelector("#detail");if(!root)return;const observer=new MutationObserver(()=>{render().then(done=>{if(done)observer.disconnect()})});observer.observe(root,{childList:true,subtree:true});render().then(done=>{if(done)observer.disconnect()})};
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
})();
