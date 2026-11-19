(() => {
 "use strict";
 const $=s=>document.querySelector(s);
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const safeUrl=v=>{try{const u=new URL(String(v||""),location.origin);return ["http:","https:"].includes(u.protocol)?u.href:"";}catch{return "";}};
 const pathOf=x=>typeof x?.path==="string"&&x.path.startsWith("/mb/")?x.path:"";
 const imageOf=x=>safeUrl(x?.poster||x?.previewImage||x?.thumbnail||x?.image||x?.cover||x?.posterUrl);
 const titleOf=x=>String(x?.title||x?.name||x?.label||x?.keyword||x?.suggestion||x?.text||x?.value||x?.query||"Untitled");
 const arrays=d=>{
  const preferred=[];
  const seen=new Set();
  const walk=(v,key="",depth=0)=>{
   if(depth>5||v==null)return;
   if(Array.isArray(v)){
    const values=v.filter(x=>typeof x==="string"||typeof x==="number"||(x&&typeof x==="object"));
    if(values.length&&/(suggest|hot|keyword|items|list|results|records|data|categories|shorts|videos|sports|upcoming)/i.test(key)){
     const sig=values.map(x=>typeof x==="object"?titleOf(x):String(x)).join("|");
     if(!seen.has(sig)){seen.add(sig);preferred.push({key,values});}
    }
    v.forEach(x=>{if(x&&typeof x==="object")walk(x,key,depth+1);});
    return;
   }
   if(typeof v==="object")Object.entries(v).forEach(([k,x])=>walk(x,k,depth+1));
  };
  walk(d);
  preferred.sort((a,b)=>{
   const score=k=>(/suggest|hot|keyword/i.test(k)?3:/items|list|results|records|data/i.test(k)?2:1);
   return score(b.key)-score(a.key)||b.values.length-a.values.length;
  });
  return preferred[0]?.values||[];
 }
 const api=async(path)=>{const r=await fetch(path,{headers:{Accept:"application/json"}});const d=await r.json().catch(()=>({}));if(!r.ok||d.ok===false)throw new Error(d.error||"API unavailable");return d;};
 const section=(id,title,eyebrow,items,mode="cards")=>{
  if(!items.length)return "";
  const cards=items.slice(0,12).map(x=>{
   const p=pathOf(x),img=imageOf(x),title=titleOf(x),sub=x.language||x.categoryName||x.type||x.description||"";
   const href=p?"watch.html?path="+encodeURIComponent(p):safeUrl(x.url||x.link||x.playUrl||x.webUrl);
   return '<a class="cv-extra-card" href="'+esc(href||"#")+'" '+(!href?'aria-disabled="true"':'')+'>'+(img?'<img loading="lazy" src="'+esc(img)+'" alt="">':'<span class="cv-extra-placeholder">▶</span>')+'<span class="cv-extra-copy"><b>'+esc(title)+'</b><small>'+esc(sub)+'</small></span></a>';
  }).join("");
  return '<section class="cv-extra-section" id="'+esc(id)+'"><div class="section-head"><div><p class="eyebrow">'+esc(eyebrow)+'</p><h2>'+esc(title)+'</h2></div></div><div class="cv-extra-grid">'+cards+'</div></section>';
 };
 const extras=$("#movieApiExtraSections");
 const search=$("#movieApiSearch");
 if(search){
  const wrap=document.createElement("div");wrap.className="cv-search-wrap";search.parentNode.insertBefore(wrap,search);wrap.appendChild(search);
  const panel=document.createElement("div");panel.className="cv-search-panel";panel.hidden=true;wrap.appendChild(panel);
  let timer=0,request=0;
  const show=(items)=>{panel.innerHTML=items.slice(0,8).map(x=>{const p=pathOf(x),t=typeof x==="string"?x:titleOf(x);return '<a href="'+(p?'watch.html?path='+encodeURIComponent(p):'catalog.html?q='+encodeURIComponent(t))+'">'+esc(t)+'</a>';}).join("");panel.hidden=!items.length;};
  search.addEventListener("input",()=>{clearTimeout(timer);const q=search.value.trim();if(q.length<2){panel.hidden=true;return;}timer=setTimeout(async()=>{const id=++request;try{const d=await api("/api/movie-api/suggest?q="+encodeURIComponent(q));if(id!==request)return;show(arrays(d));}catch{panel.hidden=true;}},260);});
  document.addEventListener("click",e=>{if(!wrap.contains(e.target))panel.hidden=true;});
  search.addEventListener("keydown",e=>{if(e.key==="Escape")panel.hidden=true;});
 }
 const addHotSearch=async()=>{
  try{const d=await api("/api/movie-api/hot-search");const items=arrays(d);if(!items.length)return;
   const box=document.createElement("section");box.className="cv-hot-search";box.innerHTML='<div><p class="eyebrow">TRENDING QUERIES</p><h2>Hot Search</h2></div><div class="cv-hot-chips">'+items.slice(0,14).map(x=>{const q=typeof x==="string"?x:titleOf(x);return '<a href="catalog.html?q='+encodeURIComponent(q)+'">'+esc(q)+'</a>';}).join("")+'</div>';
   const tools=$(".movie-api-tools");(tools||extras||document.querySelector("#movieApiCatalog"))?.after(box);
  }catch{}
 };
 const loadExtras=async()=>{
  if(!extras)return;
  const jobs=[["upcoming","/api/movie-api/upcoming?page=1","Upcoming Releases","COMING SOON"],["shorts","/api/movie-api/shorts?page=1","Movie Shorts","QUICK WATCH"],["sports","/api/movie-api/sports","Live Sports","SPORTS & LIVE EVENTS"]];
  const results=await Promise.all(jobs.map(async([id,url])=>{try{return {id,items:arrays(await api(url))};}catch{return {id,items:[]};}}));
  extras.innerHTML=results.map(r=>{const def=jobs.find(x=>x[0]===r.id);return section(r.id,def[2],def[3],r.items);}).join("");
 };
 const loadCategories=async()=>{
  try{const d=await api("/api/movie-api/categories");const cats=arrays(d).flat();const nav=$("#movieApiCategories");if(!nav||!cats.length)return;
   const existing=new Set([...nav.querySelectorAll("a")].map(a=>a.textContent.trim().toLowerCase()));
   cats.forEach(c=>{const label=titleOf(c),path=String(c.path||c.categoryPath||c.slug||"");if(!label||existing.has(label.toLowerCase()))return;const a=document.createElement("a");a.className="catalog-chip";a.textContent=label;a.href="catalog.html?category="+encodeURIComponent(path.startsWith("/")?path:"/"+path);nav.appendChild(a);});
  }catch{}
 };
 addHotSearch();loadExtras();loadCategories();
})();