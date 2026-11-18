(() => {
 "use strict";
 const $=s=>document.querySelector(s),esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const text=v=>typeof v==="string"?v.trim():"";
 const root=$("#movieApiSections"),status=$("#movieApiStatus"),search=$("#movieApiSearch"),nav=$("#movieApiCategories");
 if(!root||!status||!search||!nav)return;
 let home=null;
 const badge=item=>{const l=String(item.language||"").toUpperCase(),t=String(item.title||"").toUpperCase();return l.includes("HINDI DUB")||t.includes("HINDI DUB")?"HINDI DUBBED":l.includes("HINDI")||/\[HINDI\]|\(HINDI\)/.test(t)?"HINDI":"";};
 const pathOf=item=>{if(typeof item.path==="string"&&item.path.startsWith("/mb/"))return item.path;try{const p=new URL(item.detailsEndpoint).searchParams.get("path");return p?.startsWith("/mb/")?p:"";}catch{return "";}};
 const sort=items=>[...items].sort((a,b)=>Number(!!badge(b))-Number(!!badge(a))||(Number(b.uploadedAtMs)||0)-(Number(a.uploadedAtMs)||0));
 function card(item){const title=item.title||"Untitled",poster=/^https:\/\//i.test(item.poster||item.previewImage||"")?(item.poster||item.previewImage):"",path=pathOf(item),label=badge(item);return '<article class="movie-card movie-api-card"><button class="movie-api-poster" type="button" data-path="'+esc(path)+'" '+(!path?"disabled":"")+' aria-label="Open '+esc(title)+'">'+(poster?'<img loading="lazy" src="'+esc(poster)+'" alt="'+esc(title)+' poster">':'<span class="movie-api-placeholder">CINEVERSE</span>')+'<span class="quality">'+esc(item.quality||item.typeBadge||"HD")+'</span>'+(label?'<span class="movie-api-language-badge">'+label+'</span>':"")+'<span class="overlay">▶<small>View details &amp; watch</small></span></button><div class="movie-info"><h3>'+esc(title)+'</h3><p>'+esc(item.language||item.country||item.typeBadge||"")+'</p></div></article>';}
 function section(title,badgeText,items){return items.length?'<section class="movie-api-row"><div class="section-head"><div><p class="eyebrow">'+esc(badgeText)+'</p><h2>'+esc(title)+'</h2></div><a class="btn ghost" href="catalog.html?category='+encodeURIComponent(title)+'">View all →</a></div><div class="grid">'+items.map(card).join("")+'</div></section>':"";}
 function render(){if(!home)return;const sections=Array.isArray(home.sections)?home.sections:[],trending=Array.isArray(home.trending)?home.trending:[],categories=Array.isArray(home.categories)?home.categories:[];
  const seen=new Set(),cats=[];categories.forEach(c=>{const value=text(c.path)||text(c.slug)||text(c.label)||text(c.name)||text(c.title),label=text(c.label)||text(c.name)||text(c.title)||text(c.slug)||value,key=value.toLowerCase();if(value&&label&&!seen.has(key)){seen.add(key);cats.push({value,label});}});
  nav.innerHTML='<a class="catalog-chip active" href="catalog.html">ALL A–Z</a>'+cats.map(c=>'<a class="catalog-chip" href="catalog.html?category='+encodeURIComponent(c.value)+'">'+esc(c.label)+'</a>').join("");
  let out="";if(trending.length)out+=section("Trending Now","POPULAR",sort(trending).slice(0,12));
  sections.slice(0,5).forEach(s=>out+=section(text(s.title)||"Discover",text(s.badge)||"COLLECTION",sort(Array.isArray(s.items)?s.items:[]).slice(0,12)));
  root.innerHTML=out||'<p class="muted">No titles available.</p>';
  status.textContent=trending.length+" trending · "+sections.length+" collections · "+categories.length+" categories available. Browse all titles A–Z.";
 }
 root.addEventListener("click",e=>{const b=e.target.closest("[data-path]");if(b?.dataset.path)location.href="watch.html?path="+encodeURIComponent(b.dataset.path);});
 search.addEventListener("keydown",e=>{if(e.key==="Enter")location.href="catalog.html?q="+encodeURIComponent(search.value.trim());});
 $("#movieApiRefresh")?.addEventListener("click",load);
 async function load(){status.textContent="Loading complete Movie API catalog…";root.innerHTML="";try{const r=await fetch("/api/movie-api/home",{cache:"no-store"}),d=await r.json();if(!r.ok||d.ok!==true)throw new Error(d.error||"Catalog unavailable");home=d;render();}catch(e){status.textContent="Catalog could not load: "+(e.message||"Unknown error");}}
 load();
})();