(()=> {
  const $ = s => document.querySelector(s), grid = $("#grid"), status = $("#status");
  let movies = [], category = "", lang = "en", page = 1;
  const PAGE_SIZE = 24;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const safeUrl = s => /^https:\/\//i.test(s || "") ? s : "";
  const typeLabel = m => m.media_type === "series" ? "SERIES" : m.media_type === "anime" ? "ANIME" : "MOVIE";
  function card(m) {
    const p = safeUrl(m.poster_url), external = m.source === "tmdb", href = external ? safeUrl(m.tmdb_url) : "movie.html?id=" + encodeURIComponent(m.id);
    return `<article class="movie-card"><a class="poster" href="${esc(href)}" ${external ? 'target="_blank" rel="noopener noreferrer"' : ""} aria-label="View ${esc(m.title)} details">${p ? `<img loading="lazy" src="${esc(p)}" alt="${esc(m.title)} poster">` : '<div class="poster-placeholder"><b>CV</b><small>CINEMA UNIVERSE</small></div>'}<span class="quality">${esc(m.quality || "HD")}</span><span class="type-pill">${external ? "DISCOVER" : typeLabel(m)}</span><span class="overlay">▶<small>${external ? "TMDB details" : "View details"}</small></span></a><div class="movie-info"><h3><a href="${esc(href)}" ${external ? 'target="_blank" rel="noopener noreferrer"' : ""}>${esc(m.title)}</a></h3><p>${esc(m.release_year || "Year unknown")} · ${esc((m.genre || "").split(",")[0] || "Movie")}</p><p class="card-rating">${m.rating != null ? "★ " + esc(m.rating) : ""} ${m.language ? "· " + esc(m.language) : ""}</p></div></article>`;
  }
  function filtered() {
    const q=$("#search").value.toLowerCase().trim(), g=$("#genre").value, l=$("#language").value, z=$("#quality").value, k=$("#kind").value;
    let a=movies.filter(m=>(!q||[m.title,m.genre,m.language,m.release_year,m.description,m.cast_members,m.tags].join(" ").toLowerCase().includes(q))&&(!category||[m.genre,m.language,m.quality,m.tags].join(" ").toLowerCase().includes(category.toLowerCase()))&&(!g||(m.genre||"").toLowerCase().includes(g.toLowerCase()))&&(!l||m.language===l)&&(!z||m.quality===z)&&(!k||m.media_type===k));
    const sort=$("#sort").value;
    if(sort==="year")a.sort((x,y)=>(y.release_year||0)-(x.release_year||0));
    else if(sort==="rating")a.sort((x,y)=>(y.rating||0)-(x.rating||0));
    else if(sort==="az")a.sort((x,y)=>x.title.localeCompare(y.title));
    else a.sort((x,y)=>new Date(y.created_at||0)-new Date(x.created_at||0));
    return a;
  }
  function render() {
    const all=filtered(), shown=all.slice(0,page*PAGE_SIZE);
    grid.innerHTML=shown.map(card).join("");
    $("#count").textContent=all.length ? all.length+" titles" : "";
    $("#empty").classList.toggle("hidden",all.length>0);
    $("#loadMore").classList.toggle("hidden",shown.length>=all.length||!all.length);
    status.textContent=all.length ? (movies.some(m=>m.source==="tmdb") ? "Movie discovery catalogue · TMDB metadata" : "Explore your collection") : "No titles found. Try another search or category.";
    $("#reset").onclick=reset;
  }
  function reset() {
    ["#search","#genre","#language","#quality","#kind"].forEach(s=>$(s).value="");
    category=""; page=1;
    $("#chips").querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("selected",!x.dataset.filter));
    render();
  }
  function fillFilters() {
    const genres=[...new Set(movies.flatMap(m=>(m.genre||"").split(",").map(x=>x.trim()).filter(Boolean)))].sort();
    const languages=[...new Set(movies.flatMap(m=>(m.language||"").split(",").map(x=>x.trim()).filter(Boolean)))].sort();
    $("#genre").innerHTML='<option value="">All genres</option>'+genres.map(x=>`<option>${esc(x)}</option>`).join("");
    $("#language").innerHTML='<option value="">All languages</option>'+languages.map(x=>`<option>${esc(x)}</option>`).join("");
  }
  async function load() {
    $("#year").textContent=new Date().getFullYear();
    const localPromise = window.cineverseSupabase
      ? window.cineverseSupabase.from("movies").select("id,title,release_year,genre,language,quality,description,poster_url,backdrop_url,trailer_url,download_url,published,created_at,media_type,rating,cast_members,runtime_minutes,content_status,seasons,episodes,tags,tmdb_id").eq("published",true).order("created_at",{ascending:false})
      : Promise.resolve({data:[],error:null});
    const categorySelect=$("#discoverCategory");
    const discoverCategory=categorySelect ? categorySelect.value : "popular";
    const [localResult, discoverResult] = await Promise.all([
      localPromise,
      fetch("/api/tmdb-discover?category="+encodeURIComponent(discoverCategory)).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||"TMDB discovery unavailable");return d;}).catch(e=>({movies:[],error:e.message}))
    ]);
    const local=localResult?.data||[];
    const localIds=new Set(local.filter(m=>m.tmdb_id!=null).map(m=>String(m.tmdb_id)));
    const localKeys=new Set(local.map(m=>(m.title||"").trim().toLowerCase()+"|"+(m.release_year||"")));
    const discovered=(discoverResult.movies||[]).filter(m=>!localIds.has(String(m.tmdb_id))&&!localKeys.has((m.title||"").trim().toLowerCase()+"|"+(m.release_year||"")));
    movies=[...local,...discovered];
    if(localResult?.error) status.textContent="Database unavailable; showing public movie discovery if configured.";
    if(discoverResult.error && !local.length) status.textContent=discoverResult.error;
    fillFilters(); render();
  }
  $("#search").oninput=()=>{page=1;render();};
  ["#genre","#language","#quality","#kind","#sort"].forEach(s=>$(s).onchange=()=>{page=1;render();});
  if($("#discoverCategory")) $("#discoverCategory").onchange=()=>{page=1;load();};
  $("#chips").onclick=e=>{const b=e.target.closest("[data-filter]");if(!b)return;category=b.dataset.filter;page=1;$("#chips").querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("selected",x===b));render();};
  document.querySelectorAll("nav [data-filter]").forEach(a=>a.onclick=()=>{category=a.dataset.filter;page=1;render();});
  document.querySelectorAll("nav [data-kind]").forEach(a=>a.onclick=()=>{$("#kind").value=a.dataset.kind;page=1;render();});
  $("#loadMore").onclick=()=>{page++;render();};
  $("#lang").onclick=()=>{lang=lang==="en"?"bn":"en";document.documentElement.lang=lang;$(".hero-copy>p:not(.eyebrow)").textContent=lang==="bn"?"মুভি, ওয়েব সিরিজ ও অ্যানিমে খুঁজুন। Genre, রেটিং ও কোয়ালিটি ফিল্টার ব্যবহার করুন।":"Discover movies, series and anime. Explore genres, ratings and quality options.";$(".hero-copy .primary").textContent=lang==="bn"?"▶ ক্যাটালগ দেখুন":"▶ Explore Catalog";$("#lang").textContent=lang==="bn"?"English":"বাংলা";};
  $("#close").onclick=()=>$("#dialog").close();
  $("#dialog").onclick=e=>{if(e.target===$("#dialog"))$("#dialog").close();};
  load();
})();