(()=> {
  const $ = s => document.querySelector(s), grid = $("#grid"), status = $("#status");
  let movies=[], localMovies=[], category="", lang="en", page=1, remotePage=1, remotePages=1, busy=false, searchTimer=null, searchMode=false;
  const PAGE_SIZE=24;
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const safeUrl=s=>/^https:\/\//i.test(s||"")?s:"";
  const hasPlayableLink=(m,assetIds)=>[m.video_url,m.watch_url,m.download_url].some(safeUrl)||(Array.isArray(m.download_links)&&m.download_links.some(x=>safeUrl(x?.url)))||assetIds.has(m.id);
  const typeLabel=m=>"DRAMA";
  const countryAliases={Korean:["korean","korea","south korea","k-drama","korean drama","한국"],Chinese:["chinese","china","c-drama","chinese drama","中国"],Japanese:["japanese","japan","j-drama","japanese drama","日本"],Thai:["thai","thailand","thai drama","lakorn"]};
  function dramaCountry(m){const text=[m.language,m.tags].filter(Boolean).join(" ").toLowerCase();for(const [country,aliases] of Object.entries(countryAliases)){if(aliases.some(alias=>text.includes(alias)))return country;}return "";}
  function card(m){
    const p=safeUrl(m.poster_url),external=m.source==="tmdb",href=external?"tmdb-movie.html?id="+encodeURIComponent(m.tmdb_id):("series.html?id=")+encodeURIComponent(m.id);
    return `<article class="movie-card"><a class="poster" href="${esc(href)}" aria-label="View ${esc(m.title)} details">${p?`<img loading="lazy" src="${esc(p)}" alt="${esc(m.title)} poster">`:'<div class="poster-placeholder"><b>OD</b><small>ONLY DRAMA</small></div>'}<span class="quality">${esc(m.quality||"HD")}</span><span class="type-pill">${typeLabel(m)}</span><span class="overlay">▶<small>View details</small></span></a><div class="movie-info"><h3><a href="${esc(href)}">${esc(m.title)}</a></h3><p>${esc(m.release_year||"Year unknown")} · ${esc((m.genre||"").split(",")[0]||"Drama")}</p><p class="card-rating">${m.rating!=null?"★ "+esc(m.rating):""} ${m.language?"· "+esc(m.language):""}</p></div></article>`;
  }
  function filtered(){
    const q=$("#search").value.toLowerCase().trim(),g=$("#genre").value,l=$("#language").value,z=$("#quality").value;
    let a=movies.filter(m=>m.media_type==="series"&&(!q||[m.title,m.genre,m.language,m.release_year,m.description,m.cast_members,m.tags].join(" ").toLowerCase().includes(q))&&(!category||(countryAliases[category]?dramaCountry(m)===category:(m.genre||"").toLowerCase().includes(category.toLowerCase())))&&(!g||(m.genre||"").toLowerCase().includes(g.toLowerCase()))&&(!l||m.language===l)&&(!z||m.quality===z));
    const sort=$("#sort").value;
    if(sort==="year")a.sort((x,y)=>(y.release_year||0)-(x.release_year||0));
    else if(sort==="rating")a.sort((x,y)=>(y.rating||0)-(x.rating||0));
    else if(sort==="az")a.sort((x,y)=>x.title.localeCompare(y.title));
    else a.sort((x,y)=>new Date(y.created_at||0)-new Date(x.created_at||0));
    return a;
  }
  function render(){
    const all=filtered(),shown=all.slice(0,page*PAGE_SIZE);
    grid.innerHTML=shown.map(card).join("");
    $("#count").textContent=all.length?all.length+" titles":"";
    $("#empty").classList.toggle("hidden",all.length>0);
    const canLoad=shown.length<all.length;
    $("#loadMore").classList.toggle("hidden",!all.length||(!canLoad&&shown.length>=all.length));
    $("#loadMore").textContent=busy?"Loading…":"Show more";
    if(!busy)status.textContent=all.length?"Only Drama · Asian drama titles with authorized watch/download links":"No dramas with authorized watch or download links found.";
    $("#reset").onclick=reset;
  }
  function reset(){
    ["#search","#genre","#language","#quality"].forEach(s=>$(s).value="");
    category="";page=1;searchMode=false;movies=[...localMovies];
    $("#chips").querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("selected",!x.dataset.filter));render();
  }
  function fillFilters(){
    const genres=[...new Set(movies.flatMap(m=>(m.genre||"").split(",").map(x=>x.trim()).filter(Boolean)))].sort();
    const languages=[...new Set(movies.flatMap(m=>(m.language||"").split(",").map(x=>x.trim()).filter(Boolean)))].sort();
    $("#genre").innerHTML='<option value="">All genres</option>'+genres.map(x=>`<option>${esc(x)}</option>`).join("");
    $("#language").innerHTML='<option value="">All languages</option>'+languages.map(x=>`<option>${esc(x)}</option>`).join("");
  }
  let discoverPage=1,discoverPages=1,discoverMovies=[];
  const dedupe=list=>{const seen=new Set();return list.filter(m=>{const k=m.tmdb_id?"tmdb:"+m.tmdb_id:(m.title||"").toLowerCase()+"|"+(m.release_year||"");if(seen.has(k))return false;seen.add(k);return true})};
  async function getJson(url){const r=await fetch(url);const d=await r.json();if(!r.ok)throw Error(d.error||"Catalog request failed");return d}
  async function load(){
    $("#year").textContent=new Date().getFullYear();status.textContent="Loading Only Drama…";
    const localResult=window.cineverseSupabase
      ? await window.cineverseSupabase.from("movies").select("id,title,release_year,genre,language,quality,description,poster_url,backdrop_url,trailer_url,watch_url,video_url,download_url,download_links,published,created_at,media_type,rating,cast_members,runtime_minutes,content_status,seasons,episodes,tags,tmdb_id").eq("published",true).order("created_at",{ascending:false})
      : {data:[],error:null};
    const {data:importRows,error:importError}=window.cineverseSupabase
      ? await window.cineverseSupabase.rpc("cineverse_public_server_import_movie_ids")
      : {data:[],error:null};
    const importedIds=new Set((importRows||[]).map(x=>x.movie_id).filter(Boolean));
    // Also show published catalog titles with an active, rights-verified external source.
    // Public RLS exposes only verified active sources belonging to published movies.
    const {data:externalRows,error:externalError}=window.cineverseSupabase
      ? await window.cineverseSupabase.from("movie_video_sources").select("movie_id").eq("is_active",true).eq("rights_verified",true)
      : {data:[],error:null};
    const visibleIds=new Set([...importedIds,...(externalRows||[]).map(x=>x.movie_id).filter(Boolean)]);
    localMovies=(localResult?.data||[]).filter(m=>visibleIds.has(m.id));
    movies=[...localMovies];discoverMovies=[];discoverPage=1;discoverPages=1;
    fillFilters();render();
    if(importError)status.textContent="Could not verify server-uploaded titles. Apply the latest Supabase migration.";
    else if(localResult?.error)status.textContent="Could not load Only Drama collection.";
    else if(externalError)status.textContent="Could not load external source titles. Check the external video sources migration and public read policy.";
    else if(!localMovies.length)status.textContent="No published dramas with an active authorized video source were found.";
  }
  async function loadMore(){
    if(busy)return;
    busy=true;render();
    page++;
    busy=false;render();
  }
  async function remoteSearch(){
    page=1;searchMode=false;movies=[...localMovies];render();
  }
  $("#search").oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(remoteSearch,450);};
  ["#genre","#language","#quality","#sort"].forEach(s=>$(s).onchange=()=>{page=1;render();});
  if($("#discoverCategory"))$("#discoverCategory").onchange=()=>{page=1;searchMode=false;$("#search").value="";load();};
  $("#chips").onclick=e=>{const b=e.target.closest("[data-filter]");if(!b)return;category=b.dataset.filter;page=1;$("#chips").querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("selected",x===b));render();};
  document.querySelectorAll("nav [data-filter]").forEach(a=>a.onclick=()=>{category=a.dataset.filter;page=1;$("#chips").querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("selected",x.dataset.filter===category));render();});

  $("#loadMore").onclick=loadMore;
  $("#lang").onclick=()=>{lang=lang==="en"?"bn":"en";document.documentElement.lang=lang;$(".hero-copy>p:not(.eyebrow)").textContent=lang==="bn"?"মুভি, ওয়েব সিরিজ ও অ্যানিমে খুঁজুন। Genre, রেটিং ও কোয়ালিটি ফিল্টার ব্যবহার করুন।":"Discover movies, series and anime. Explore genres, ratings and quality options.";$ (".hero-copy .primary").textContent=lang==="bn"?"▶ ক্যাটালগ দেখুন":"▶ Explore Catalog";$("#lang").textContent=lang==="bn"?"English":"বাংলা";};
  $("#close").onclick=()=>$("#dialog").close();$("#dialog").onclick=e=>{if(e.target===$("#dialog"))$("#dialog").close();};load();
})();