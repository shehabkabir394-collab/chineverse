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
  return '<section class="movie-api-row"><div class="section-head"><div><p class="eyebrow">'+esc(badgeText)+'</p><h2>'+esc(title)+'</h2></div><a class="btn ghost" href="catalog.html?category='+encodeURIComponent(target||"/type/movies")+'">View all →</a></div><div class="movie-api-shelf">'+items.map(card).join("")+'</div></section>';
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
  const categoryButtons=[
   ["📡","LIVENOW",["live now","livenow","live"]],
   ["🇧🇩","BANGLA",["bangla movies","bangla","bengali"]],
   ["🗣️","BANGLA DUB",["bangla dub","bengali dubbed"]],
   ["🎬","BOLLYWOOD",["bollywood"]],
   ["🇮🇳","HINDI",["hindi movies","hindi"]],
   ["🎤","HINDI DUB",["hindi dubbed","hindi-dubbed"]],
   ["🎧","DUAL AUDIO",["dual audio"]],
   ["🇮🇩","INDONESIAN",["indonesian"]],
   ["🇺🇸","ENGLISH",["english movies","english"]],
   ["⚔️","ACTION",["action"]],
   ["🧩","THRILLER",["thriller"]],
   ["👻","HORROR",["horror"]],
   ["💕","ROMANCE",["romance"]],
   ["🎬","MOVIES",["movies","movie"]],
   ["📺","WEB SERIES",["web series","series"]],
   ["🥇","WWE",["wwe"]],
   ["🛡️","MCU",["mcu","marvel"]],
   ["🦇","DC",["dc comics","dc universe"]]
  ];
  const norm=v=>String(v||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  nav.innerHTML=categoryButtons.map(([emoji,label,terms])=>{
   const found=categories.find(c=>{
    const fields=[c.label,c.name,c.title,c.slug,c.path].map(norm);
    return terms.some(term=>fields.some(value=>value===norm(term)||value.includes(norm(term))));
   });
   const target=found?(text(found.path)||text(found.slug)||text(found.label)||label):label;
   return '<a class="catalog-chip" href="catalog.html?category='+encodeURIComponent(target)+'"><span class="category-emoji">'+emoji+'</span><span>'+esc(label)+'</span></a>';
  }).join("");
  const dubbed=sort(hindiCatalog.filter(isHindiDubbed));
  const korean=dubbed.filter(item=>/korea|south korea/i.test(String(item.country||"")));
  const otherDubbed=dubbed.filter(item=>!/korea|south korea/i.test(String(item.country||"")));
  let out="";
  out+=section("K-Drama Hindi Dubbed","KOREAN · HINDI DUBBED",korean.slice(0,14),"/language/hindi-dubbed");
  out+=section("Hindi Dubbed Movies & Series","HINDI DUBBED",otherDubbed.slice(0,14),"/language/hindi-dubbed");
  if(trending.length)out+=section("Trending Now","POPULAR RIGHT NOW",sort(trending).slice(0,14),"/mostwatch/7d");
  const used=new Set(["trending bengali movies","south indian & hindi dubbed","anime in hindi"]);
  sections.forEach(s=>{
   const title=text(s.title)||"Discover";
   if(used.has(title.toLowerCase()))return;
   const items=(Array.isArray(s.items)?s.items:[]).map(item=>({...item,_sections:[...(item._sections||[]),title]}));
   out+=section(title,text(s.badge)||"COLLECTION",sort(items).slice(0,14),text(s.categoryPath)||"/type/movies");
  });
  root.innerHTML=out||'<p class="muted">No titles available.</p>';
  status.textContent=korean.length+" confirmed Korean Hindi Dubbed · "+otherDubbed.length+" other confirmed Hindi Dubbed · "+trending.length+" trending · "+sections.length+" collections.";
  renderHero();
 }
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
   const pages=await Promise.all([1,2,3].map(async page=>{
    try{
     const response=await fetch("/api/movie-api/catalog?path=%2Flanguage%2Fhindi-dubbed&page="+page);
     if(!response.ok)return[];
     const data=await response.json();
     return Array.isArray(data.items)?data.items:[];
    }catch{return[];}
   }));
   const keys=new Set();
   hindiCatalog=pages.flat().filter(item=>{
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
