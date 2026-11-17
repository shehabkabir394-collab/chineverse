(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const safeImage = s => /^https:\/\//i.test(s || "") ? s : "";
  const root=$("#movieApiSections"),status=$("#movieApiStatus"),category=$("#movieApiCategory"),search=$("#movieApiSearch");
  const year=$("#year"); if(year) year.textContent=String(new Date().getFullYear());
  if(!root||!status||!category||!search)return;
  let home=null,selectedCategory="",searchText="";
  function itemPath(item){
    if(typeof item.path==="string"&&item.path.startsWith("/mb/"))return item.path;
    try{const u=new URL(item.detailsEndpoint);const p=u.searchParams.get("path");return p&&p.startsWith("/mb/")?p:"";}catch{return "";}
  }
  function matching(item){
    const q=searchText.toLowerCase();
    const cat=!selectedCategory||String(item.categoryPath||item.category||"").toLowerCase().includes(selectedCategory.toLowerCase());
    const words=[item.title,item.description,item.country,item.language,item.genre,item.typeBadge].join(" ").toLowerCase();
    return cat&&(!q||words.includes(q));
  }
  function card(item){
    const title=item.title||"Untitled",poster=safeImage(item.poster||item.previewImage),path=itemPath(item);
    return '<article class="movie-card movie-api-card"><button class="movie-api-poster" type="button" data-movie-path="'+esc(path)+'" '+(path?"":"disabled")+' aria-label="Open '+esc(title)+'">'+(poster?'<img loading="lazy" src="'+esc(poster)+'" alt="'+esc(title)+' poster">':'<span class="movie-api-placeholder">MOVIESTREAM BD</span>')+'<span class="quality">'+esc(item.quality||item.typeBadge||"HD")+'</span><span class="overlay">▶<small>View details & watch</small></span></button><div class="movie-info"><h3>'+esc(title)+'</h3><p>'+esc(item.country||item.language||item.typeBadge||"MovieStream BD")+'</p><p class="card-rating">'+(item.rating!=null?"★ "+esc(item.rating):"")+'</p></div></article>';
  }
  function sectionHtml(title,badge,items){return items.length?'<section class="movie-api-row"><div class="section-head"><div><p class="eyebrow">'+esc(badge)+'</p><h2>'+esc(title)+'</h2></div></div><div class="grid">'+items.map(card).join("")+'</div></section>':"";}
  function render(){
    if(!home)return;
    const sections=Array.isArray(home.sections)?home.sections:[],trending=Array.isArray(home.trending)?home.trending:[],coming=Array.isArray(home.comingSoon)?home.comingSoon:[];
    let out="";
    if(trending.length)out+=sectionHtml("Trending Now","POPULAR",trending.filter(matching));
    sections.forEach(s=>out+=sectionHtml(s.title||s.bnTitle||"Discover",s.badge||"MOVIESTREAM BD",(Array.isArray(s.items)?s.items:[]).filter(matching)));
    if(coming.length&&!searchText&&!selectedCategory)out+=sectionHtml("Coming Soon","UPCOMING",coming);
    root.innerHTML=out||'<p class="muted">No titles match your search.</p>';
    status.textContent=trending.length+" trending · "+sections.length+" collections · "+coming.length+" upcoming";
  }
  root.addEventListener("click",e=>{const card=e.target.closest("[data-movie-path]");if(card&&card.dataset.moviePath)location.href="watch.html?path="+encodeURIComponent(card.dataset.moviePath);});
  search.addEventListener("input",()=>{searchText=search.value.trim();render();});
  category.addEventListener("change",()=>{selectedCategory=category.value;render();});
  $("#movieApiRefresh")?.addEventListener("click",load);
  async function load(){
    status.textContent="Loading MovieStream BD catalog…";root.innerHTML="";
    try{
      const response=await fetch("/api/movie-api/home",{cache:"no-store"}),data=await response.json();
      if(!response.ok||data.ok!==true)throw new Error(data.error||"Catalog unavailable.");
      home=data;const categories=Array.isArray(data.categories)?data.categories:[];
      category.innerHTML='<option value="">All categories</option>'+categories.map(c=>{const v=c.path||c.label||"",l=c.bnLabel||c.label||v;return '<option value="'+esc(v)+'">'+esc(l)+'</option>';}).join("");
      render();
    }catch(error){status.textContent="Catalog could not load: "+(error.message||"Unknown error");}
  }
  load();
})();