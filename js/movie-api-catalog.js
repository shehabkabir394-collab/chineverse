(() => {
 "use strict";
 const $=s=>document.querySelector(s);
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const text=v=>typeof v==="string"?v.trim():"";
 const norm=v=>text(v).toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
 const params=new URLSearchParams(location.search);
 const selected=params.get("category")||"", letter=(params.get("letter")||"").toUpperCase(), page=Math.max(1,Number(params.get("page"))||1);
 const root=$("#catalogGrid"),status=$("#catalogStatus"),pager=$("#catalogPager"),nav=$("#catalogCategories"),az=$("#catalogAZ"),search=$("#catalogSearch"),heading=$("#catalogHeading");
 const pageSize=24;
 let data=null,all=[],apiCatalogMode=false,apiMeta=null;
 const isNigerian=item=>{
  const fields=[item?.country,item?.originCountry,item?.productionCountry,item?.originalCountry,item?.nationality,item?.region,item?.title,item?.language,item?.originalLanguage,item?.productionCountries,item?.countries,item?.description,...(Array.isArray(item?._sections)?item._sections:[])];
  return fields.some(v=>Array.isArray(v)?v.some(x=>/nigeria|nigerian|nollywood|naija/i.test(String(x?.name||x?.code||x||""))):/nigeria|nigerian|nollywood|naija/i.test(String(v||"")));
 };
 const releaseTime=item=>{
  const fields=[item?.uploadedAtMs,item?.uploadTimestamp,item?.uploadedAt,item?.uploadTime,item?.uploadDate,item?.upload_date,item?.uploaded_on,item?.createdAtMs,item?.created_at,item?.createdAt,item?.dateAdded,item?.addedAt,item?.added_at,item?.publishedAt,item?.published_at,item?.lastUpdated,item?.updatedAt,item?.updated_at,item?.modifiedAt,item?.releaseTimestamp,item?.releaseDate,item?.release_date,item?.firstAirDate,item?.first_air_date,item?.year];
  for(const v of fields){if(v==null||v==="")continue;const raw=typeof v==="object"?(v.timestamp||v.date||v.value||""):v;if(typeof raw==="number"||(typeof raw==="string"&&/^\d{9,16}$/.test(raw.trim()))){const n=Number(raw);if(Number.isFinite(n)&&n>0)return n<1e12?n*1000:n;}const d=Date.parse(String(raw));if(Number.isFinite(d))return d;}
  return 0;
 };
 const latestFirst=(a,b)=>releaseTime(b)-releaseTime(a);
 const popularity=item=>["views","viewCount","view_count","totalViews","total_views","downloads","downloadCount","popularity","watchCount","watch_count","visits","hits","playCount","play_count","view","watchers"].reduce((best,key)=>Math.max(best,Number(item?.[key])||0),0);
 const isKDramaItem=item=>{
  const textValue=[item?.title,item?.type,item?.typeBadge,item?.category,item?.categoryName,item?.categoryLabel,item?.categoryPath,item?.genre,item?.genres,item?.country,item?.language,...(Array.isArray(item?._sections)?item._sections:[])].flat().map(v=>typeof v==="object"?[v?.name,v?.label,v?.title,v?.path].filter(Boolean).join(" "):String(v||"")).join(" ").toLowerCase();
  return /k[- ]?drama|korean drama|south korea|korea drama/.test(textValue);
 };
 const categoryPriority=(a,b)=>latestFirst(a,b)||popularity(b)-popularity(a)||Number(isHindiDubbed(b))-Number(isHindiDubbed(a))||Number(isKDramaItem(b))-Number(isKDramaItem(a));
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
  return exact(item?.language)||audioFields.some(hasHindi)||sections.some(s=>s.includes("hindi dubbed")||s==="south indian & hindi dubbed"||s==="anime in hindi");
 };
 const badge=item=>isHindiDubbed(item)?"HINDI DUBBED":"";
 const pathOf=item=>{
  if(typeof item.path==="string"&&item.path.startsWith("/mb/"))return item.path;
  try{const u=new URL(item.detailsEndpoint);const p=u.searchParams.get("path");return p?.startsWith("/mb/")?p:"";}catch{return "";}
 };
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
   if(!saved.poster&&item.poster)saved.poster=item.poster;
  };
  (Array.isArray(d.sections)?d.sections:[]).forEach(s=>(Array.isArray(s.items)?s.items:[]).forEach(x=>add(x,text(s.title),"section")));
  (Array.isArray(d.allOfficialSections)?d.allOfficialSections:[]).forEach(s=>(Array.isArray(s.items)?s.items:[]).forEach(x=>add(x,text(s.title),"officialSection")));
  (Array.isArray(d.trending)?d.trending:[]).forEach(x=>add(x,"Trending Now","trending"));
  (Array.isArray(d.comingSoon)?d.comingSoon:[]).forEach(x=>add(x,"Coming Soon","comingSoon"));
  (Array.isArray(d.banners)?d.banners:[]).forEach(x=>add(x,"Featured","banner"));
  return [...map.values()].filter(item=>!isNigerian(item)).sort(categoryPriority);
 }
 const customLabels={"cv:movie":"Movie","cv:anime":"Anime","cv:drama":"Drama","cv:kdrama":"K-Drama","cv:cdrama":"C-Drama","cv:south":"South Movies","cv:bollywood":"Bollywood","cv:hollywood":"Hollywood"};
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
  if(path==="/language/bangla-dubbed")return language==="bangla dubbed"||sections.some(s=>s.includes("bangla dubbed"));
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
  if(lang&&norm(item.language)!==lang)return false;
  if(kind&&!norm([item.type,item.typeBadge,item.mediaType].join(" ")).includes(kind))return false;
  if(genre&&!norm([item.genre,item.genres,item.category,item.categoryName].join(" ")).includes(genre))return false;
  const q=norm(search?.value||"");
  if(q&&!norm([item.title,item.description,item.language,item.country,item.sportGenre,item.genre,...vals(item),...(item._sections||[])].join(" ")).includes(q))return false;
  return true;
 }
 function card(item){
  const p=/^https:\/\//i.test(item.poster||item.previewImage||"")?(item.poster||item.previewImage):"";
  const title=text(item.title)||"Untitled",path=pathOf(item),b=badge(item);
  return '<article class="movie-card movie-api-card"><button class="movie-api-poster" type="button" data-path="'+esc(path)+'" '+(!path?"disabled":"")+' aria-label="Open '+esc(title)+'">'+(p?'<img loading="lazy" decoding="async" src="'+esc(p)+'" alt="'+esc(title)+' poster">':'<span class="movie-api-placeholder">CINEVERSE</span>')+'<span class="quality">'+esc(item.quality||item.typeBadge||"HD")+'</span>'+(b?'<span class="movie-api-language-badge">'+b+'</span>':"")+'<span class="overlay">▶<small>View details &amp; watch</small></span></button><div class="movie-info"><h3>'+esc(title)+'</h3><p>'+esc(item.language||item.country||item.typeBadge||"")+'</p></div></article>';
 }
 function link(extra){const p=new URLSearchParams();if(selected)p.set("category",selected);if(letter)p.set("letter",letter);if(search?.value.trim())p.set("q",search.value.trim());Object.entries(extra||{}).forEach(([k,v])=>{if(v)p.set(k,String(v));else p.delete(k)});return "catalog.html?"+p.toString();}
 function render(){
  if(!data)return;
  const filtered=all.filter(item=>!isNigerian(item)&&isHindiDubbed(item)&&matches(item)).sort(latestFirst);
  const pages=Math.max(1,Math.ceil(filtered.length/pageSize));
  const safePage=Math.min(page,pages);
  const start=(safePage-1)*pageSize;
  const items=filtered.slice(start,start+pageSize);
  root.innerHTML=items.map(card).join("")||'<p class="muted">এই Category-তে কোনো title পাওয়া যায়নি। অন্য Category নির্বাচন করো।</p>';
  const c=(data.categories||[]).find(x=>[x.path,x.slug,x.label,x.name,x.title].some(v=>norm(v)===norm(selected)));
  heading.textContent=selected?(customLabels[selected]||c?.label||c?.name||c?.title||selected):"All Movies & Dramas A–Z";
  status.textContent=apiCatalogMode
   ? "Page "+safePage+" of "+pages+" · Showing "+filtered.length+" titles"
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
 function renderNav(){
  const cats=Array.isArray(data.categories)?data.categories:[];
  const seen=new Set(),items=[];
  cats.forEach(c=>{
   const value=text(c.path)||text(c.slug)||text(c.label)||text(c.name)||text(c.title);
   const label=text(c.label)||text(c.name)||text(c.title)||text(c.slug)||value,key=norm(value);
   if(value&&label&&!seen.has(key)){seen.add(key);items.push({value,label});}
  });
  const custom=Object.entries(customLabels).map(([value,label])=>'<a class="catalog-chip '+(selected===value?"active":"")+'" href="catalog.html?category='+encodeURIComponent(value)+'">'+esc(label)+'</a>').join("");
  nav.innerHTML='<a class="catalog-chip '+(!selected?"active":"")+'" href="catalog.html">ALL A–Z</a>'+custom+items.map(c=>'<a class="catalog-chip '+(norm(c.value)===norm(selected)?"active":"")+'" href="catalog.html?category='+encodeURIComponent(c.value)+'">'+esc(c.label)+'</a>').join("");
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
 async function load(){
  status.textContent="Loading Movie API catalog…";
  try{
   const r=await fetch("/api/movie-api/home");
   const d=await r.json();
   if(!r.ok||d.ok!==true)throw new Error(d.error||"Movie API unavailable");
   data=d;
   const q=params.get("q")||"";
   if(search)search.value=q;
   apiCatalogMode=false;
   apiMeta=null;

   if(q){
    status.textContent="Searching Hindi-dubbed movies and dramas…";
    const [sr,hr]=await Promise.all([
     fetch("/api/movie-api/search?q="+encodeURIComponent(q)+"&page="+page),
     fetch("/api/movie-api/catalog?path="+encodeURIComponent("/language/hindi-dubbed")+"&page=1")
    ]);
    const [sd,hd]=await Promise.all([sr.json(),hr.json()]);
    if(!sr.ok||sd.ok!==true)throw new Error(sd.error||"Movie Search API unavailable");
    if(!hr.ok||hd.ok!==true)throw new Error(hd.error||"Hindi catalog unavailable");
    const hindiPages=[hd],maxPage=Math.max(1,Math.min(100,Number(hd.maxPage)||1));
    for(let start=2;start<=maxPage;start+=6){
     const batch=await Promise.all(Array.from({length:Math.min(6,maxPage-start+1)},(_,i)=>start+i).map(async p=>{
      const response=await fetch("/api/movie-api/catalog?path="+encodeURIComponent("/language/hindi-dubbed")+"&page="+p);
      const payload=await response.json();
      if(!response.ok||payload.ok!==true)throw new Error(payload.error||"Hindi catalog page "+p+" unavailable");
      return payload;
     }));
     hindiPages.push(...batch);
    }
    const unique=new Map();
    (Array.isArray(sd.items)?sd.items:[]).filter(item=>!isNigerian(item)&&isHindiDubbed(item)).forEach(item=>{
     const key=pathOf(item)||norm(item.title);if(key)unique.set(key,{...item,_sections:[],_sources:["search"]});
    });
    hindiPages.forEach(payload=>(Array.isArray(payload.items)?payload.items:[]).forEach(item=>{
     const key=pathOf(item)||norm(item.title);if(key&&!isNigerian(item)&&!unique.has(key))unique.set(key,{...item,_sections:[],_sources:["hindiCatalog"],_hindiCatalog:true});
    }));
    all=[...unique.values()];
   }else{
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
    const apiPath=customPaths[selected]||text(category?.path)||(selected.startsWith("/")?selected:"");

    if(apiPath&&apiPath!=="/"){
     status.textContent="Loading "+(category?.label||customLabels[selected]||"Category")+" · Page "+page+"…";
     const cr=await fetch("/api/movie-api/catalog?path="+encodeURIComponent(apiPath)+"&page=1");
     const cd=await cr.json();
     if(!cr.ok||cd.ok!==true)throw new Error(cd.error||"Movie Catalog API unavailable");
     const maxPage=Math.max(1,Math.min(100,Number(cd.maxPage)||1));
     const pages=[cd];
     for(let start=2;start<=maxPage;start+=6){
      const batch=await Promise.all(Array.from({length:Math.min(6,maxPage-start+1)},(_,i)=>start+i).map(async p=>{
       const response=await fetch("/api/movie-api/catalog?path="+encodeURIComponent(apiPath)+"&page="+p);
       const payload=await response.json();
       if(!response.ok||payload.ok!==true)throw new Error(payload.error||"Movie Catalog API page "+p+" unavailable");
       return payload;
      }));
      pages.push(...batch);
     }
     const unique=new Map();
     pages.forEach(payload=>(Array.isArray(payload.items)?payload.items:[]).forEach(item=>{
      const key=pathOf(item)||norm(item.title);
      if(key&&!unique.has(key))unique.set(key,{...item,_sections:[],_sources:["catalog"]});
     }));
     all=[...unique.values()].filter(item=>!isNigerian(item)).map(item=>apiPath==="/language/hindi-dubbed"?({...item,_hindiCatalog:true}):item);
     apiCatalogMode=true;
     apiMeta=cd;
    }else{
     all=flatten(d);
    }
   }
   renderNav();
   render();
  }catch(e){status.textContent="Catalog load failed: "+(e.message||"Unknown error");}
 }
 root.addEventListener("click",e=>{const b=e.target.closest("[data-path]");if(b?.dataset.path)location.href="watch.html?path="+encodeURIComponent(b.dataset.path);});
 search?.addEventListener("keydown",e=>{if(e.key==="Enter")location.href=link({page:1});});
 $("#catalogSearchButton")?.addEventListener("click",()=>location.href=link({page:1}));
 $("#catalogRefresh")?.addEventListener("click",load);
 loadFilterOptions();load();
})();