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
  if(item?._hindiCatalog===true)return true;
  const norm=value=>String(value??"").trim().toLowerCase().replace(/[_-]+/g," ").replace(/\\s+/g," ");
  const exactHindi=value=>/^(hindi|hindi dubbed|hindi dub|hindi audio|हिंदी|हिन्दी|hi|hin)$/.test(norm(value));
  const containsHindi=value=>{
   if(Array.isArray(value))return value.some(containsHindi);
   if(value&&typeof value==="object"){
    const code=norm(value.code||value.languageCode||value.lang);
    return /^(hi|hin)$/.test(code)||[value.language,value.name,value.label,value.title].some(exactHindi);
   }
   return exactHindi(value)||/(^|[,;|/])\\s*(hindi|hi|hin|हिंदी|हिन्दी)\\s*($|[,;|/])/.test(norm(value));
  };
  const audioFields=[item?.audioLanguage,item?.audioLanguages,item?.dubLanguage,item?.dubLanguages,item?.dubbedLanguages,item?.availableAudio,item?.availableLanguages,item?.languages,item?.audio,item?.audioTrack,item?.audioTracks,item?.dubbing,item?.audioInfo,item?.audioOptions];
  return exactHindi(item?.language)||audioFields.some(containsHindi);
 };
 const pathOf=item=>{
  if(typeof item.path==="string"&&item.path.startsWith("/mb/"))return item.path;
  try{const p=new URL(item.detailsEndpoint).searchParams.get("path");return p?.startsWith("/mb/")?p:"";}catch{return "";}
 };
 const posterOf=item=>{
  for(const value of [item?.poster,item?.previewImage,item?.posterUrl,item?.poster_url,item?.image,item?.imageUrl,item?.cover,item?.coverImage,item?.thumbnail,item?.thumb]){
   if(typeof value==="string"&&/^https?:\/\//i.test(value))return value;
  }
  return "";
 };
 const uploadTime=item=>{
  const fields=[item?.uploadedAtMs,item?.uploadTimestamp,item?.uploadedAt,item?.uploadTime,item?.uploadDate,item?.upload_date,item?.uploaded_on,item?.dateAdded,item?.addedAt];
  for(const value of fields){
   if(value==null||value==="")continue;
   if(typeof value==="number"||(typeof value==="string"&&/^\\d{9,16}$/.test(value.trim()))){
    const n=Number(value);if(Number.isFinite(n)&&n>0)return n<1000000000000?n*1000:n;
   }
   const parsed=Date.parse(String(value));if(Number.isFinite(parsed))return parsed;
  }
  return 0;
 };
 const newestFirst=(a,b)=>uploadTime(b)-uploadTime(a);
 const sort=items=>[...items].sort((a,b)=>newestFirst(a,b)||Number(isHindiDubbed(b))-Number(isHindiDubbed(a)));
 const prioritySort=items=>sort(items);
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
  let current=0,timer=null,startX=0,startY=0,dragging=false,slideDirection=1;
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
  const go=index=>{slideDirection=index>=current?1:-1;current=(index+slides.length)%slides.length;hero.style.setProperty("--hero-enter-x",(slideDirection*42)+"px");renderSlide();restart();};
  const restart=()=>{if(timer)clearInterval(timer);if(slides.length>1)timer=setInterval(()=>{slideDirection=1;current=(current+1)%slides.length;hero.style.setProperty("--hero-enter-x","42px");renderSlide();},6500);};
  hero.addEventListener("pointerdown",e=>{
   if(e.pointerType!=="touch"||e.target.closest("a,button"))return;
   startX=e.clientX;startY=e.clientY;dragging=true;
   hero.classList.add("is-swiping");
   if(timer)clearInterval(timer);
  },{passive:true});
  hero.addEventListener("pointermove",e=>{
   if(!dragging||e.pointerType!=="touch")return;
   const dx=e.clientX-startX,dy=e.clientY-startY;
   if(Math.abs(dx)>Math.abs(dy)*1.15&&Math.abs(dx)>5){
    hero.style.setProperty("--swipe-x",dx+"px");
    hero.classList.toggle("swipe-left",dx<0);
    hero.classList.toggle("swipe-right",dx>0);
   }
  },{passive:true});
  const finishSwipe=e=>{
   if(!dragging)return;
   const dx=e.clientX-startX,dy=e.clientY-startY;
   dragging=false;startX=0;startY=0;
   hero.classList.remove("is-swiping","swipe-left","swipe-right");
   hero.style.removeProperty("--swipe-x");
   if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.15)go(current+(dx<0?1:-1));
   else restart();
  };
  hero.addEventListener("pointerup",finishSwipe,{passive:true});
  hero.addEventListener("pointercancel",()=>{dragging=false;startX=0;startY=0;hero.classList.remove("is-swiping","swipe-left","swipe-right");hero.style.removeProperty("--swipe-x");restart();},{passive:true});
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
  const oldActions=nav.parentElement.querySelector(".category-action-row");
  if(oldActions)oldActions.remove();
  const tools=$("#movieApiCatalog .movie-api-tools");
  const azLink=tools?.querySelector('a[href="catalog.html"]');
  const actionRow=document.createElement("div");
  actionRow.className="category-action-row";
  if(azLink){azLink.classList.add("category-az-link");actionRow.appendChild(azLink);}
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
   actionRow.appendChild(more);
  }
  nav.insertAdjacentElement("afterend",actionRow);
  if(tools)tools.hidden=true;
  const dubbed=sort(hindiCatalog.filter(isHindiDubbed));
  const pool=[
   ...sections.flatMap(s=>(Array.isArray(s.items)?s.items:[]).map(item=>({...item,_sections:[...(item._sections||[]),text(s.title)]}))),
   ...(Array.isArray(home.allOfficialSections)?home.allOfficialSections.flatMap(s=>(Array.isArray(s.items)?s.items:[]).map(item=>({...item,_sections:[...(item._sections||[]),text(s.title)]}))):[]),
   ...trending,
   ...(Array.isArray(home._extraLatest)?home._extraLatest:[]),
   ...(Array.isArray(home._extraHindi)?home._extraHindi:[])
  ];
  const unique=new Map();
  pool.forEach(item=>{const key=pathOf(item)||String(item.id||item.title||"");if(key&&!unique.has(key))unique.set(key,item);});
  const allTitles=[...unique.values()];
  const sectionTags=item=>(item._sections||[]).join(" ").toLowerCase();
  const isKDrama=item=>{
   const tags=sectionTags(item),type=String(item.typeBadge||item.type||"").toLowerCase();
   const korean=/korea|south korea|republic of korea/i.test(String([item.country,item.originCountry,item.productionCountry,item.originalCountry].join(" ")))||/^(korean|ko)$/i.test(String(item.originalLanguage||item.language||""));
   return /k[- ]?drama|korean drama/.test(tags)||(korean&&(/^(drama|series|tv show|tv series|show)$/i.test(type)||/drama|series/.test(tags)||Array.isArray(item.episodes)));
  };
  const isAnime=item=>{
   const tags=sectionTags(item);
   const genreValues=[...(Array.isArray(item.genres)?item.genres:(item.genres?[item.genres]:[])),...(Array.isArray(item.genre)?item.genre:(item.genre?[item.genre]:[]))].map(value=>value&&typeof value==="object"?(value.name||value.label||""):value).join(" ").toLowerCase();
   const type=String(item.typeBadge||item.type||"").toLowerCase();
   return /anime|japanese animation|japan anime/.test(tags)||/anime|japanese animation|animation/.test(genreValues)||/^anime$/i.test(type)||item.isAnime===true;
  };
  const isMovie=item=>{
   const tags=sectionTags(item);
   const type=String(item.typeBadge||item.type||"").toLowerCase();
   return /^(movie|movies|film)$/i.test(type)||/movie|movies|film|cinema/.test(tags);
  };
  const isDrama=item=>{
   const tags=sectionTags(item);
   const type=String(item.typeBadge||item.type||"").toLowerCase();
   return /^(drama|series|tv show|tv series|show|web series)$/i.test(type)||/drama|series|tv show|k drama|korean drama|tv show/.test(tags)||Array.isArray(item.episodes);
  };
  const allLatest=items=>[...new Map(items.map(item=>[pathOf(item)||String(item.id||item.title||""),item])).values()].sort(newestFirst);
  const recentCutoff=Date.now()-180*24*60*60*1000;
  const inLatestFeed=item=>item?._latestFeed===true||/(latest|recent|new release|new upload|newly added|recently added)/i.test(sectionTags(item));
  const isRecentUpload=item=>item?._latestFeed===true||(uploadTime(item)>0&&uploadTime(item)>=recentCutoff);
  const latestSource=allTitles.filter(item=>item?._latestFeed===true);
  const newReleasePool=latestSource.length?latestSource:allTitles.filter(item=>isRecentUpload(item)||inLatestFeed(item));
  const newReleases=allLatest(newReleasePool.filter(item=>(isMovie(item)||isDrama(item)||item?._latestFeed===true)&&!isAnime(item)));
  const hindiMovies=allLatest(allTitles.filter(item=>isMovie(item)&&!isAnime(item)&&isHindiDubbed(item)));
  const hindiKdramas=allLatest(allTitles.filter(item=>isKDrama(item)&&isHindiDubbed(item)));
  const hindiDramas=allLatest(allTitles.filter(item=>isDrama(item)&&!isKDrama(item)&&!isAnime(item)&&isHindiDubbed(item)));
  const hindiAnime=allLatest(allTitles.filter(item=>isAnime(item)&&isHindiDubbed(item)));
  let out="";
  out+=section("New Release Movies & Dramas","🆕 VERIFIED RECENT UPLOADS · NEWEST FIRST",newReleases.slice(0,14),"/type/movies");
  out+=section("Hindi / Hindi Dubbed Movies","🇮🇳 HINDI AUDIO · NEWEST FIRST",hindiMovies.slice(0,14),"/language/hindi-dubbed");
  out+=section("Hindi Dubbed Dramas","🇮🇳 VERIFIED HINDI AUDIO · NEWEST FIRST",hindiDramas.slice(0,14),"/language/hindi-dubbed");
  out+=section("Hindi Dubbed K-Dramas","🇰🇷 KOREAN DRAMA · HINDI AUDIO ONLY",hindiKdramas.slice(0,14),"/language/hindi-dubbed");
  out+=section("Hindi Dubbed Anime","🎌 VERIFIED HINDI AUDIO · NEWEST FIRST",hindiAnime.slice(0,14),"/language/hindi-dubbed");
  const shownKeys=new Set([...newReleases,...hindiMovies,...hindiKdramas,...hindiAnime].map(item=>pathOf(item)||String(item.id||item.title||"")));
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
   const catalogPage=async(path,page=1)=>{
    const response=await fetch("/api/movie-api/catalog?path="+encodeURIComponent(path)+"&page="+page);
    const payload=await response.json();
    if(!response.ok||payload.ok!==true)throw new Error(payload.error||"Category feed unavailable");
    return payload;
   };
   const sectionList=[...(Array.isArray(home.sections)?home.sections:[]),...(Array.isArray(home.allOfficialSections)?home.allOfficialSections:[])];
   const latestSections=sectionList.filter(section=>/(latest|recent|new release|new upload|newly added|recently added)/i.test(String(section.title||"")));
   const latestPaths=[...new Set(latestSections.map(section=>String(section.categoryPath||section.path||"").trim()).filter(path=>path.startsWith("/")))];
   const latestJobs=latestPaths.slice(0,3).map(async path=>{
    const first=await catalogPage(path,1);
    const max=Math.min(8,Math.max(1,Number(first.maxPage)||1));
    const pages=[first];
    for(let page=2;page<=max;page++)pages.push(await catalogPage(path,page));
    return pages.flatMap(payload=>(Array.isArray(payload.items)?payload.items:[]).map(item=>({...item,_latestFeed:true,_sections:["Latest Uploads"]})));
   });
   const hindiJob=(async()=>{
    const first=await catalogPage("/language/hindi-dubbed",1);
    const max=Math.min(10,Math.max(1,Number(first.maxPage)||1));
    const pages=[first];
    for(let page=2;page<=max;page++)pages.push(await catalogPage("/language/hindi-dubbed",page));
    return pages.flatMap(payload=>(Array.isArray(payload.items)?payload.items:[]).map(item=>({...item,_hindiCatalog:true,_sections:[...(item._sections||[]),"Hindi Dubbed Catalog"]})));
   })();
   const [latestResults,hindiResults]=await Promise.all([
    Promise.all(latestJobs).catch(()=>[]),
    hindiJob.catch(()=>[])
   ]);
   home._extraLatest=latestResults.flat();
   home._extraHindi=hindiResults;
   const sourceSections=Array.isArray(home.sections)?home.sections:[];
   const pool=[
    ...sourceSections.flatMap(section=>(Array.isArray(section.items)?section.items:[]).map(item=>({...item,_sections:[...(item._sections||[]),text(section.title)]}))),
    ...(Array.isArray(home.allOfficialSections)?home.allOfficialSections.flatMap(section=>(Array.isArray(section.items)?section.items:[]).map(item=>({...item,_sections:[...(item._sections||[]),text(section.title)]}))):[]),
    ...(Array.isArray(home.trending)?home.trending:[]).map(item=>({...item,_sections:[...(item._sections||[]),"Trending Now"]})),
    ...home._extraHindi
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
