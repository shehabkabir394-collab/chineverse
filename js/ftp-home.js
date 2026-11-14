(()=> {
 const BRIDGE="https://search-would-screenshots-sphere.trycloudflare.com",ROOT="/FILE/Dubbed TV Series & Shows/";
 const $=s=>document.querySelector(s),esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const listOf=d=>Array.isArray(d)?d:(d.items||d.entries||d.files||d.results||d.children||[]);
 const nm=x=>x.name||x.filename||x.title||x.label||"";
 const pth=x=>x.path||x.full_path||x.href||ROOT.replace(/\/$/,"")+"/"+nm(x);
 const dir=x=>x.is_dir===true||x.is_directory===true||x.directory===true||x.type==="directory"||x.type==="dir"||x.kind==="directory"||x.is_dir==="true";
 const grid=$("#ftpHomeGrid"),status=$("#ftpHomeStatus");
 const clean=s=>String(s).replace(/\[[^\]]*\]/g," ").replace(/\([^)]*\)/g," ").replace(/\b(19|20)\d{2}\b/g," ").replace(/\b(dual audio|hindi dubbed|dubbed|season|complete|1080p|720p|480p|2160p|4k|web-dl|bluray|webrip|x264|x265|hevc)\b/gi," ").replace(/[._-]+/g," ").replace(/\s+/g," ").trim();
 function card(x,m){
  const name=nm(x),p=pth(x),meta=m||{},poster=meta.poster||"",title=meta.title||clean(name)||name;
  const href="ftp-series.html?path="+encodeURIComponent(p)+"&title="+encodeURIComponent(title)+(meta.id?"&tmdb="+encodeURIComponent(meta.id):"");
  return '<article class="movie-card"><a class="poster" href="'+href+'" aria-label="View '+esc(title)+' details">'+(poster?'<img loading="lazy" src="'+esc(poster)+'" alt="'+esc(title)+' poster">':'<div class="poster-placeholder ftp-auto-poster"><b>OD</b><strong>'+esc(title)+'</strong><small>ONLY DRAMA</small></div>')+'<span class="quality">FTP</span><span class="type-pill">DRAMA</span><span class="overlay">▶<small>View details</small></span></a><div class="movie-info"><h3><a href="'+href+'">'+esc(title)+'</a></h3><p>'+esc(meta.year||"FTP Library")+' · '+esc((meta.genres||[]).slice(0,1).join("")||"Drama")+'</p>'+(meta.rating!=null?'<p class="card-rating">★ '+esc(meta.rating)+'</p>':'')+'</div></article>';
 }
 async function enrich(folder){
  const title=clean(nm(folder));if(title.length<2)return {match:null};
  const key="od-ftp-tv-"+title.toLowerCase();
  try{const cached=localStorage.getItem(key);if(cached)return JSON.parse(cached)}catch{}
  try{const r=await fetch("/api/tmdb-tv-search?q="+encodeURIComponent(title));const d=r.ok?await r.json():{match:null};try{localStorage.setItem(key,JSON.stringify(d))}catch{}return d}catch{return {match:null}}
 }
 async function load(){
  status.innerHTML='<span class="muted">FTP drama catalog loading…</span>';grid.innerHTML="";
  try{
   const r=await fetch(BRIDGE+"/api/list?path="+encodeURIComponent(ROOT),{cache:"no-store"});if(!r.ok)throw Error("FTP HTTP "+r.status);
   const folders=listOf(await r.json()).filter(dir).sort((a,b)=>nm(a).localeCompare(nm(b)));
   if(!folders.length){status.textContent="No drama folders found in FTP.";return}
   // Show every folder immediately with a branded poster; TMDB enrichment runs in background.
   grid.innerHTML=folders.map(f=>card(f,null)).join("");
   status.innerHTML='<span class="muted">'+folders.length+' dramas found · loading posters…</span>';
   let cursor=0,done=0;
   async function worker(){
    while(cursor<folders.length){
     const i=cursor++,result=await enrich(folders[i]);
     if(result?.match&&grid.children[i])grid.children[i].outerHTML=card(folders[i],result.match);
     done++;
     status.innerHTML='<span class="muted">'+folders.length+' FTP dramas · checking posters '+done+'/'+folders.length+'</span>';
    }
   }
   await Promise.all(Array.from({length:Math.min(4,folders.length)},worker));
   status.innerHTML='<span class="muted">'+folders.length+' FTP dramas · posters and details matched from TMDB where available</span>';
  }catch(e){status.innerHTML='<span class="muted">FTP catalog load failed: '+esc(e.message)+'. Laptop Bridge ও Tunnel চালু আছে কি না দেখো।</span>'}
 }
 $("#ftpHomeRefresh").onclick=()=>{try{Object.keys(localStorage).filter(k=>k.startsWith("od-ftp-tv-")).forEach(k=>localStorage.removeItem(k))}catch{}load()};
 load();
})();