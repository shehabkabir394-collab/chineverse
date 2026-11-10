(()=> {
  const $ = s => document.querySelector(s), grid = $("#grid"), status = $("#status");
  let movies=[], localMovies=[], category="", lang="en", page=1, remotePage=1, remotePages=1, busy=false, searchTimer=null, searchMode=false;
  const PAGE_SIZE=24;
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const safeUrl=s=>/^https:\/\//i.test(s||"")?s:"";
  const typeLabel=m=>m.media_type==="series"?"SERIES":m.media_type==="anime"?"ANIME":"MOVIE";
  function card(m){
    const p=safeUrl(m.poster_url),external=m.source==="tmdb",href=external?"tmdb-movie.html?id="+encodeURIComponent(m.tmdb_id):"movie.html?id="+encodeURIComponent(m.id);
    return `<article class="movie-card"><a class="poster" href="${esc(href)}" aria-label="View ${esc(m.title)} details">${p?`<img loading="lazy" src="${esc(p)}" alt="${esc(m.title)} poster">`:'<div class="poster-placeholder"><b>CV</b><small>CINEMA UNIVERSE</small></div>'}<span class="quality">${esc(m.quality||"HD")}</span><span class="type-pill">${typeLabel(m)}</span><span class="overlay">▶<small>View details</small></span></a><div class="movie-info"><h3><a href="${esc(href)}">${esc(m.title)}</a></h3><p>${esc(m.release_year||"Year unknown")} · ${esc((m.genre||"").split(",")[0]||"Movie")}</p><p class="card-rating">${m.rating!=null?"★ "+esc(m.rating):""} ${m.language?"· "+esc(m.language):""}</p></div></article>`;
  }
  function filtered(){
    const q=$("#search").value.toLowerCase().trim(),g=$("#genre").value,l=$("#language").value,z=$("#quality").value,k=$("#kind").value;
    let a=movies.filter(m=>(!q||[m.title,m.genre,m.language,m.release_year,m.description,m.cast_members,m.tags].join(" ").toLowerCase().includes(q))&&(!category||[m.genre,m.language,m.quality,m.tags].join(" ").toLowerCase().includes(category.toLowerCase()))&&(!g||(m.genre||"").toLowerCase().includes(g.toLowerCase()))&&(!l||m.language===l)&&(!z||m.quality===z)&&(!k||m.media_type===k));
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
    const canLoad=searchMode?remotePage<remotePages:discoverPage<discoverPages;
    $("#loadMore").classList.toggle("hidden",!all.length||(!canLoad&&shown.length>=all.length));
    $("#loadMore").textContent=busy?"Loading…":(canLoad?"Load more movies":"Show more");
    if(!busy)status.textContent=all.length?(searchMode?"Search results · CineVerse + TMDB":"CineVerse collection · TMDB discovery"):"No titles found. Try another search or category.";
    $("#reset").onclick=reset;
  }
  function reset(){
    ["#search","#genre","#language","#quality","#kind"].forEach(s=>$(s).value="");
    category="";page=1;searchMode=false;movies=[...localMovies,...discoverMovies];
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
    $("#year").textContent=new Date().getFullYear();status.textContent="Loading CineVerse collection…";
    const categorySelect=$("#discoverCategory"),discoverCategory=categorySelect?categorySelect.value:"popular";
    const [localResult,discovery]=await Promise.all([
      window.cineverseSupabase?window.cineverseSupabase.from("movies").select("id,title,release_year,genre,language,quality,description,poster_url,backdrop_url,trailer_url,download_url,published,created_at,media_type,rating,cast_members,runtime_minutes,content_status,seasons,episodes,tags,tmdb_id").eq("published",true).order("created_at",{ascending:false}):Promise.resolve({data:[],error:null}),
      getJson("/api/tmdb-discover?category="+encodeURIComponent(discoverCategory)+"&page=1").catch(e=>({movies:[],error:e.message,total_pages:1}))
    ]);
    localMovies=localResult?.data||[];discoverMovies=discovery.movies||[];discoverPage=1;discoverPages=Number(discovery.total_pages||1);
    movies=dedupe([...localMovies,...discoverMovies]);if(discovery.error&&!localMovies.length)status.textContent=discovery.error;
    fillFilters();render();
  }
  async function loadMore(){
    if(busy)return;busy=true;render();
    try{
      if(searchMode&&remotePage<remotePages){const q=$("#search").value.trim(),d=await getJson("/api/tmdb-search?q="+encodeURIComponent(q)+"&page="+(remotePage+1));remotePage++;remotePages=Number(d.total_pages||remotePages);movies=dedupe([...movies,...(d.movies||[])]);}
      else if(!searchMode&&discoverPage<discoverPages){const d=await getJson("/api/tmdb-discover?category="+encodeURIComponent($("#discoverCategory").value)+"&page="+(discoverPage+1));discoverPage++;discoverMovies=dedupe([...discoverMovies,...(d.movies||[])]);movies=dedupe([...localMovies,...discoverMovies]);}
      else {page+=2;}fillFilters();
    }catch(e){status.textContent=e.message;}finally{busy=false;render();}
  }
  async function remoteSearch(){
    const q=$("#search").value.trim();page=1;
    if(q.length<2){searchMode=false;movies=dedupe([...localMovies,...discoverMovies]);render();return;}
    busy=true;searchMode=true;remotePage=1;remotePages=1;status.textContent="Searching CineVerse and TMDB…";render();
    try{const d=await getJson("/api/tmdb-search?q="+encodeURIComponent(q)+"&page=1");movies=dedupe([...localMovies,...(d.movies||[])]);remotePages=Number(d.total_pages||1);fillFilters();}
    catch(e){movies=localMovies;status.textContent=e.message;}
    finally{busy=false;render();}
  }
  $("#search").oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(remoteSearch,450);};
  ["#genre","#language","#quality","#kind","#sort"].forEach(s=>$(s).onchange=()=>{page=1;render();});
  if($("#discoverCategory"))$("#discoverCategory").onchange=()=>{page=1;searchMode=false;$("#search").value="";load();};
  $("#chips").onclick=e=>{const b=e.target.closest("[data-filter]");if(!b)return;category=b.dataset.filter;page=1;$("#chips").querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("selected",x===b));render();};
  document.querySelectorAll("nav [data-filter]").forEach(a=>a.onclick=()=>{category=a.dataset.filter;page=1;render();});
  document.querySelectorAll("nav [data-kind]").forEach(a=>a.onclick=()=>{$("#kind").value=a.dataset.kind;page=1;render();});
  $("#loadMore").onclick=loadMore;
  $("#lang").onclick=()=>{lang=lang==="en"?"bn":"en";document.documentElement.lang=lang;$(".hero-copy>p:not(.eyebrow)").textContent=lang==="bn"?"মুভি, ওয়েব সিরিজ ও অ্যানিমে খুঁজুন। Genre, রেটিং ও কোয়ালিটি ফিল্টার ব্যবহার করুন।":"Discover movies, series and anime. Explore genres, ratings and quality options.";$ (".hero-copy .primary").textContent=lang==="bn"?"▶ ক্যাটালগ দেখুন":"▶ Explore Catalog";$("#lang").textContent=lang==="bn"?"English":"বাংলা";};
  $("#close").onclick=()=>$("#dialog").close();$("#dialog").onclick=e=>{if(e.target===$("#dialog"))$("#dialog").close();};load();
})();