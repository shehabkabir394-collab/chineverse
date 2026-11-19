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
  const norm=value=>String(value??"").trim().toLowerCase().replace(/[_-]+/g," ").replace(/\\s+/g," ");
  const language=norm(item?.language);
  const fields=[
   item?.audioLanguage,item?.audioLanguages,item?.dubLanguage,item?.dubLanguages,
   item?.dubbedLanguages,item?.availableAudio,item?.availableLanguages,item?.languages,
   item?.audio,item?.audioTrack,item?.audioTracks,item?.dubbed,item?.dubbing,
   item?.subtitleLanguage
  ];
  const values=fields.flatMap(value=>Array.isArray(value)?value:[value]).map(value=>{
   if(value&&typeof value==="object")return [value.language,value.name,value.label,value.code].map(norm).join(" ");
   return norm(value);
  });
  const audioHindi=values.some(value=>/\\bhindi\\b|हिंदी/.test(value));
  const sectionHindiDub=Array.isArray(item?._sections)&&item._sections.some(value=>
   /(?:hindi|हिंदी).*(?:dub|dubbing|audio)|(?:dub|dubbing|audio).*(?:hindi|हिंदी)/i.test(String(value||""))
  );
  return language==="hindi dubbed"||language==="hindi audio"||
   (audioHindi&&(sectionHindiDub||language==="hindi dubbed"))||
   (language==="hindi"&&sectionHindiDub)||sectionHindiDub;
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
  const timeOf=item=>Number(item?.uploadedAtMs)||Date.parse(item?.uploadedAt||item?.createdAt||item?.updatedAt||item?.date||"")||0;
  const slides=banners.map((item,index)=>({item,index})).filter(x=>posterOf(x.item)).sort((a,b)=>timeOf(b.item)-timeOf(a.item)||a.index-b.index).map(x=>x.item);
  if(!slides.length)return;
  let current=0,timer=null,startX=0;
  hero.classList.add("ms-featured-hero","ms-hero-slider");
  const renderSlide=()=>{
   const item=slides[current],image=posterOf(item),title=text(item.title)||"Featured";
   const path=pathOf(item);
   hero.style.setProperty("--hero-image",'url("'+image.replace(/["\\\\]/g,"")+'")');
   hero.classList.remove("slide-enter");
   hero.innerHTML='<div class="ms-hero-backdrop" aria-hidden="true"></div><div class="ms-featured-copy"><p class="eyebrow">MOVIESTREAM BD · FEATURED</p><span class="ms-featured-tag">'+esc(item.quality||"HD")+'</span><h1>'+esc(title)+'</h1><p class="ms-featured-meta">'+esc([item.country,item.year,item.sportGenre,item.language].filter(Boolean).join(" · "))+'</p><p class="ms-featured-description">'+esc(text(item.description)||"Discover this featured movie and explore more titles in our collection.")+'</p>'+(path?'<a class="btn primary" href="watch.html?path='+encodeURIComponent(path)+'">▶ Watch now</a>':'<a class="btn primary" href="#movieApiCatalog">Explore collection</a>')+'<a class="ms-featured-more" href="catalog.html">Browse all titles →</a></div><div class="ms-featured-poster"><img src="'+esc(image)+'" fetchpriority="high" decoding="async" alt="'+esc(title)+' poster"></div><div class="ms-hero-controls"><button type="button" class="ms-hero-arrow ms-hero-prev" aria-label="Previous featured movie">‹</button><div class="ms-hero-dots">'+slides.map((_,i)=>'<button type="button" class="ms-hero-dot '+(i===current?'active':'')+'" data-slide="'+i+'" aria-label="Show featured movie '+(i+1)+'"></button>').join("")+'</div><button type="button" class="ms-hero-arrow ms-hero-next" aria-label="Next featured movie">›</button></div><span class="ms-hero-counter">'+(current+1)+' / '+slides.length+'</span>';
   requestAnimationFrame(()=>hero.classList.add("slide-enter"));
   hero.querySelector(".ms-hero-prev")?.addEventListener("click",()=>go(current-1));
   hero.querySelector(".ms-hero-next")?.addEventListener("click",()=>go(current+1));
   hero.querySelectorAll("[data-slide]").forEach(button=>button.addEventListener("click",()=>go(Number(button.dataset.slide))));
  };
  const go=index=>{current=(index+slides.length)%slides.length;renderSlide();restart();};
  const restart=()=>{if(timer)clearInterval(timer);if(slides.length>1)timer=setInterval(()=>{current=(current+1)%slides.length;renderSlide();},6500);};
  hero.addEventListener("pointerdown",e=>{if(e.pointerType!=="touch")return;startX=e.clientX;},{passive:true});
  hero.addEventListener("pointerup",e=>{if(e.pointerType!=="touch"||!startX)return;const delta=e.clientX-startX;startX=0;if(Math.abs(delta)>55)go(current+(delta<0?1:-1));},{passive:true});
  hero.addEventListener("mouseenter",()=>{if(timer)clearInterval(timer);});
  hero.addEventListener("mouseleave",restart);
  renderSlide();restart();
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
  const prioritySort=items=>[...items].sort((a,b)=>latest(a,b)||Number(isHindiDubbed(b))-Number(isHindiDubbed(a)));
  const kdramas=prioritySort(allTitles.filter(isKDrama));
  const recentMovies=prioritySort(allTitles.filter(isMovie));
  const koreanDubbed=dubbed.filter(item=>isKDrama(item));
  const recentVisibleKeys=new Set(recentMovies.slice(0,14).map(item=>pathOf(item)||String(item.id||item.title||"")));
  const otherDubbed=dubbed.filter(item=>!isKDrama(item)&&!recentVisibleKeys.has(pathOf(item)||String(item.id||item.title||"")));
  let out="";
  out+=section("Latest K-Dramas","🇰🇷 KOREAN DRAMAS · LATEST UPLOADS",kdramas.slice(0,14),"/language/korean");
  out+=section("Recently Uploaded Movies","🆕 HINDI DUBBED FIRST · LATEST UPLOADS",recentMovies.slice(0,14),"/type/movies");
  out+=section("Hindi Dubbed K-Dramas","🇰🇷 VERIFIED HINDI AUDIO",koreanDubbed.slice(0,14),"/language/hindi-dubbed");
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
