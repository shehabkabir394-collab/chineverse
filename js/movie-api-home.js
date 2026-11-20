(() => {
 "use strict";
 const $=s=>document.querySelector(s);
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const text=v=>typeof v==="string"?v.trim():"";
 const isNigerianItem=item=>{const values=[item?.country,item?.originCountry,item?.productionCountry,item?.originalCountry,item?.nationality,item?.region,item?.title,item?.language,item?.originalLanguage,item?.productionCountries,item?.countries,item?.description];return values.some(value=>Array.isArray(value)?value.some(v=>/nigeria|nigerian|nollywood|naija/i.test(String(v?.name||v?.code||v||""))):/nigeria|nigerian|nollywood|naija/i.test(String(value||"")));};
 const root=$("#movieApiSections"),status=$("#movieApiStatus"),search=$("#movieApiSearch"),nav=$("#movieApiCategories");
 const hero=document.querySelector(".ms-hero");
 if(!root||!status||!search||!nav)return;
 let home=null,homeRenderedKeys=new Set();
 const isHindiDubbed=item=>{
  if(item?._hindiCatalog===true)return true;
  const norm=value=>String(value??"").trim().toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ");
  const exactHindi=value=>/^(hindi|hindi dubbed|hindi dub|hindi audio|हिंदी|हिन्दी|hi|hin)$/.test(norm(value));
  const containsHindi=value=>{
   if(Array.isArray(value))return value.some(containsHindi);
   if(value&&typeof value==="object"){
    const code=norm(value.code||value.languageCode||value.lang);
    return /^(hi|hin)$/.test(code)||[value.language,value.name,value.label,value.title].some(exactHindi);
   }
   return exactHindi(value)||/(^|[,;|/])\s*(hindi|hi|hin|हिंदी|हिन्दी)\s*($|[,;|/])/.test(norm(value));
  };
  const audioFields=[item?.audioLanguage,item?.audioLanguages,item?.dubLanguage,item?.dubLanguages,item?.dubbedLanguages,item?.availableAudio,item?.availableLanguages,item?.languages,item?.audio,item?.audioTrack,item?.audioTracks,item?.dubbing,item?.audioInfo,item?.audioOptions];
  const explicitShelf=Array.isArray(item?._sections)&&item._sections.some(value=>/hindi dubbed|hindi dub|south indian & hindi dubbed|anime in hindi/i.test(String(value||"")));
  const explicitDubFlag=item?.isHindiDubbed===true||item?.hindiDubbed===true||item?.is_hindi_dubbed===true||item?.dubbed===true&&containsHindi(item?.dubLanguage||item?.dubLanguages||item?.audioLanguage||item?.audioLanguages);
  return explicitShelf||explicitDubFlag||audioFields.some(containsHindi);
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
 const dateValue=value=>{
  if(value==null||value==="")return 0;
  const raw=typeof value==="object"?(value.timestamp||value.date||value.value||""):value;
  if(typeof raw==="number"||(typeof raw==="string"&&/^\d{9,16}$/.test(raw.trim()))){
   const n=Number(raw);if(Number.isFinite(n)&&n>0)return n<1000000000000?n*1000:n;
  }
  const parsed=Date.parse(String(raw));return Number.isFinite(parsed)&&parsed>0?parsed:0;
 };
 const uploadTime=item=>{
  const fields=[item?.uploadedAtMs,item?.uploadTimestamp,item?.uploadedAt,item?.uploadTime,item?.uploadDate,item?.upload_date,item?.uploaded_on,item?.createdAtMs,item?.created_at,item?.createdAt,item?.dateAdded,item?.addedAt,item?.added_at,item?.publishedAt,item?.published_at,item?.lastUpdated,item?.updatedAt,item?.updated_at,item?.modifiedAt];
  for(const value of fields){const time=dateValue(value);if(time)return time;}
  return 0;
 };
 const releaseTime=item=>{
  const fields=[item?.releaseTimestamp,item?.releaseDate,item?.release_date,item?.releaseAt,item?.release_at,item?.firstAirDate,item?.first_air_date,item?.airDate,item?.air_date,item?.premiereDate,item?.premiere_date,item?.theatricalReleaseDate,item?.theatrical_release_date,item?.publishDate,item?.publish_date,item?.date];
  for(const value of fields){const time=dateValue(value);if(time)return time;}
  return uploadTime(item);
 };
 const chronologicalFirst=(a,b)=>{
  const now=Date.now(),ta=releaseTime(a),tb=releaseTime(b),aFuture=ta>now,bFuture=tb>now;
  // Already released titles come first, newest release first.
  // Future titles follow in soonest-release order; unknown dates stay last.
  if(aFuture!==bFuture)return aFuture?1:-1;
  if(aFuture&&bFuture)return ta-tb;
  return tb-ta;
 };
 const isPinned=item=>item?.pinned===true||item?.isPinned===true||item?.featured===true||item?.is_featured===true||/^(1|true|yes)$/i.test(String(item?.pin||item?.is_pinned||""));
 const popularity=item=>["views","viewCount","view_count","totalViews","total_views","downloads","downloadCount","popularity","watchCount","watch_count","visits","hits"].reduce((best,key)=>Math.max(best,Number(item?.[key])||0),0);
 const recentFirst=(a,b)=>chronologicalFirst(a,b)||Number(isHindiDubbed(b))-Number(isHindiDubbed(a));
 const isKDrama=item=>/k[- ]?drama|korean drama|south korea/i.test([item?.title,item?.type,item?.typeBadge,item?.category,item?.categoryName,item?.genre,item?.genres,item?.country,...(Array.isArray(item?._sections)?item._sections:[])].flat().map(v=>typeof v==="object"?[v?.name,v?.label,v?.title].filter(Boolean).join(" "):String(v||"")).join(" "));
 const popularFirst=(a,b)=>chronologicalFirst(a,b)||Number(isHindiDubbed(b))-Number(isHindiDubbed(a))||Number(isPinned(b))-Number(isPinned(a))||popularity(b)-popularity(a);
 const sort=items=>[...items].sort((a,b)=>Number(isHindiDubbed(b))-Number(isHindiDubbed(a))||chronologicalFirst(a,b));
 const prioritySort=items=>[...items].sort((a,b)=>Number(isHindiDubbed(b))-Number(isHindiDubbed(a))||chronologicalFirst(a,b));
 function card(item){
  const title=item.title||"Untitled",poster=posterOf(item),path=pathOf(item);
  return '<article class="movie-card movie-api-card"><button class="movie-api-poster" type="button" data-path="'+esc(path)+'" '+(!path?"disabled":"")+' aria-label="Open '+esc(title)+'">'+(poster?'<img loading="lazy" decoding="async" src="'+esc(poster)+'" alt="'+esc(title)+' poster">':'<span class="movie-api-placeholder">MOVIESTREAM BD</span>')+'<span class="quality">'+esc(item.quality||item.typeBadge||"HD")+'</span>'+(isHindiDubbed(item)?'<span class="movie-api-language-badge">HINDI DUBBED</span>':"")+'<span class="overlay">▶<small>View details &amp; watch</small></span></button><div class="movie-info"><h3>'+esc(title)+'</h3><p>'+esc(item.language||item.country||item.typeBadge||"")+'</p></div></article>';
 }
 function section(title,badgeText,items,target){
  const localKeys=new Set();
  items=items.filter(item=>{
   if(isNigerianItem(item))return false;
   const key=pathOf(item)||String(item.id||item.title||"").trim().toLowerCase();
   if(!key||homeRenderedKeys.has(key)||localKeys.has(key))return false;
   localKeys.add(key);
   return true;
  });
  if(!items.length)return "";
  const mobile=window.matchMedia("(max-width:760px)").matches;
  const visible=items.slice(0,mobile?8:9);
  visible.forEach(item=>homeRenderedKeys.add(pathOf(item)||String(item.id||item.title||"").trim().toLowerCase()));
  return '<section class="movie-api-row"><div class="section-head"><div><p class="eyebrow">'+esc(badgeText)+'</p><h2>'+esc(title)+'</h2></div><a class="btn ghost" href="catalog.html?category='+encodeURIComponent(target||"/type/movies")+'">View all →</a></div><div class="movie-api-shelf">'+visible.map(card).join("")+'</div></section>';
 }
 function renderHero(){
  if(!hero)return;
  const banners=Array.isArray(home.banners)?home.banners:[];
  const fallbackTitles=[...(Array.isArray(home._extraHindi)?home._extraHindi:[]),...(Array.isArray(home.trending)?home.trending:[]),...(Array.isArray(home._extraLatest)?home._extraLatest:[]),...(Array.isArray(home.sections)?home.sections.flatMap(section=>Array.isArray(section.items)?section.items:[]):[])];
  const bannerPool=banners.length?banners:fallbackTitles;
  const timeOf=item=>uploadTime(item)||Number(item?.releaseTimestamp)||Date.parse(item?.releaseDate||item?.release_date||item?.firstAirDate||item?.first_air_date||"")||0;
  const uniqueSlides=new Map();
  bannerPool.forEach(item=>{const key=pathOf(item)||String(item.id||item.title||"");if(key&&!uniqueSlides.has(key))uniqueSlides.set(key,item);});
  const allSlides=[...uniqueSlides.values()].filter(item=>!isNigerianItem(item)&&posterOf(item));
  const slides=allSlides.filter(item=>!item.mediaType&&!item.contentType&&!item.type&&!item.typeBadge||/movie|film/i.test(String(item.mediaType||item.contentType||item.type||item.typeBadge))).sort(chronologicalFirst).slice(0,10);
  if(!slides.length){hero.classList.remove("ms-featured-hero","ms-hero-slider");hero.innerHTML='<div class="hero-copy"><p class="eyebrow">MOVIESTREAM BD · MOVIES & DRAMAS</p><h1>Your next <em>favorite</em><br>story starts here.</h1><p>Explore the latest movies and dramas from our catalog.</p><a class="btn primary" href="#movieApiCatalog">▶ Explore Collection</a></div>';return;}
  let current=0,timer=null,startX=0,startY=0,dragging=false,slideDirection=1;
  hero.classList.add("ms-featured-hero","ms-hero-slider");
  const renderSlide=()=>{
   const item=slides[current],image=posterOf(item),title=text(item.title)||"Featured";
   const path=pathOf(item);
   const connection=navigator.connection||{};
   const allowHeroVideo=false;
   const video=allowHeroVideo?[item.trailerUrl,item.trailer_url,item.teaserUrl,item.teaser_url,item.previewVideoUrl,item.preview_video_url,item.bannerVideoUrl,item.banner_video_url].find(value=>typeof value==="string"&&value.startsWith("https://")):"";
   hero.style.setProperty("--hero-image",'url("'+image.replace(/["\\\\]/g,"")+'")');
   hero.classList.remove("slide-enter");
   hero.innerHTML=(video?'<div class="ms-hero-video-layer" aria-hidden="true"><video class="ms-hero-video" autoplay muted loop playsinline preload="metadata" poster="'+esc(image)+'"><source src="'+esc(video)+'"></video></div>':'<div class="ms-hero-backdrop" aria-hidden="true"></div>')+'<div class="ms-featured-copy"><p class="eyebrow">MOVIESTREAM BD · FEATURED</p><span class="ms-featured-tag">'+esc(item.quality||"HD")+'</span><h1>'+esc(title)+'</h1><p class="ms-featured-meta">'+esc([item.country,item.year,item.sportGenre,item.language].filter(Boolean).join(" · "))+'</p><p class="ms-featured-description">'+esc(text(item.description)||"Discover this featured movie and explore more titles in our collection.")+'</p>'+(path?'<a class="btn primary" href="watch.html?path='+encodeURIComponent(path)+'">▶ Watch now</a>':'<a class="btn primary" href="#movieApiCatalog">Explore collection</a>')+'<a class="ms-featured-more" href="catalog.html">Browse all titles →</a></div><div class="ms-featured-poster"><img src="'+esc(image)+'" fetchpriority="high" decoding="async" alt="'+esc(title)+' poster"></div><div class="ms-hero-controls"><button type="button" class="ms-hero-arrow ms-hero-prev" aria-label="Previous featured movie">‹</button><div class="ms-hero-dots">'+slides.map((_,i)=>'<button type="button" class="ms-hero-dot '+(i===current?'active':'')+'" data-slide="'+i+'" aria-label="Show featured movie '+(i+1)+'"></button>').join("")+'</div><button type="button" class="ms-hero-arrow ms-hero-next" aria-label="Next featured movie">›</button></div><span class="ms-hero-counter">'+(current+1)+' / '+slides.length+'</span>';
   requestAnimationFrame(()=>hero.classList.add("slide-enter"));
   hero.querySelector(".ms-hero-prev")?.addEventListener("click",()=>go(current-1));
   hero.querySelector(".ms-hero-next")?.addEventListener("click",()=>go(current+1));
   hero.querySelectorAll("[data-slide]").forEach(button=>button.addEventListener("click",()=>go(Number(button.dataset.slide))));
  };
  const go=index=>{slideDirection=index>=current?1:-1;current=(index+slides.length)%slides.length;hero.style.setProperty("--hero-enter-x",(slideDirection*42)+"px");hero.style.setProperty("--hero-out-x",(-slideDirection*100)+"%");renderSlide();restart();};
  const restart=()=>{if(timer){clearInterval(timer);timer=null;}if(slides.length>1&&!matchMedia("(prefers-reduced-motion: reduce)").matches)timer=setInterval(()=>go(current+1),6500);};
  hero.addEventListener("pointerdown",e=>{
   if(e.pointerType!=="touch"||e.target.closest("a,button"))return;
   startX=e.clientX;startY=e.clientY;dragging=true;
   try{hero.setPointerCapture(e.pointerId);}catch{}
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
  homeRenderedKeys=new Set();
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
  const pool=[
   ...sections.flatMap(s=>(Array.isArray(s.items)?s.items:[]).map(item=>({...item,_sections:[...(item._sections||[]),text(s.title)]}))),
   ...(Array.isArray(home.allOfficialSections)?home.allOfficialSections.flatMap(s=>(Array.isArray(s.items)?s.items:[]).map(item=>({...item,_hindiCatalog:item._hindiCatalog===true||/hindi dubbed|hindi audio|hindi dub/i.test(text(s.title)),_sections:[...(item._sections||[]),text(s.title)]}))):[]),
   ...trending,
   ...(Array.isArray(home._extraLatest)?home._extraLatest:[]),
   ...(Array.isArray(home._extraHindi)?home._extraHindi:[]),
   ...(Array.isArray(home._extraClassified)?home._extraClassified:[])
  ];
  const unique=new Map();
  pool.forEach(item=>{
   const key=pathOf(item)||String(item.id||item.title||"");
   if(!key)return;
   if(!unique.has(key))unique.set(key,item);
   else{
    const saved=unique.get(key);
    if(!posterOf(saved)&&posterOf(item))saved.poster=posterOf(item);
    if(item._hindiCatalog)saved._hindiCatalog=true;
    if(item._latestFeed)saved._latestFeed=true;
    if(item._dramaCatalog)saved._dramaCatalog=true;
    if(item._koreanCatalog)saved._koreanCatalog=true;
    if(item._animeCatalog)saved._animeCatalog=true;
    saved._sections=[...new Set([...(saved._sections||[]),...(item._sections||[])])];
   }
  });
  const allTitles=[...unique.values()];
  const sectionTags=item=>(item._sections||[]).join(" ").toLowerCase();
  const isKDrama=item=>{
   const tags=sectionTags(item),type=String(item.mediaType||item.contentType||item.type||item.typeBadge||"").toLowerCase();
   const korean=item?._koreanCatalog===true||/korea|south korea|republic of korea/i.test(String([item.country,item.originCountry,item.productionCountry,item.originalCountry].join(" ")))||/^(korean|ko)$/i.test(String(item.originalLanguage||item.language||""));
   return /k[- ]?drama|korean drama/.test(tags)||(korean&&(/^(drama|series|tv show|tv series|show)$/i.test(type)||/drama|series/.test(tags)||Array.isArray(item.episodes)||item._dramaCatalog===true));
  };
  const isNigerian=item=>isNigerianItem(item)||(Array.isArray(item?._sections)&&item._sections.some(value=>/nigeria|nigerian|nollywood|naija/i.test(String(value))));
  const isAnime=item=>{
   const tags=sectionTags(item);
   const genreValues=[...(Array.isArray(item.genres)?item.genres:(item.genres?[item.genres]:[])),...(Array.isArray(item.genre)?item.genre:(item.genre?[item.genre]:[]))].map(value=>value&&typeof value==="object"?(value.name||value.label||""):value).join(" ").toLowerCase();
   const type=String(item.typeBadge||item.type||"").toLowerCase();
   return item?._animeCatalog===true||/anime|japanese animation|japan anime/.test(tags)||/anime|japanese animation|animation/.test(genreValues)||/^anime$/i.test(type)||item.isAnime===true;
  };
  const isMovie=item=>{
   const tags=sectionTags(item);
   const type=String(item.mediaType||item.contentType||item.type||item.typeBadge||item.category||"").toLowerCase();
   return /^(movie|movies|film|feature film)$/i.test(type)||/movie|movies|film|cinema/.test(tags)||item.isMovie===true;
  };
  const isDrama=item=>{
   const tags=sectionTags(item);
   const type=String(item.mediaType||item.contentType||item.type||item.typeBadge||item.category||"").toLowerCase();
   return item?._dramaCatalog===true||/^(drama|series|tv show|tv series|show|web series|serial)$/i.test(type)||/drama|series|tv show|k drama|korean drama|tv show/.test(tags)||item.isSeries===true||item.isDrama===true||Array.isArray(item.episodes)||Number(item.episodeCount)>0||Number(item.totalEpisodes)>0;
  };
  const allLatest=items=>[...new Map(items.map(item=>[pathOf(item)||String(item.id||item.title||""),item])).values()].sort(recentFirst);
  const recentCutoff=Date.now()-365*24*60*60*1000;
  const hasRecentTimestamp=item=>uploadTime(item)>0&&uploadTime(item)<=Date.now()+24*60*60*1000&&uploadTime(item)>=recentCutoff;
  const latestSource=allTitles.filter(item=>item?._latestFeed===true);
  const newReleasePool=allTitles.filter(item=>{
   if(isNigerian(item)||isAnime(item))return false;
   if(!(isMovie(item)||isDrama(item)))return false;
   if(item._latestFeed===true)return true;
   if(item._categoryFeed===true&&hasRecentTimestamp(item))return true;
   return !latestSource.length&&hasRecentTimestamp(item);
  });
  const newReleases=allLatest(newReleasePool);
  const allMovies=allLatest(allTitles.filter(item=>isMovie(item)&&!isAnime(item)&&!isNigerian(item)));
  const allKdramas=allLatest(allTitles.filter(item=>isKDrama(item)&&isDrama(item)&&!isNigerian(item))).sort(chronologicalFirst);
  const allDramas=allLatest(allTitles.filter(item=>isDrama(item)&&!isKDrama(item)&&!isAnime(item)&&!isNigerian(item)));
  const allAnime=allLatest(allTitles.filter(item=>isAnime(item)&&!isNigerian(item)));
  let out="";
  const hindiDubbedAll=allLatest(allTitles.filter(item=>isHindiDubbed(item)&&!isNigerian(item)));
  // Put country/language-specific official shelves before mixed global feeds.
  const regionalSections=sections.filter(s=>/trending bengali movies|bengali movies|bangla movies|bollywood|south indian|k[- ]?drama|korean drama|anime in hindi|into animeverse|trending c[- ]?drama|thai[- ]?drama|trending india|trending filipino|trending tagalog|western tv|trending western|girls' love|patok na shorttv/i.test(text(s.title)));
  regionalSections.sort((a,b)=>{
   const rank=s=>/trending bengali movies|bengali movies|bangla movies/i.test(text(s.title))?0:/bollywood|south indian/i.test(text(s.title))?1:/k[- ]?drama|korean drama/i.test(text(s.title))?2:/anime in hindi/i.test(text(s.title))?3:/trending india/i.test(text(s.title))?4:5;
   return rank(a)-rank(b);
  });
  const topTen=prioritySort((Array.isArray(home._topTen)&&home._topTen.length?home._topTen:trending).filter(item=>!isNigerian(item))).slice(0,10);
  const collections=Array.isArray(home.collections)?home.collections:[];
  const upcoming=[...(Array.isArray(home.upcoming)?home.upcoming:(Array.isArray(home.upcomingReleases)?home.upcomingReleases:[]))].filter(item=>!isNigerian(item)).sort((a,b)=>Number(isHindiDubbed(b))-Number(isHindiDubbed(a))||chronologicalFirst(a,b));
  const tagged=pattern=>allLatest(allTitles.filter(item=>pattern.test(sectionTags(item)+" "+String([item.category,item.genre,item.genres,item.type,item.typeBadge,item.language,item.country,item.originCountry].join(" ")).toLowerCase())));
  const southIndian=tagged(/south indian|tamil|telugu|malayalam|kannada/);
  const cDramas=tagged(/c[- ]?drama|chinese drama|china/).filter(isDrama);
  const jDramas=tagged(/j[- ]?drama|japanese drama|japan/).filter(isDrama);
  const ongoing=allLatest(allTitles.filter(item=>isDrama(item)&&/ongoing|returning|in production|currently airing/i.test(String([item.status,item.releaseStatus,item.airingStatus,item._sections].join(" ")))));
  const animations=tagged(/animation|animated|cartoon/);
  const dramaSeries=allLatest(allTitles.filter(item=>isDrama(item)&&!isAnime(item)&&!isNigerian(item)));
  const movieTitles=allLatest(allTitles.filter(item=>isMovie(item)&&!isAnime(item)&&!isNigerian(item)));
  if(hindiDubbedAll.length)out+=section("Hindi Dubbed — Movies & Dramas","🇮🇳 HINDI AUDIO · PRIORITY PICKS · NEWEST FIRST",hindiDubbedAll.slice(0,24),"/language/hindi-dubbed");
  // Keep all trending movies and dramas together; Hindi audio is always ranked first,
  // then release/upload timestamp determines the order (newest first).
  const trendingMoviesDramas=prioritySort([...new Map([...trending,...(Array.isArray(home._topTen)?home._topTen:[]),...allTitles].filter(item=>!isNigerian(item)&&(isMovie(item)||isDrama(item))).map(item=>[pathOf(item)||String(item.id||item.title||""),item]).filter(([key])=>key)).values()]).slice(0,24);
  if(newReleases.length)out+=section("New Releases — Movies & Dramas","🆕 HINDI DUBBED FIRST · RELEASE / UPLOAD TIME · NEWEST FIRST",newReleases.slice(0,24),"/new");
  if(trendingMoviesDramas.length)out+=section("Trending Movies & Dramas","🔥 HINDI DUBBED FIRST · THEN NEWEST RELEASES",trendingMoviesDramas,"/mostwatch/7d");
  if(topTen.length)out+=section("Trending Now","🔥 MOST WATCHED THIS WEEK · HINDI DUBBED FIRST",topTen,"/mostwatch/7d");
  out+=section("All Movies","🎬 HINDI DUBBED FIRST · ALL LANGUAGES · NEWEST FIRST",allMovies.slice(0,24),"/type/movies");
  out+=section("Recently Updated","🆕 LATEST MOVIES, DRAMAS & EPISODES · NEWEST FIRST",newReleases.slice(0,24),"/new");
  regionalSections.forEach(s=>out+=section(text(s.title)||"Regional Picks",text(s.badge)||"🌏 COUNTRY & LANGUAGE COLLECTION",sort(s.items||[]).slice(0,18),text(s.categoryPath)||"/type/movies"));
  const hindiDubbedKdramas=allLatest(allKdramas);
  out+=section("K-Drama Hindi Dubbed","🇰🇷 HINDI DUBBED K-DRAMAS · LATEST UPDATES FIRST",hindiDubbedKdramas.slice(0,24),"/language/korean");
  if(upcoming.length)out+=section("Upcoming / Release Soon","🎬 COMING SOON",upcoming.slice(0,12),"/upcoming");
  if(collections.length){
   collections.forEach(collection=>out+=section(text(collection.title)||text(collection.name)||"Collection",text(collection.badge)||"📚 CURATED COLLECTION",Array.isArray(collection.items)?collection.items.filter(item=>!isNigerian(item)).slice(0,14):[] ,text(collection.path)||text(collection.categoryPath)||"/type/movies"));
  }else{
   sections.filter(s=>/collection|marvel|universe|south indian|horror|thriller|romance|bangla dubbed|korean drama|family|animation/i.test(String(s.title||""))).forEach(s=>out+=section(text(s.title)||"Collection",text(s.badge)||"📚 COLLECTION",sort(s.items||[]).slice(0,14),text(s.categoryPath)||"/type/movies"));
  }
  out+=section("New & Popular","✨ MOST VIEWED · TRENDING · NEW",prioritySort([...newReleases,...trending]).slice(0,18),"/new");
  out+=section("Movies","🎬 LATEST MOVIE UPDATES · NEWEST FIRST",movieTitles.slice(0,18),"/type/movies");
  out+=section("Series & TV Shows","📺 LATEST EPISODE & SERIES UPDATES",dramaSeries.slice(0,18),"/type/series");
  out+=section("K-Dramas","🇰🇷 HINDI DUBBED FIRST · KOREAN DRAMAS",allKdramas.slice(0,18),"/language/korean");
  out+=section("C-Dramas","🇨🇳 CHINESE DRAMAS",cDramas.slice(0,14),"/language/chinese");
  out+=section("J-Dramas","🎌 JAPANESE DRAMAS",jDramas.slice(0,14),"/language/japanese");
  out+=section("South Indian","🔥 TAMIL · TELUGU · MALAYALAM · KANNADA",southIndian.slice(0,18),"/south-indian");
  out+=section("Ongoing Series","📡 CURRENTLY AIRING SERIES",ongoing.slice(0,14),"/ongoing");
  out+=section("Anime Zone","🎌 HINDI DUBBED FIRST · ALL ANIME",allAnime,"/anime");
  out+=section("Animation","🧸 ANIMATION & CARTOONS",animations.slice(0,14),"/animation");
  out+=section("All Dramas & Series","📺 HINDI DUBBED FIRST · ALL LANGUAGES",allDramas.slice(0,18),"/type/series");
  const used=new Set(["trending bengali movies","south indian & hindi dubbed","anime in hindi","collections"]);
  sections.forEach(s=>{
   const title=text(s.title)||"Discover";
   if(used.has(title.toLowerCase())||/collection|marvel|universe|south indian|horror|thriller|romance|bangla dubbed|korean drama|family|animation/i.test(title))return;
   const items=(Array.isArray(s.items)?s.items:[]).filter(item=>!isNigerian(item)).map(item=>({...item,_sections:[...(item._sections||[]),title]}));
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
  if(!home)root.innerHTML="";
  try{
   // Use one primary feed; Hindi-dubbed sections are prioritized from the same response.
   const r=await fetch("/api/movie-api/home",{cache:"default"});
   const d=await r.json();
   if(!r.ok||d.ok!==true)throw new Error(d.error||"Catalog unavailable");
   home=d;
   render();
  }catch(e){if(!home)status.textContent="Catalog could not load: "+(e.message||"Unknown error");}
 }
 load();
})();
