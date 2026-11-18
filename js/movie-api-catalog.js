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
 let data=null,all=[];
 const vals=item=>{
  const out=[];
  ["categoryPath","category","categoryName","categoryLabel","categorySlug","type","typeBadge","genre","language","country"].forEach(k=>{
   const v=item?.[k]; if(typeof v==="string")out.push(v); else if(v&&typeof v==="object")out.push(v.path,v.label,v.name,v.title);
  });
  ["categories","genres"].forEach(k=>(Array.isArray(item?.[k])?item[k]:[]).forEach(v=>out.push(typeof v==="string"?v:v?.path,v?.label,v?.name,v?.title)));
  return out.filter(Boolean).map(norm);
 };
 const badge=item=>{
  const l=String(item.language||"").toUpperCase(),t=String(item.title||"").toUpperCase();
  return l.includes("HINDI DUB")||t.includes("HINDI DUB")?"HINDI DUBBED":l.includes("HINDI")||/\[HINDI\]|\(HINDI\)/.test(t)?"HINDI":"";
 };
 const pathOf=item=>{
  if(typeof item.path==="string"&&item.path.startsWith("/mb/"))return item.path;
  try{const u=new URL(item.detailsEndpoint);const p=u.searchParams.get("path");return p?.startsWith("/mb/")?p:"";}catch{return "";}
 };
 function flatten(d){
  const map=new Map();
  const add=(item,section)=>{
   if(!item||typeof item!=="object")return;
   const key=pathOf(item)||norm(item.title);
   if(!key)return;
   if(!map.has(key))map.set(key,{...item,_sections:[]});
   const saved=map.get(key);
   if(section&&!saved._sections.includes(section))saved._sections.push(section);
   if(!saved.poster&&item.poster)saved.poster=item.poster;
  };
  (Array.isArray(d.sections)?d.sections:[]).forEach(s=>(Array.isArray(s.items)?s.items:[]).forEach(x=>add(x,text(s.title))));
  (Array.isArray(d.trending)?d.trending:[]).forEach(x=>add(x,"Trending Now"));
  (Array.isArray(d.comingSoon)?d.comingSoon:[]).forEach(x=>add(x,"Coming Soon"));
  return [...map.values()].sort((a,b)=>{
   const ah=badge(a).startsWith("HINDI")?1:0,bh=badge(b).startsWith("HINDI")?1:0;
   if(ah!==bh)return bh-ah;
   return (Number(b.uploadedAtMs)||0)-(Number(a.uploadedAtMs)||0)||text(a.title).localeCompare(text(b.title));
  });
 }
 function matches(item){
  if(selected){
   const c=(Array.isArray(data.categories)?data.categories:[]).find(x=>[x.path,x.slug,x.label,x.name,x.title].some(v=>norm(v)===norm(selected)));
   const label=norm(c?.label||c?.name||c?.title||selected);
   const values=[...vals(item),...(item._sections||[]).map(norm)];
   if(!values.some(v=>v===norm(selected)||v.includes(norm(selected))||v.includes(label)||label.includes(v)))return false;
  }
  if(letter&&letter!=="#"){
   if(!text(item.title).toUpperCase().startsWith(letter))return false;
  }else if(letter==="#"){
   if(/^[A-Z]/i.test(text(item.title)))return false;
  }
  const q=norm(search?.value||"");
  if(q&&!norm([item.title,item.description,item.language,item.country,item.genre,...vals(item),...(item._sections||[])].join(" ")).includes(q))return false;
  return true;
 }
 function card(item){
  const p=/^https:\/\//i.test(item.poster||item.previewImage||"")?(item.poster||item.previewImage):"";
  const title=text(item.title)||"Untitled",path=pathOf(item),b=badge(item);
  return '<article class="movie-card movie-api-card"><button class="movie-api-poster" type="button" data-path="'+esc(path)+'" '+(!path?"disabled":"")+' aria-label="Open '+esc(title)+'">'+(p?'<img loading="lazy" src="'+esc(p)+'" alt="'+esc(title)+' poster">':'<span class="movie-api-placeholder">CINEVERSE</span>')+'<span class="quality">'+esc(item.quality||item.typeBadge||"HD")+'</span>'+(b?'<span class="movie-api-language-badge">'+b+'</span>':"")+'<span class="overlay">▶<small>View details &amp; watch</small></span></button><div class="movie-info"><h3>'+esc(title)+'</h3><p>'+esc(item.language||item.country||item.typeBadge||"")+'</p></div></article>';
 }
 function link(extra){const p=new URLSearchParams();if(selected)p.set("category",selected);if(letter)p.set("letter",letter);if(search?.value.trim())p.set("q",search.value.trim());Object.entries(extra||{}).forEach(([k,v])=>{if(v)p.set(k,String(v));else p.delete(k)});return "catalog.html?"+p.toString();}
 function render(){
  if(!data)return;
  const filtered=all.filter(matches),pages=Math.max(1,Math.ceil(filtered.length/pageSize)),safePage=Math.min(page,pages),start=(safePage-1)*pageSize,items=filtered.slice(start,start+pageSize);
  root.innerHTML=items.map(card).join("")||'<p class="muted">এই Category-তে কোনো title পাওয়া যায়নি। অন্য Category নির্বাচন করো।</p>';
  const c=(data.categories||[]).find(x=>[x.path,x.slug,x.label,x.name,x.title].some(v=>norm(v)===norm(selected)));
  heading.textContent=selected?(c?.label||c?.name||c?.title||selected):"All Movies & Dramas A–Z";
  status.textContent=filtered.length+" titles · Page "+safePage+" of "+pages+" · Showing "+(filtered.length?start+1:0)+"–"+Math.min(start+pageSize,filtered.length);
  pager.innerHTML=Array.from({length:pages},(_,i)=>'<a class="btn '+(i+1===safePage?"primary":"ghost")+'" href="'+esc(link({page:i+1}))+'">'+(i+1)+'</a>').join("");
 }
 function renderNav(){
  const cats=Array.isArray(data.categories)?data.categories:[];
  const seen=new Set(),items=[];
  cats.forEach(c=>{
   const value=text(c.path)||text(c.slug)||text(c.label)||text(c.name)||text(c.title);
   const label=text(c.label)||text(c.name)||text(c.title)||text(c.slug)||value,key=norm(value);
   if(value&&label&&!seen.has(key)){seen.add(key);items.push({value,label});}
  });
  nav.innerHTML='<a class="catalog-chip '+(!selected?"active":"")+'" href="catalog.html">ALL A–Z</a>'+items.map(c=>'<a class="catalog-chip '+(norm(c.value)===norm(selected)?"active":"")+'" href="catalog.html?category='+encodeURIComponent(c.value)+'">'+esc(c.label)+'</a>').join("");
  const letters="ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
  az.innerHTML=letters.map(l=>'<a class="catalog-letter '+(letter===l?"active":"")+'" href="'+esc(link({letter:l,page:1}))+'">'+l+'</a>').join("");
 }
 async function load(){
  status.textContent="Loading complete Movie API catalog…";
  try{
   const r=await fetch("/api/movie-api/home",{cache:"no-store"});
   const d=await r.json();if(!r.ok||d.ok!==true)throw new Error(d.error||"Movie API unavailable");
   data=d;all=flatten(d);if(search&&params.get("q"))search.value=params.get("q");
   renderNav();render();
  }catch(e){status.textContent="Catalog load failed: "+(e.message||"Unknown error");}
 }
 root.addEventListener("click",e=>{const b=e.target.closest("[data-path]");if(b?.dataset.path)location.href="watch.html?path="+encodeURIComponent(b.dataset.path);});
 search?.addEventListener("keydown",e=>{if(e.key==="Enter")location.href=link({page:1});});
 $("#catalogSearchButton")?.addEventListener("click",()=>location.href=link({page:1}));
 $("#catalogRefresh")?.addEventListener("click",load);
 load();
})();