(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const safeImage = s => /^https:\/\//i.test(s || "") ? s : "";
  const root=$("#movieApiSections"),status=$("#movieApiStatus"),category=$("#movieApiCategory"),search=$("#movieApiSearch");
  const year=$("#year"); if(year) year.textContent=String(new Date().getFullYear());
  if(!root||!status||!category||!search)return;
  let home=null,selectedCategory="",selectedCategoryLabel="",searchText="";
  const text=v=>typeof v==="string"?v.trim():"";
  const norm=v=>text(v).toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");
  function itemPath(item){
    if(typeof item.path==="string"&&item.path.startsWith("/mb/"))return item.path;
    try{const u=new URL(item.detailsEndpoint);const p=u.searchParams.get("path");return p&&p.startsWith("/mb/")?p:"";}catch{return "";}
  }
  function categoryValues(item){
    const values=[];
    ["categoryPath","category","categoryName","categoryLabel","categorySlug","type","typeBadge"].forEach(k=>{
      const v=item?.[k]; if(typeof v==="string")values.push(v);
      else if(v&&typeof v==="object")values.push(v.path,v.label,v.name,v.title);
    });
    ["categories","genres"].forEach(k=>{
      const list=item?.[k]; if(Array.isArray(list))list.forEach(v=>{
        if(typeof v==="string")values.push(v);
        else if(v&&typeof v==="object")values.push(v.path,v.label,v.name,v.title);
      });
    });
    return values.filter(Boolean).map(norm);
  }
  function matching(item){
    const values=categoryValues(item);
    const cat=!selectedCategory || values.some(v=>v===norm(selectedCategory)||v.includes(norm(selectedCategory))||
      (selectedCategoryLabel&&v.includes(norm(selectedCategoryLabel)))) ||
      norm(item?.path)===norm(selectedCategory);
    const words=[item.title,item.description,item.country,item.language,item.genre,item.typeBadge,...values].join(" ").toLowerCase();
    return cat&&(!searchText||words.includes(searchText.toLowerCase()));
  }
  function card(item){
    const title=item.title||"Untitled",poster=safeImage(item.poster||item.previewImage),path=itemPath(item);
    return '<article class="movie-card movie-api-card"><button class="movie-api-poster" type="button" data-movie-path="'+esc(path)+'" '+(path?"":"disabled")+' aria-label="Open '+esc(title)+'">'+(poster?'<img loading="lazy" src="'+esc(poster)+'" alt="'+esc(title)+' poster">':'<span class="movie-api-placeholder">MOVIESTREAM BD</span>')+'<span class="quality">'+esc(item.quality||item.typeBadge||"HD")+'</span><span class="overlay">▶<small>View details &amp; watch</small></span></button><div class="movie-info"><h3>'+esc(title)+'</h3><p>'+esc(item.country||item.language||item.typeBadge||"MovieStream BD")+'</p><p class="card-rating">'+(item.rating!=null?"★ "+esc(item.rating):"")+'</p></div></article>';
  }
  function sectionHtml(title,badge,items){return items.length?'<section class="movie-api-row"><div class="section-head"><div><p class="eyebrow">'+esc(badge)+'</p><h2>'+esc(title)+'</h2></div></div><div class="grid">'+items.map(card).join("")+'</div></section>':"";}
  function render(){
    if(!home)return;
    const sections=Array.isArray(home.sections)?home.sections:[],trending=Array.isArray(home.trending)?home.trending:[],coming=Array.isArray(home.comingSoon)?home.comingSoon:[];
    let out="";
    if(trending.length)out+=sectionHtml("Trending Now","POPULAR",trending.filter(matching));
    sections.forEach(s=>out+=sectionHtml(text(s.title)||"Discover",text(s.badge)||"COLLECTION",(Array.isArray(s.items)?s.items:[]).filter(matching)));
    if(coming.length&&!searchText&&!selectedCategory)out+=sectionHtml("Coming Soon","UPCOMING",coming);
    root.innerHTML=out||'<p class="muted">No titles match your search or category.</p>';
    status.textContent=trending.length+" trending · "+sections.length+" collections · "+coming.length+" upcoming";
  }
  root.addEventListener("click",e=>{const card=e.target.closest("[data-movie-path]");if(card&&card.dataset.moviePath)location.href="watch.html?path="+encodeURIComponent(card.dataset.moviePath);});
  search.addEventListener("input",()=>{searchText=search.value.trim();render();});
  category.addEventListener("change",()=>{selectedCategory=category.value;selectedCategoryLabel=category.selectedOptions[0]?.dataset.label||"";render();});
  $("#movieApiRefresh")?.addEventListener("click",load);
  async function load(){
    status.textContent="Loading MovieStream BD catalog…";root.innerHTML="";
    try{
      const response=await fetch("/api/movie-api/home",{cache:"no-store"}),data=await response.json();
      if(!response.ok||data.ok!==true)throw new Error(data.error||"Catalog unavailable.");
      home=data;
      const categories=Array.isArray(data.categories)?data.categories:[];
      const seen=new Set(),options=[];
      categories.forEach(c=>{
        const value=text(c.path)||text(c.slug)||text(c.label)||text(c.name)||text(c.title);
        const label=text(c.label)||text(c.name)||text(c.title)||text(c.slug)||value;
        const key=norm(value||label);
        if(value&&label&&!seen.has(key)){seen.add(key);options.push({value,label});}
      });
      category.innerHTML='<option value="">All Categories</option>'+options.map(c=>'<option value="'+esc(c.value)+'" data-label="'+esc(c.label)+'">'+esc(c.label)+'</option>').join("");
      render();
    }catch(error){status.textContent="Catalog could not load: "+(error.message||"Unknown error");}
  }
  load();
})();