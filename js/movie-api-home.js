(() => {
 "use strict";
 const $=s=>document.querySelector(s);
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const text=v=>typeof v==="string"?v.trim():"";
 const root=$("#movieApiSections"),status=$("#movieApiStatus"),search=$("#movieApiSearch"),nav=$("#movieApiCategories");
 const hero=document.querySelector(".ms-hero");
 if(!root||!status||!search||!nav)return;
 let home=null,hindiCatalog=[];
 const isHindiDubbed=item=>{
  const language=String(item?.language||"").trim().toUpperCase();
  const sections=(item?._sections||[]).map(x=>String(x).trim().toLowerCase());
  return language==="HINDI DUBBED"||sections.some(s=>s.includes("hindi dubbed")||s==="anime in hindi");
 };
 const pathOf=item=>{
  if(typeof item.path==="string"&&item.path.startsWith("/mb/"))return item.path;
  try{const p=new URL(item.detailsEndpoint).searchParams.get("path");return p?.startsWith("/mb/")?p:"";}catch{return "";}
 };
 const posterOf=item=>{
  for(const value of [item?.poster,item?.previewImage])if(typeof value==="string"&&/^https?:\/\//i.test(value))return value;
  return "";
 };
 const sort=items=>[...items].sort((a,b)=>Number(isHindiDubbed(b))-Number(isHindiDubbed(a))||(Number(b.uploadedAtMs)||0)-(Number(a.uploadedAtMs)||0));
 function card(item){
  const title=item.title||"Untitled",poster=posterOf(item),path=pathOf(item);
  return '<article class="movie-card movie-api-card"><button class="movie-api-poster" type="button" data-path="'+esc(path)+'" '+(!path?"disabled":"")+' aria-label="Open '+esc(title)+'">'+(poster?'<img loading="lazy" decoding="async" src="'+esc(poster)+'" alt="'+esc(title)+' poster">':'<span class="movie-api-placeholder">MOVIESTREAM BD</span>')+'<span class="quality">'+esc(item.quality||item.typeBadge||"HD")+'</span>'+(isHindiDubbed(item)?'<span class="movie-api-language-badge">HINDI DUBBED</span>':"")+'<span class="overlay">▶<small>View details &amp; watch</small></span></button><div class="movie-info"><h3>'+esc(title)+'</h3><p>'+esc(item.language||item.country||item.typeBadge||"")+'</p></div></article>';
 }
 function section(title,badgeText,items,target){
  if(!items.length)return "";
  const mobile=window.matchMedia("(max-width:760px)").matches;
  const visible=items.slice(0,mobile?8:12);
  return '<section class="movie-api-row"><div class="section-head"><div><p class="eyebrow">'+esc(badgeText)+'</p><h2>'+esc(title)+'</h2></div><a class="btn ghost" href="catalog.html?category='+encodeURIComponent(target||"/type/movies")+'">View all →</a></div><div class="movie-api-shelf">'+visible.map(card).join("")+'</div></section>';
 }
 function renderHero(){
  if(!hero)return;
  const banners=Array.isArray(home.banners)?home.banners:[];
  const item=banners.find(x=>posterOf(x)&&pathOf(x))||banners.find(x=>posterOf(x));
  if(!item)return;
  const image=posterOf(item),title=text(item.title)||"Featured";
  hero.classList.add("ms-featured-hero");
  hero.style.setProperty("--hero-image",'url("'+image.replace(/["\\]/g,"")+'")');
  const path=pathOf(item);
  hero.innerHTML='<div class="ms-featured-copy"><p class="eyebrow">MOVIESTREAM BD · FEATURED</p><span class="ms-featured-tag">'+esc(item.quality||"HD")+'</span><h1>'+esc(title)+'</h1><p class="ms-featured-meta">'+esc([item.country,item.year,item.sportGenre,item.language].filter(Boolean).join(" · "))+'</p><p class="ms-featured-description">'+esc(text(item.description)||"Discover this featured movie and explore more titles in our collection.")+'</p>'+(path?'<a class="btn primary" href="watch.html?path='+encodeURIComponent(path)+'">▶ Watch now</a>':'<a class="btn primary" href="#movieApiCatalog">Explore collection</a>')+'<a class="ms-featured-more" href="catalog.html">Browse all titles →</a></div><div class="ms-featured-poster"><img src="'+esc(image)+'" alt="'+esc(title)+' poster"></div>';
 }
 function render(){
  if(!home)return;
  const sections=Array.isArray(home.sections)?home.sections:[];
  const trending=Array.isArray(home.trending)?home.trending:[];
  const categories=Array.isArray(home.categories)?home.categories:[];
  const norm=v=>String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const emojiFor=label=>{
   const v=norm(label);
   if(/live|tv/.test(v))return "📡";
   if(/bangla|bengali/.test(v))return "🇧🇩";
   if(/hindi/.test(v))return "🇮🇳";
   if(/english|hollywood/.test(v))return "🇺🇸";
   if(/indonesia/.test(v))return "🇮🇩";
   if(/korean|k drama/.test(v))return "🇰🇷";
   if(/chinese|c drama/.test(v))return "🇨🇳";
   if(/japanese|anime/.test(v))return "🎌";
   if(/bollywood|movie|film/.test(v))return "🎬";
   if(/series|drama/.test(v))return "📺";
   if(/action/.test(v))return "⚔️";
   if(/thriller/.test(v))return "🧩";
   if(/horror/.test(v))return "👻";
   if(/romance/.test(v))return "💕";
   if(/comedy/.test(v))return "😂";
   if(/wwe|wrestling/.test(v))return "🥇";
   if(/marvel|mcu/.test(v))return "🛡️";
   if(/dc comics|dc universe/.test(v))return "🦇";
   if(/dub|audio/.test(v))return "🎧";
   return "🎞️";
  };
  const seenCategories=new Set();
  const actualCategories=categories.filter(c=>{
   const label=text(c.label)||text(c.name)||text(c.title)||text(c.slug)||text(c.path);
   const target=text(c.path)||text(c.slug)||label;
   const key=norm(target||label);
   if(!label||!target||seenCategories.has(key))return false;
   seenCategories.add(key);
   return true;
  });
  nav.innerHTML=actualCategories.map(c=>{
   const label=text(c.label)||text(c.name)||text(c.title)||text(c.slug)||text(c.path);
   const target=text(c.path)||text(c.slug)||label;
   return '<a class="catalog-chip" href="catalog.html?category='+encodeURIComponent(target)+'"><span class="category-emoji">'+emojiFor(label)+'</span><span>'+esc(label)+'</span></a>';
  }).join("");
  nav.classList.remove("expanded");
  const oldMore=nav.parentElement.querySelector(".category-see-more");
  if(oldMore)oldMore.remove();
  if(actualCategories.length>9){
   const more=document.createElement("button");
   more.type="button";
   more.className="category-see-more";
   more.setAttribute("aria-expanded","false");
   more.textContent="See More";
   more.addEventListener("click",()=>{
    const expanded=nav.classList.toggle("expanded");
    more.setAttribute("aria-expanded",String(expanded));
    more.textContent=expanded?"See Less":"See More";
   });
   nav.insertAdjacentElement("afterend",more);
  }
  const dubbed=sort(hindiCatalog.filter(isHindiDubbed));
  const pool=[
   ...sections.flatMap(s=>(Array.isArray(s.items)?s.items:[]).map(item=>({...item,_sections:[...(item._sections||[]),text(s.title)]}))),
   ...(Array.isArray(home.allOfficialSections)?home.allOfficialSections.flatMap(s=>(Array.isArray(s.items)?s.items:[]).map(item=>({...item,_sections:[...(item._sections||[]),text(s.title)]}))):[]),
   ...trending
  ];
  const unique=new Map();
  pool.forEach(item=>{const key=pathOf(item)||String(item.id||item.title||"");if(key&&!unique.has(key))unique.set(key,item);});
  const allTitles=[...unique.values()];
  const isKDrama=item=>{
   const tags=(item._sections||[]).join(" ").toLowerCase();
   return /k[- ]?drama|korean drama/.test(tags)||/korea|south korea|republic of korea/i.test(String(item.country||""))||/^korean$/i.test(String(item.language||""));
  };
  const isMovie=item=>{
   const tags=(item._sections||[]).join(" ").toLowerCase();
   const type=String(item.typeBadge||item.type||"").toLowerCase();
   return type==="movie"||type==="movies"||/movie|movies|film|cinema/.test(tags);
  };
  const latest=(a,b)=>(Number(b.uploadedAtMs)||Date.parse(b.uploadedAt||b.createdAt||b.updatedAt||"")||0)-(Number(a.uploadedAtMs)||Date.parse(a.uploadedAt||a.createdAt||a.updatedAt||"")||0);
  const prioritySort=items=>[...items].sort((a,b)=>Number(isHindiDubbed(b))-Number(isHindiDubbed(a))||latest(a,b));
  const kdramas=prioritySort(allTitles.filter(isKDrama));
  const recentMovies=prioritySort(allTitles.filter(isMovie));
  const koreanDubbed=dubbed.filter(item=>isKDrama(item));
  const recentVisibleKeys=new Set(recentMovies.slice(0,14).map(item=>pathOf(item)||String(item.id||item.title||"")));
  const otherDubbed=dubbed.filter(item=>!isKDrama(item)&&!recentVisibleKeys.has(pathOf(item)||String(item.id||item.title||"")));
  let out="";
  out+=section("Hindi Dubbed K-Dramas · Latest First","🇰🇷 HINDI DUBBED K-DRAMA FIRST",kdramas.slice(0,14),"/language/korean");
  out+=section("Recently Uploaded Movies","🆕 HINDI DUBBED FIRST · LATEST UPLOADS",recentMovies.slice(0,14),"/type/movies");
  out+=section("K-Drama Hindi Dubbed","KOREAN · HINDI DUBBED",koreanDubbed.slice(0,14),"/language/hindi-dubbed");
  out+=section("Hindi Dubbed Movies & Series","HINDI DUBBED",otherDubbed.slice(0,14),"/language/hindi-dubbed");
  if(trending.length)out+=section("Trending Now","🔥 HINDI DUBBED FIRST · POPULAR RIGHT NOW",prioritySort(trending).slice(0,14),"/mostwatch/7d");
  const used=new Set(["trending bengali movies","south indian & hindi dubbed","anime in hindi"]);
  sections.forEach(s=>{
   const title=text(s.title)||"Discover";
   if(used.has(title.toLowerCase()))return;
   const items=(Array.isArray(s.items)?s.items:[]).map(item=>({...item,_sections:[...(item._sections||[]),title]}));
   out+=section(title,text(s.badge)||"COLLECTION",sort(items).slice(0,14),text(s.categoryPath)||"/type/movies");
  });
  root.innerHTML=out||'<p class="muted">No titles available.</p>';
  status.textContent="";
  status.hidden=true;
  renderHero();
 }
 root.addEventListener("pointerdown",e=>{
  const shelf=e.target.closest(".movie-api-shelf");
  if(!shelf||e.pointerType!=="mouse")return;
  shelf.dataset.dragging="1";shelf.dataset.dragStartX=String(e.clientX);shelf.dataset.dragStartScroll=String(shelf.scrollLeft);
  shelf.classList.add("is-dragging");
 });
 root.addEventListener("pointermove",e=>{
  const shelf=e.target.closest(".movie-api-shelf");
  if(!shelf||shelf.dataset.dragging!=="1")return;
  shelf.scrollLeft=Number(shelf.dataset.dragStartScroll)-(e.clientX-Number(shelf.dataset.dragStartX));
 });
 const stopShelfDrag=()=>root.querySelectorAll(".movie-api-shelf.is-dragging").forEach(shelf=>{delete shelf.dataset.dragging;shelf.classList.remove("is-dragging");});
 root.addEventListener("pointerup",stopShelfDrag);
 root.addEventListener("pointercancel",stopShelfDrag);
 root.addEventListener("pointerleave",stopShelfDrag);
 root.addEventListener("click",e=>{
  const b=e.target.closest("[data-path]");
  if(b?.dataset.path)location.href="watch.html?path="+encodeURIComponent(b.dataset.path);
 });
 search.addEventListener("keydown",e=>{
  if(e.key==="Enter")location.href="catalog.html?q="+encodeURIComponent(search.value.trim());
 });
 $("#movieApiRefresh")?.addEventListener("click",load);
 async function load(){
  status.textContent="Loading MovieStream BD…";
  root.innerHTML="";
  try{
   const r=await fetch("/api/movie-api/home");
   const d=await r.json();
   if(!r.ok||d.ok!==true)throw new Error(d.error||"Catalog unavailable");
   home=d;
   // Build dubbed shelves from the cached homepage payload.
   // Avoid three extra upstream catalog requests on every homepage visit.
   const sourceSections=Array.isArray(home.sections)?home.sections:[];
   const pool=[
    ...sourceSections.flatMap(section=>(Array.isArray(section.items)?section.items:[]).map(item=>({
     ...item,_sections:[...(item._sections||[]),text(section.title)]
    }))),
    ...(Array.isArray(home.trending)?home.trending:[]).map(item=>({...item,_sections:[...(item._sections||[]),"Trending Now"]}))
   ];
   const keys=new Set();
   hindiCatalog=pool.filter(item=>{
    const key=String(item.id||item.path||item.title||"");
    if(!key||keys.has(key))return false;
    keys.add(key);
    return true;
   });
   render();
  }catch(e){status.textContent="Catalog could not load: "+(e.message||"Unknown error");}
 }
 load();
})();
