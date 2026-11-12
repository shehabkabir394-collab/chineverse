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
  const section=document.createElement("section");section.className="download-options external-video-sources";
  section.innerHTML='<div class="video-heading"><div><p class="eyebrow">AUTHORIZED EXTERNAL SOURCES</p><h2>Watch / Download options</h2></div></div><div class="download-link-list">'+sources.map((s,i)=>'<article class="download-link-card"><div><b>'+esc(s.provider||s.source_type.toUpperCase())+'</b><small>'+esc(s.quality||"Auto")+' · '+esc(s.source_type)+'</small>'+(s.attribution_required&&s.attribution_text?'<small>'+esc(s.attribution_text)+'</small>':"")+'</div><div class="buttons">'+(safe(s.watch_url)?'<a class="btn primary" href="'+esc(s.watch_url)+'" target="_blank" rel="noopener noreferrer">▶ Watch</a>':"")+(safe(s.download_url)?'<a class="btn ghost" href="'+esc(s.download_url)+'" target="_blank" rel="noopener noreferrer">⬇ Download</a>':"")+'</div></article>').join("")+'</div>';
  hero.insertAdjacentElement("afterend",section);return true;
 }
 const start=()=>{const root=document.querySelector("#detail");if(!root)return;const observer=new MutationObserver(()=>{render().then(done=>{if(done)observer.disconnect()})});observer.observe(root,{childList:true,subtree:true});render().then(done=>{if(done)observer.disconnect()})};
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
})();
