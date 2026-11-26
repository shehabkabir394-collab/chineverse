(() => {
 "use strict";
 const $=s=>document.querySelector(s);
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const text=v=>typeof v==="string"?v.trim():"";
 const imageValue=value=>{
  if(typeof value==="string")return value;
  if(Array.isArray(value))return imageValue(value[0]);
  if(value&&typeof value==="object")return imageValue(value.url||value.src||value.imageUrl||value.image_url||value.original||value.large||value.medium||value.path);
  return "";
 };
 const posterOf=item=>imageValue(item?.poster||item?.posterUrl||item?.poster_url||item?.previewImage||item?.preview_image||item?.bannerImage||item?.banner_image||item?.cover||item?.coverUrl||item?.coverImage||item?.image||item?.imageUrl||item?.image_url||item?.thumbnail||item?.thumbnailUrl||item?.thumbnail_url||item?.pic||item?.img);
 const norm=v=>text(v).toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
 const compact=v=>norm(v).replace(/[^a-z0-9\u0980-\u09ff]/g,"");
 const params=new URLSearchParams(location.search);
 const selected=params.get("category")||"", letter=(params.get("letter")||"").toUpperCase(), page=Math.max(1,Number(params.get("page"))||1), viewAllCats=params.get("view")==="categories";
 const root=$("#catalogGrid"),status=$("#catalogStatus"),pager=$("#catalogPager"),nav=$("#catalogCategories"),az=$("#catalogAZ"),search=$("#catalogSearch"),heading=$("#catalogHeading");
 const allCatsPanel=$("#catalogAllCatsPanel"),allCatsToggle=$("#catalogAllCatsToggle");
 const pageSize=24;
 let data=null,all=[],apiCatalogMode=false,apiMeta=null,allApiCategories=[],apiSearchQuery="";
 const isNigerian=(item,sectionTitle="")=>{
  const sec=String(sectionTitle||"").trim();
  if(sec&&/\b(?:nollywood|must-watch\s*black\s*shows?|black\s*cinema|black\s*shows?|nigeria|nigerian|ghana)\b|bet\+/i.test(sec))return true;
  if(!item||typeof item!=="object")return false;
  const country=String(item.country||item.countryName||"").trim();
  if(/\b(?:nigeria|nollywood|ghana)\b/i.test(country))return true;
  const title=String(item.title||"").trim();
  const hay=`${title} ${item.language||""} ${item.genre||""} ${item.platform||""} ${country} ${item.description||item.storyline||""}`;
  if(/\b(?:nollywood|nigeria|nigerian|yoruba|igbo|hausa|naija|lagos|abuja|ekiti|enugu|anambra|ibadan|ogun|kano|odunlade|funke\s+akindele|iyabo\s+ojo|osita\s+iheme|chinedu\s+ikedieze|pete\s+edochie|ramsey\s+nouah|genevieve\s+nnaji|omoni\s+oboli|destiny\s+etiko|yul\s+edochie|zubby\s+michael|frederick\s+leonard|maurice\s+sam|ruth\s+kadiri|akotagiri|jagun\s+jagun|anik[uo]lapo|omo\s+ghetto|king\s+of\s+boys)\b/i.test(hay))return true;
  if(/^(?:akotagiri|save\s+my\s+life\s*2|the\s+wrong\s+boyfriend|love\s+is\s+blind|husband\s+on\s+lease|his\s+unloved\s+wife|unbreakable\s+bonds)$/i.test(title)&&!/\b(?:india|korean|japan|china|bangla|hindi|united\s+states|uk|turkey)\b/i.test(`${country} ${item.language||""}`))return true;
  return false;
 };
 const isUpcomingUnreleased=item=>{
  if(!item||typeof item!=="object")return false;
  const endToday=getEndOfTodayMs();
  const currentYear=new Date(Date.now()+6*3600*1000).getUTCFullYear();
  const rawDate=String(item.releaseDate||item.appointmentDate||"").trim();
  let hasPastReleaseDate=false;
  if(rawDate){
   const ts=Date.parse(rawDate);
   if(Number.isFinite(ts)&&ts>0){
    if(ts>endToday+2*86400*1000)return true;
    if(ts>endToday&&item.hasResource!==true)return true;
    if(ts<=endToday)hasPastReleaseDate=true;
   }
  }
  if(hasPastReleaseDate)return false;
  const yearNum=Number(String(item.year||"").match(/\b(19\d\d|20\d\d)\b/)?.[1]||0);
  if(yearNum>currentYear)return true;
  if(yearNum>0&&yearNum<currentYear&&item.isUpcoming!==true)return false;
  if(item.isUpcoming===true)return true;
  const titleBadge=`${item.title||""} ${item.typeBadge||""}`;
  if(/\b(?:upcoming|coming\s*soon|unreleased)\b/i.test(titleBadge)&&item.hasResource!==true)return true;
  return false;
 };
 const stripCatBrand=s=>String(s||"").replace(/\bmovie\s*(?:stream|link)\s*bd\b(?:\.com|\.at)?/gi,"").replace(/\s*[—–\-|:]+\s*$/g,"").replace(/^\s*[—–\-|:]+\s*/g,"").replace(/\s+/g," ").trim();
 const getEndOfTodayMs=()=>{const bdt=new Date(Date.now()+6*3600*1000);return Date.UTC(bdt.getUTCFullYear(),bdt.getUTCMonth(),bdt.getUTCDate(),23,59,59,999)-6*3600*1000;};
 const dateValue=value=>{
  if(value==null||value==="")return 0;
  const raw=typeof value==="object"?(value.timestamp||value.date||value.value||""):value;
  if(typeof raw==="number"||(typeof raw==="string"&&/^\d{9,16}$/.test(raw.trim()))){
   const n=Number(raw);
   if(Number.isFinite(n)&&n>0)return n<1e12?n*1000:n;
  }
  const s=String(raw).trim(),lower=s.toLowerCase(),now=Date.now();
  if(/\b(?:just now|now|today)\b/.test(lower))return now;
  if(/\byesterday\b/.test(lower))return now-86400*1000;
  const ago=/(\d+)\s*(sec(?:ond)?s?|min(?:ute)?s?|hrs?|hours?|days?|weeks?|months?|years?)\s*ago/i.exec(lower);
  if(ago){
   const n=Number(ago[1])||1,u=ago[2].toLowerCase();
   const mult=u.startsWith("sec")?1000:u.startsWith("min")?60*1000:u.startsWith("h")?3600*1000:u.startsWith("d")?86400*1000:u.startsWith("w")?7*86400*1000:u.startsWith("mo")?30*86400*1000:365*86400*1000;
   return Math.max(1,now-n*mult);
  }
  const parsed=Date.parse(s);
  return Number.isFinite(parsed)&&parsed>0?parsed:0;
 };
 const uploadTime=item=>{
  const fields=[item?.uploadedAtMs,item?.uploadTimestamp,item?.uploadedAt,item?.uploadTime,item?.uploadDate,item?.upload_date,item?.uploaded_on,item?.createdAtMs,item?.created_at,item?.createdAt,item?.dateAdded,item?.addedAt,item?.added_at,item?.publishedAt,item?.published_at,item?.lastUpdated,item?.updatedAt,item?.updated_at,item?.modifiedAt];
  for(const value of fields){const time=dateValue(value);if(time)return time;}
  return 0;
 };
 const releaseTime=item=>{
  const nowLimit=getEndOfTodayMs();
  const up=uploadTime(item);
  const validUp=up&&up<=nowLimit?up:0;
  let rel=0;
  const fields=[item?.releaseTimestamp,item?.releaseTime,item?.release_time,item?.releaseDate,item?.release_date,item?.releaseAt,item?.release_at,item?.firstAirDate,item?.first_air_date,item?.airDate,item?.air_date,item?.premiereDate,item?.premiere_date,item?.theatricalReleaseDate,item?.theatrical_release_date,item?.publishDate,item?.publish_date,item?.date];
  for(const value of fields){const time=dateValue(value);if(time){rel=time;break;}}
  if(!rel&&item?.year&&/^\d{4}$/.test(String(item.year))){const yt=Date.parse(String(item.year)+"-01-01");if(Number.isFinite(yt))rel=yt;}
  if(validUp>0&&rel>nowLimit)return validUp;
  return Math.max(validUp,rel)||up;
 };
 const latestFirst=(a,b)=>{
  const futureCutoff=getEndOfTodayMs(),ta=releaseTime(a),tb=releaseTime(b);
  const aFuture=ta>futureCutoff;
  const bFuture=tb>futureCutoff;
  if(aFuture!==bFuture)return aFuture?1:-1;
  if(aFuture&&bFuture)return ta-tb;
  return tb-ta||popularity(b)-popularity(a);
 };
 const popularity=item=>["views","viewCount","view_count","totalViews","total_views","downloads","downloadCount","popularity","watchCount","watch_count","visits","hits","playCount","play_count","view","watchers"].reduce((best,key)=>Math.max(best,Number(item?.[key])||0),0);
 const isKDramaItem=item=>{
  const textValue=[item?.title,item?.type,item?.typeBadge,item?.category,item?.categoryName,item?.categoryLabel,item?.categoryPath,item?.genre,item?.genres,item?.country,item?.language,...(Array.isArray(item?._sections)?item._sections:[])].flat().map(v=>typeof v==="object"?[v?.name,v?.label,v?.title,v?.path].filter(Boolean).join(" "):String(v||"")).join(" ").toLowerCase();
  return /k[- ]?drama|korean drama|south korea|korea drama/.test(textValue);
 };
 const recentYearCutoff=new Date(Date.now()+6*3600*1000).getUTCFullYear()-1;
 const isRecentTopRated=item=>Number(item?.year||0)>=recentYearCutoff||releaseTime(item)>=Date.UTC(recentYearCutoff,0,1);
 const categoryPriority=(a,b)=>selected==="/top-rated"?((isRecentTopRated(b)?1:0)-(isRecentTopRated(a)?1:0)||Number(b?.rating||0)-Number(a?.rating||0)||latestFirst(a,b)):latestFirst(a,b);
 const vals=item=>{
  const out=[];
  ["categoryPath","category","categoryName","categoryLabel","categorySlug","type","typeBadge","genre","language","country"].forEach(k=>{
   const v=item?.[k]; if(typeof v==="string")out.push(v); else if(v&&typeof v==="object")out.push(v.path,v.label,v.name,v.title);
  });
  ["categories","genres"].forEach(k=>(Array.isArray(item?.[k])?item[k]:[]).forEach(v=>out.push(typeof v==="string"?v:v?.path,v?.label,v?.name,v?.title)));
  return out.filter(Boolean).map(norm);
 };
 const isHindiDubbed=item=>{
  if(item?._hindiCatalog===true)return true;
  const language=norm(item?.language);
  const exact=value=>/^(hindi|hindi dubbed|hindi dub|hindi audio|hi|hin|हिंदी|हिन्दी)$/.test(norm(value));
  const hasHindi=value=>{
   if(Array.isArray(value))return value.some(hasHindi);
   if(value&&typeof value==="object"){
    const code=norm(value.code||value.languageCode||value.lang);
    return /^(hi|hin)$/.test(code)||[value.language,value.name,value.label,value.title].some(exact);
   }
   return exact(value)||/(^|[,;|/])\s*(hindi|hi|hin|हिंदी|हिन्दी)\s*($|[,;|/])/.test(norm(value));
  };
  const audioFields=[item?.audioLanguage,item?.audioLanguages,item?.dubLanguage,item?.dubLanguages,item?.dubbedLanguages,item?.availableAudio,item?.availableLanguages,item?.languages,item?.audio,item?.audioTrack,item?.audioTracks,item?.dubbing,item?.audioInfo,item?.audioOptions];
  const sections=(item?._sections||[]).map(norm);
  const explicitFlag=item?.isHindiDubbed===true||item?.hindiDubbed===true||item?.is_hindi_dubbed===true||item?.dubbed===true&&audioFields.some(hasHindi);
  return explicitFlag||audioFields.some(hasHindi)||sections.some(s=>s.includes("hindi dubbed")||s==="south indian & hindi dubbed"||s==="anime in hindi");
 };
 const badge=item=>isHindiDubbed(item)?"HINDI DUBBED":"";
 const pathOf=item=>{
  if(typeof item.path==="string"&&/^\/(?:mb|mlbd|movie|series|drama|anime)\//i.test(item.path))return item.path;
  try{const u=new URL(item.detailsEndpoint,location.origin);const p=u.searchParams.get("path");return p&&/^\/(?:mb|mlbd|movie|series|drama|anime)\//i.test(p)?p:"";}catch{return "";}
 };
 async function fetchJsonSafe(url,init){
  const res=await fetch(url,init);
  const raw=await res.text();
  const trimmed=String(raw||"").trim();
  if(trimmed.startsWith("<")||/^<!doctype/i.test(trimmed)){
   throw new Error("Server returned an HTML error page (HTTP "+res.status+").");
  }
  try{return{res,data:trimmed?JSON.parse(trimmed):{}};}catch{throw new Error("Invalid JSON response (HTTP "+res.status+").");}
 }
 function flatten(d){
  const map=new Map();
  const add=(item,section,source)=>{
   if(!item||typeof item!=="object")return;
   const key=pathOf(item)||norm(item.title);
   if(!key)return;
   if(!map.has(key))map.set(key,{...item,_sections:[],_sources:[]});
   const saved=map.get(key);
   if(section&&!saved._sections.includes(section))saved._sections.push(section);
   if(source&&!saved._sources.includes(source))saved._sources.push(source);
   if(!posterOf(saved)&&posterOf(item))saved.poster=posterOf(item);
  };
  (Array.isArray(d.sections)?d.sections:[]).forEach(s=>(Array.isArray(s.items)?s.items:[]).forEach(x=>add(x,text(s.title),"section")));
  (Array.isArray(d.allOfficialSections)?d.allOfficialSections:[]).forEach(s=>(Array.isArray(s.items)?s.items:[]).forEach(x=>add(x,text(s.title),"officialSection")));
  (Array.isArray(d.trending)?d.trending:[]).forEach(x=>add(x,"Trending Now","trending"));
  (Array.isArray(d.comingSoon)?d.comingSoon:[]).forEach(x=>add(x,"Coming Soon","comingSoon"));
  (Array.isArray(d.banners)?d.banners:[]).forEach(x=>add(x,"Featured","banner"));
  return [...map.values()].filter(item=>!isNigerian(item)).sort(categoryPriority);
 }
 const customLabels={
  "/":"All Releases",
  "cv:movie":"Movie",
  "cv:anime":"Anime",
  "cv:drama":"Drama",
  "cv:kdrama":"K-Drama",
  "cv:cdrama":"C-Drama",
  "cv:south":"South Movies",
  "cv:bollywood":"Bollywood",
  "cv:hollywood":"Hollywood",
  "/language/tamil":"Tamil Movies",
  "/language/telugu":"Telugu Movies",
  "/language/malayalam":"Malayalam Movies",
  "/language/punjabi":"Punjabi Movies",
  "/language/bangla":"Bangla Movies",
  "/language/bangla-dubbed":"Bangla Dubbed",
  "/language/dual-audio":"Dual Audio",
  "/language/kannada":"Kannada Movies",
  "/language/marathi":"Marathi Movies",
  "/language/gujrati":"Gujarati Movies",
  "/language/malaysian":"Malaysian Movies",
  "/language/vietnamese":"Vietnamese Movies",
  "/language/german":"German Movies",
  "/language/italian":"Italian Movies",
  "/language/portuguese":"Portuguese Movies",
  "/language/others":"Other Languages",
  "/language/japanese-drama":"Japanese Drama (J-Drama)",
  "/language/turkish":"Turkish Drama",
  "/indian-series":"Indian Web Series",
  "/bengali-series":"Bengali Series",
  "/language/hindi-dubbed-series":"Hindi Dubbed Web Series",
  "/top-rated":"IMDb Top Rated",
  "/top10":"Top 10 This Week",
  "/popular":"Most Popular",
  "/recently-updated":"Recently Updated",
  "/new":"New & Popular",
  "/mostwatch/7d":"Trending Now",
  "/category/wwe":"WWE & Wrestling",
  "/collection/mcu-marvel-cinematic-universe":"Marvel Cinematic Universe (MCU)",
  "/collection/dc-universe-dceu-dcu":"DC Universe (DCEU & DCU)",
  "/collection/best-bangla-dubbed-movies":"Best Bangla Dubbed Movies",
  "/collection/top-rated-hindi-dubbed-action":"Top Rated Hindi Dubbed Action",
  "/collection/bangla-web-series":"Bangla Web Series",
  "/collection/korean-drama-must-watch":"Korean Drama Must Watch",
  "/collection/south-indian-blockbusters":"South Indian Blockbusters",
  "/collection/horror-night":"Horror Night",
  "/collection/family-animation":"Family Animation",
  "/collection/thriller-mystery":"Thriller & Mystery",
  "/adult18plus":"Midnight (18+)",
  "/midnight":"Midnight (18+)",
  "/genre/adult":"Adult",
  "/genre/erotic":"Erotic",
  "/genre/hot":"Hot (18+)"
 };
 function groupOf(item){
  const sections=(item._sections||[]).map(norm),type=norm(item.typeBadge||item.type),country=norm(item.country);
  if(sections.some(s=>s.includes("k drama")||s.includes("k-drama")))return "kdrama";
  if(sections.some(s=>s.includes("c drama")||s.includes("c-drama")))return "cdrama";
  if(sections.some(s=>s.includes("south indian")||s.includes("south movie")))return "south";
  if(sections.some(s=>s.includes("bollywood")))return "bollywood";
  if(sections.some(s=>s.includes("hollywood")))return "hollywood";
  if(["united states","usa","us","united kingdom","uk","britain","american","british"].includes(country))return "hollywood";
  if(type==="anime"||sections.some(s=>s.includes("anime")))return "anime";
  if(type==="series"||type==="drama"||sections.some(s=>s.includes("drama")||s.includes("series")))return "drama";
  if(type==="movie")return "movie";
  return "";
 }
 function categoryMatches(item){
  if(!selected)return true;
  if(selected.startsWith("cv:"))return groupOf(item)===selected.slice(3);
  const c=(Array.isArray(data.categories)?data.categories:[]).find(x=>[x.path,x.slug,x.label,x.name,x.title].some(v=>norm(v)===norm(selected)));
  const path=text(c?.path||selected),label=norm(c?.label||c?.name||c?.title||selected);
  const sections=(item._sections||[]).map(norm),language=norm(item.language),type=norm(item.typeBadge);
  const genres=norm(item.sportGenre||item.genre||"").split(/[,/|]/).map(norm);
  if(path==="/"||label==="home")return true;
  if(path==="/mostwatch/7d")return (item._sources||[]).includes("trending");
  if(path==="/upcoming")return (item._sources||[]).includes("comingSoon")||sections.includes("coming soon");
  if(path==="/type/movies")return type==="movie";
  if(path==="/type/series")return type==="series"||type==="drama";
  if(path==="/anime"||path==="/genre/animation")return type==="anime"||genres.includes("animation");
  if(path==="/language/hindi-dubbed")return isHindiDubbed(item);
  if(path==="/language/hindi")return language==="hindi"||language==="hindi original"||language==="hindi dubbed";
  if(path==="/language/bangla")return language.includes("bangla")||language.includes("bengali")||sections.some(s=>s.includes("bangla")||s.includes("bengali"));
  if(path==="/language/bangla-dubbed")return language==="bangla dubbed"||sections.some(s=>s.includes("bangla dubbed"));
  if(path==="/language/dual-audio")return language.includes("dual")||sections.some(s=>s.includes("dual audio"));
  if(path.startsWith("/language/")){
   const wanted=norm(path.split("/").pop()).replace("gujrati","gujarati");
   return language===wanted||language.startsWith(wanted+" ")||sections.some(s=>s===label);
  }
  if(path.startsWith("/genre/")){
   const wanted=norm(path.split("/").pop());
   return genres.includes(wanted);
  }
  if(path==="/bollywood")return sections.includes("bollywood movie");
  if(path==="/southIndian")return sections.some(s=>s.includes("south indian"));
  if(path==="/collections")return sections.some(s=>s.includes("collection"));
  if(path.startsWith("/collection/")||path.startsWith("/category/")||path==="/drama"||path==="/ongoing"||path==="/adult18plus"||path==="/western-tv"){
   return sections.includes(label)||sections.some(s=>s===label||s.includes(label)||label.includes(s));
  }
  return sections.includes(label)||sections.some(s=>s===label);
 }
 function matches(item){
  if(!apiCatalogMode&&!categoryMatches(item))return false;
  if(letter&&letter!=="#"){
   if(!text(item.title).toUpperCase().startsWith(letter))return false;
  }else if(letter==="#"){
   if(/^[A-Z]/i.test(text(item.title)))return false;
  }
  const lang=norm($("#catalogLanguageFilter")?.value||"");
  const kind=norm($("#catalogTypeFilter")?.value||"");
  const genre=norm($("#catalogGenreFilter")?.value||"");
  if(lang&&!norm([item.language,item.audioLanguage,item.title,...(item._sections||[])].join(" ")).includes(lang))return false;
  if(kind&&!norm([item.type,item.typeBadge,item.mediaType].join(" ")).includes(kind))return false;
  if(genre&&!norm([item.genre,item.genres,item.category,item.categoryName].join(" ")).includes(genre))return false;
  const q=norm(search?.value||"");
  const qCompact=compact(q);
  const usingInitialSearch=Boolean(apiSearchQuery&&q&&q===apiSearchQuery);
  if(q&&!usingInitialSearch){
   const hayStr=norm([item.title,item.description,item.language,item.country,item.sportGenre,item.genre,...vals(item),...(item._sections||[])].join(" "));
   const hayCompact=compact(hayStr);
   if(!hayStr.includes(q)&&!(qCompact.length>=3&&hayCompact.includes(qCompact)))return false;
  }
  return true;
 }
 function card(item){
  const image=posterOf(item),p=/^(?:https?:\/\/|\/\/|\/api\/)/i.test(image)?image:"";
  const title=text(item.title)||"Untitled",path=pathOf(item),b=badge(item);
  if(selected==="/upcoming"||isUpcomingUnreleased(item)){
   return '<article class="movie-card movie-api-card cv-card-upcoming" aria-label="'+esc(title)+' (Coming Soon)" title="'+esc(title)+' — Coming Soon"><div class="movie-api-poster">'+(p?'<img loading="lazy" decoding="async" src="'+esc(p)+'" alt="'+esc(title)+' poster">':'<span class="movie-api-placeholder">MOVIESTREAM BD</span>')+'</div></article>';
  }
  return '<article class="movie-card movie-api-card"><button class="movie-api-poster" type="button" data-path="'+esc(path)+'" data-title="'+esc(title)+'" '+(!path?"disabled":"")+' aria-label="Open '+esc(title)+'">'+(p?'<img loading="lazy" decoding="async" src="'+esc(p)+'" alt="'+esc(title)+' poster">':'<span class="movie-api-placeholder">MOVIESTREAM BD</span>')+'<span class="quality">'+esc(item.quality||item.typeBadge||"HD")+'</span>'+(b?'<span class="movie-api-language-badge">'+b+'</span>':"")+'<span class="overlay">▶<small>View details &amp; watch</small></span></button><div class="movie-info"><h3>'+esc(title)+'</h3><p>'+esc(item.language||item.country||item.typeBadge||"")+'</p></div></article>';
 }
 function link(extra){const p=new URLSearchParams();if(selected)p.set("category",selected);if(letter)p.set("letter",letter);if(search?.value.trim())p.set("q",search.value.trim());Object.entries(extra||{}).forEach(([k,v])=>{if(v)p.set(k,String(v));else p.delete(k)});return "catalog.html?"+p.toString();}
 function render(){
  if(!data)return;
  const q=norm(search?.value||"");
  const keepSearchOrder=Boolean(apiSearchQuery&&q&&q===apiSearchQuery);
  const matched=all.filter(item=>!isNigerian(item)&&matches(item));
  const filtered=keepSearchOrder?matched:matched.sort(categoryPriority);
  const pages=apiCatalogMode
   ? Math.max(1,Number(apiMeta?.maxPage||apiMeta?.totalPages||apiMeta?.pages)||1)
   : Math.max(1,Math.ceil(filtered.length/pageSize));
  const safePage=Math.min(page,pages);
  const start=(safePage-1)*pageSize;
  const items=apiCatalogMode?filtered:filtered.slice(start,start+pageSize);
  root.innerHTML=items.map(card).join("")||'<p class="muted">এই Category-তে কোনো title পাওয়া যায়নি। অন্য Category নির্বাচন করো।</p>';
  const c=(data.categories||[]).find(x=>[x.path,x.slug,x.label,x.name,x.title].some(v=>norm(v)===norm(selected)));
  heading.textContent=selected?stripCatBrand(customLabels[selected]||c?.label||c?.name||c?.title||selected)||selected:"All Movies & Dramas A–Z";
  status.textContent=apiCatalogMode
   ? "Page "+safePage+" of "+pages+" · Showing "+items.length+" titles"
   : filtered.length+" titles · Page "+safePage+" of "+pages+" · Showing "+(filtered.length?start+1:0)+"–"+Math.min(start+pageSize,filtered.length);

  const pageNumbers=[...new Set([1,safePage-1,safePage,safePage+1,pages].filter(n=>n>=1&&n<=pages))].sort((a,b)=>a-b);
  let html="";
  if(safePage>1)html+='<a class="btn ghost" href="'+esc(link({page:safePage-1}))+'">‹ Previous</a>';
  let previous=0;
  pageNumbers.forEach(n=>{
   if(previous&&n-previous>1)html+='<span class="catalog-page-gap">…</span>';
   html+='<a class="btn '+(n===safePage?"primary":"ghost")+'" href="'+esc(link({page:n}))+'">'+n+'</a>';
   previous=n;
  });
  if(safePage<pages)html+='<a class="btn ghost" href="'+esc(link({page:safePage+1}))+'">Next ›</a>';
  pager.innerHTML=html;
 }
 function setAllCatsOpen(open){
  if(!allCatsPanel||!allCatsToggle)return;
  allCatsPanel.hidden=!open;
  allCatsToggle.setAttribute("aria-expanded",open?"true":"false");
  const total=allApiCategories.length||(Array.isArray(data?.categories)?data.categories.length:0);
  allCatsToggle.textContent=(open?"Hide Categories ▴":"All Categories"+(total?" ("+total+")":"")+" ▾");
 }
 function renderAllCatsPanel(cats){
  if(!allCatsPanel)return;
  if(!cats.length){allCatsPanel.hidden=true;return;}
  const groupsOrder=["Collections","Languages & Regions","Genres"];
  const grouped=new Map();
  cats.forEach(c=>{
   const g=text(c.group)||"Collections";
   if(!grouped.has(g))grouped.set(g,[]);
   grouped.get(g).push(c);
  });
  const orderedGroups=[...new Set([...groupsOrder,...grouped.keys()])].filter(g=>grouped.has(g));
  allCatsPanel.innerHTML=orderedGroups.map(groupName=>{
   const list=grouped.get(groupName)||[];
   return '<div class="cv-all-cats-group"><div class="cv-all-cats-group-title">'+esc(groupName)+' <span>('+list.length+')</span></div><div class="cv-all-cats-grid">'+
    list.map(c=>{
     const value=text(c.path)||text(c.slug)||text(c.label);
     const label=stripCatBrand(text(c.label)||text(c.name)||text(c.title)||value)||value;
     const icon=text(c.icon)||"🎬";
     const active=norm(value)===norm(selected);
     return '<a class="cv-all-cat-item '+(active?"active":"")+'" href="catalog.html?category='+encodeURIComponent(value)+'"><span class="cv-all-cat-ico" aria-hidden="true">'+icon+'</span><b>'+esc(label)+'</b></a>';
    }).join("")+
   '</div></div>';
  }).join("");
  const shouldOpen=viewAllCats||allCatsToggle?.getAttribute("aria-expanded")==="true";
  setAllCatsOpen(shouldOpen);
 }
 function renderNav(){
  const cats=allApiCategories.length?allApiCategories:(Array.isArray(data?.categories)?data.categories:[]);
  const seen=new Set(),items=[];
  cats.forEach(c=>{
   const value=text(c.path)||text(c.slug)||text(c.label)||text(c.name)||text(c.title);
   const rawLabel=text(c.label)||text(c.name)||text(c.title)||text(c.slug)||value;
   const label=stripCatBrand(rawLabel)||rawLabel,key=norm(value);
   if(value&&label&&!seen.has(key)){seen.add(key);items.push({value,label,group:c.group,icon:c.icon});}
  });
  const topQuick=items.filter(c=>c.group!=="Genres");
  const quickList=topQuick.length?topQuick:items;
  nav.innerHTML='<a class="catalog-chip '+(!selected?"active":"")+'" href="catalog.html">ALL A–Z</a>'+quickList.map(c=>'<a class="catalog-chip '+(norm(c.value)===norm(selected)?"active":"")+'" href="catalog.html?category='+encodeURIComponent(c.value)+'">'+esc(c.label)+'</a>').join("");
  renderAllCatsPanel(cats);
  const letters="ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
  az.innerHTML=letters.map(l=>'<a class="catalog-letter '+(letter===l?"active":"")+'" href="'+esc(link({letter:l,page:1}))+'">'+l+'</a>').join("");
 }
 async function loadFilterOptions(){
  try{
   const r=await fetch("/api/movie-api/filter-options");const d=await r.json();if(!r.ok||d.ok!==true)return;
   const fill=(id,values)=>{const el=$(id);if(!el)return;const current=el.value;[...new Set((Array.isArray(values)?values:[]).map(v=>typeof v==="string"?v:(v.label||v.name||v.value||v.title||"")).filter(Boolean))].forEach(v=>{const o=document.createElement("option");o.value=v;o.textContent=v;el.appendChild(o);});el.value=current;};
   fill("#catalogLanguageFilter",d.languages||d.language||d.audioLanguages);
   fill("#catalogTypeFilter",d.types||d.type||d.mediaTypes);
   fill("#catalogGenreFilter",d.genres||d.genre);
  }catch{}
 }
 ["#catalogLanguageFilter","#catalogTypeFilter","#catalogGenreFilter"].forEach(id=>$(id)?.addEventListener("change",render));
 async function ensureCategories(){
  if(allApiCategories.length)return allApiCategories;
  try{
   const r=await fetch("/api/movie-api/categories",{headers:{Accept:"application/json"},cache:"default"});
   const d=await r.json();
   if(r.ok&&d?.ok&&Array.isArray(d.categories)){allApiCategories=d.categories;return allApiCategories;}
  }catch{}
  return [];
 }
 async function load(){
  const q=params.get("q")||"";
  if(search)search.value=q;
  apiCatalogMode=false;
  apiMeta=null;
  try{
   const catsPromise=ensureCategories();
   if(q){
    /* Search directly. Do not wait for homepage data or download every Hindi catalog page. */
    const cats=await catsPromise;
    data={categories:cats};
    status.textContent="Searching movies and dramas…";
    const safeQs = localStorage.getItem("cv_family_safe_v1")==="1" ? "&safe=1" : "";
    const {res:response,data:payload}=await fetchJsonSafe("/api/movie-api/search?q="+encodeURIComponent(q)+"&page="+page+safeQs,{headers:{Accept:"application/json"},cache:"default"});
    if(!response.ok||payload.ok!==true)throw new Error(payload.error||"Movie Search API unavailable");
    const unique=new Map();
    (Array.isArray(payload.items)?payload.items:[]).filter(item=>!isNigerian(item)).forEach(item=>{
     const key=pathOf(item)||norm(item.title);
     if(key&&!unique.has(key))unique.set(key,{...item,_sections:[],_sources:["search"],_hindiCatalog:isHindiDubbed(item)});
    });
    all=[...unique.values()];
    apiSearchQuery=norm(q);
    if(!all.length)status.textContent="No matching movies or dramas found.";
   }else{
    status.textContent="Loading Movie API catalog…";
    const [{res:response,data:payload},cats]=await Promise.all([
     fetchJsonSafe("/api/movie-api/home",{headers:{Accept:"application/json"},cache:"default"}),
     catsPromise
    ]);
    if(!response.ok||payload.ok!==true)throw new Error(payload.error||"Movie API unavailable");
    data=payload;
    if(cats.length)data.categories=cats;
    else if(Array.isArray(payload.categories)&&payload.categories.length)allApiCategories=payload.categories;
    const customPaths={
     "cv:movie":"/type/movies",
     "cv:anime":"/anime",
     "cv:drama":"/drama",
     "cv:kdrama":"/language/korean",
     "cv:cdrama":"/language/chinese",
     "cv:south":"/southIndian",
     "cv:bollywood":"/bollywood",
     "cv:hollywood":"/language/english"
    };
    const category=(data.categories||[]).find(x=>[x.path,x.slug,x.label,x.name,x.title].some(v=>norm(v)===norm(selected)));
    const apiPath=customPaths[selected]||text(category?.path)||(selected.startsWith("/")?selected:(!selected?"/all":""));
    if(apiPath&&(apiPath!=="/"||selected==="/")){
     status.textContent="Loading "+(stripCatBrand(category?.label||customLabels[selected]||"All Content")||"All Content")+" · Page "+page+"…";
     const {res:cr,data:pagePayload}=await fetchJsonSafe("/api/movie-api/catalog?category="+encodeURIComponent(apiPath)+"&page="+Math.max(1,Math.min(100,page)),{headers:{Accept:"application/json"},cache:"default"});
     if(!cr.ok||pagePayload.ok!==true)throw new Error(pagePayload.error||"Movie Catalog API unavailable");
     const unique=new Map();
     (Array.isArray(pagePayload.items)?pagePayload.items:[]).forEach(item=>{
      const key=pathOf(item)||norm(item.title);
      if(key&&!unique.has(key))unique.set(key,{...item,_sections:[],_sources:["catalog"]});
     });
     all=[...unique.values()].filter(item=>!isNigerian(item)).map(item=>apiPath==="/language/hindi-dubbed"?({...item,_hindiCatalog:true}):item);
     apiCatalogMode=true;
     apiMeta=pagePayload;
    }else{
     all=flatten(data);
    }
   }
   renderNav();
   render();
  }catch(e){status.textContent="Catalog load failed: "+(e.message||"Unknown error");}
 }
  root.addEventListener("click",e=>{const b=e.target.closest("[data-path]");if(b?.dataset.path)location.href="watch.html?path="+encodeURIComponent(b.dataset.path)+"&title="+encodeURIComponent(b.dataset.title||"");});
  function saveSearchHistory(q){
   const clean=String(q||"").trim();
   if(clean.length<2)return;
   if(window.CineVerseSearch?.saveHistory){window.CineVerseSearch.saveHistory(clean);return;}
   try{
    const list=JSON.parse(localStorage.getItem("cv_recent_searches_v1")||"[]");
    const arr=(Array.isArray(list)?list:[]).filter(x=>(typeof x==="string"?x:x?.q||"").toLowerCase()!==clean.toLowerCase());
    localStorage.setItem("cv_recent_searches_v1",JSON.stringify([{q:clean,type:"0",ts:Date.now()},...arr].slice(0,15)));
   }catch{}
  }
  function renderCatalogHistory(){
   const bar=$("#catalogSearchHistory");if(!bar)return;
   let items=[];
   if(window.CineVerseSearch?.getHistory){items=window.CineVerseSearch.getHistory();}
   else{try{items=(JSON.parse(localStorage.getItem("cv_recent_searches_v1")||"[]")||[]).map(x=>typeof x==="string"?{q:x}:x).filter(x=>x?.q);}catch{items=[];}}
   if(!items.length){bar.hidden=true;bar.innerHTML="";return;}
   bar.hidden=false;
   bar.innerHTML='<span class="cv-catalog-history-label">Recent Searches:</span>'+
    items.slice(0,8).map(item=>'<span class="cv-history-pill"><a class="cv-history-pill-link" href="catalog.html?q='+encodeURIComponent(item.q)+'">'+esc(item.q)+'</a><button type="button" class="cv-history-pill-del" data-cat-del-history="'+esc(item.q)+'" aria-label="Remove '+esc(item.q)+'">×</button></span>').join("")+
    '<button type="button" class="cv-clear-btn" id="catalogHistoryClear" style="margin-left:auto">Clear</button>';
  }
  $("#catalogSearchHistory")?.addEventListener("click",e=>{
   const del=e.target.closest("[data-cat-del-history]");
   if(del){
    const q=del.dataset.catDelHistory||"";
    if(window.CineVerseSearch?.removeHistory)window.CineVerseSearch.removeHistory(q);
    else{try{const list=JSON.parse(localStorage.getItem("cv_recent_searches_v1")||"[]").filter(x=>(typeof x==="string"?x:x?.q||"").toLowerCase()!==q.toLowerCase());localStorage.setItem("cv_recent_searches_v1",JSON.stringify(list));}catch{}}
    renderCatalogHistory();return;
   }
   if(e.target.closest("#catalogHistoryClear")){
    if(window.CineVerseSearch?.clearHistory)window.CineVerseSearch.clearHistory();
    else{try{localStorage.removeItem("cv_recent_searches_v1");}catch{}}
    renderCatalogHistory();
   }
  });
  window.addEventListener("cv:search-history-change",renderCatalogHistory);
  if(params.get("q"))saveSearchHistory(params.get("q"));
  search?.addEventListener("keydown",e=>{if(e.key==="Enter"){saveSearchHistory(search.value);location.href=link({page:1});}});
  $("#catalogSearchButton")?.addEventListener("click",()=>{saveSearchHistory(search?.value);location.href=link({page:1});});
  allCatsToggle?.addEventListener("click",()=>{const isOpen=allCatsToggle.getAttribute("aria-expanded")==="true";setAllCatsOpen(!isOpen);});
  $("#catalogRefresh")?.addEventListener("click",load);
  renderCatalogHistory();loadFilterOptions();load();
 })();