(()=>{"use strict";
const $=s=>document.querySelector(s),esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const arr=(v)=>Array.isArray(v)?v:Array.isArray(v?.items)?v.items:Array.isArray(v?.list)?v.list:Array.isArray(v?.results)?v.results:[];
const title=x=>String(x?.name||x?.title||x?.label||x?.platformName||x?.platform||"").trim();
 const isHindiDubbed=x=>{const vals=[x?.language,x?.audioLanguage,x?.audioLanguages,x?.dubLanguage,x?.dubLanguages,x?.availableLanguages,x?.languages,x?.audio,x?.audioTracks];return x?._hindiCatalog===true||vals.some(v=>Array.isArray(v)?v.some(y=>/hindi|हिंदी|हिन्दी|^hi(n)?$/i.test(String(y?.name||y?.language||y?.code||y||""))):/hindi|हिंदी|हिन्दी|^hi(n)?$/i.test(String(v||"")));};
const path=x=>String(x?.path||x?.detailPath||"");
const image=x=>String(x?.poster||x?.logo||x?.icon||x?.image||"");
const platformBox=$("#movieApiPlatformSection");
let platformNames=[];
function card(x){const p=path(x),im=image(x),t=title(x)||"Untitled";return '<a class="cv-platform-card" href="'+(p.startsWith("/mb/")?'watch.html?path='+encodeURIComponent(p):'catalog.html?q='+encodeURIComponent(t))+'">'+(im?'<img loading="lazy" src="'+esc(im)+'" alt="">':'<span class="cv-platform-icon">▣</span>')+'<b>'+esc(t)+'</b></a>';}
async function loadPlatform(name){
 const box=$("#cvPlatformResults");if(!box)return;
 box.innerHTML='<p class="muted">Loading '+esc(name)+'…</p>';
 try{const r=await fetch('/api/movie-api/platform?name='+encodeURIComponent(name)+'&page=1',{cache:"no-store"}),d=await r.json();if(!r.ok||d.ok===false)throw Error(d.error||"Platform unavailable");
 const items=arr(d.items||d.results||d.data||d).filter(isHindiDubbed);box.innerHTML=items.length?'<div class="cv-platform-grid">'+items.slice(0,24).map(card).join("")+'</div>':'<p class="muted">এই Platform-এ এখন কোনো title পাওয়া যায়নি।</p>';
 }catch(e){box.innerHTML='<p class="muted">'+esc(e.message||"Platform unavailable")+'</p>';}
}
async function initPlatforms(){
 if(!platformBox)return;
 try{const r=await fetch('/api/movie-api/home',{cache:"no-store"}),d=await r.json();if(!r.ok||!d.ok)return;
 const raw=[...arr(d.platforms),...arr(d.platformList),...arr(d.platformCategories)];
 if(!raw.length){try{const cr=await fetch("/api/movie-api/categories",{cache:"no-store"}),cd=await cr.json();const cats=arr(cd.categories||cd.items||cd.data||cd);raw.push(...cats.filter(x=>/platform/i.test(String(x.type||x.kind||x.categoryType||""))||x.platformName||x.platforms));}catch{}}
 platformNames=[...new Map(raw.map(x=>[title(x).toLowerCase(),x]).filter(x=>x[0])).values()];
 if(!platformNames.length)return;
 platformBox.hidden=false;
 platformBox.innerHTML='<div class="section-head"><div><p class="eyebrow">EXPLORE BY PLATFORM</p><h2>Streaming <em>Platforms</em></h2></div></div><div class="cv-platform-tabs">'+platformNames.map((x,i)=>'<button type="button" class="cv-platform-tab" data-platform="'+esc(title(x))+'">'+esc(title(x))+'</button>').join("")+'</div><div id="cvPlatformResults"></div>';
 platformBox.addEventListener("click",e=>{const b=e.target.closest("[data-platform]");if(!b)return;platformBox.querySelectorAll(".cv-platform-tab").forEach(x=>x.classList.toggle("active",x===b));loadPlatform(b.dataset.platform);});
 const first=platformBox.querySelector("[data-platform]");if(first){first.classList.add("active");loadPlatform(first.dataset.platform);}
 }catch(e){console.warn("Platform list unavailable",e);}
}
async function showMe(){
 let modal=$("#cvMePanel");if(!modal){modal=document.createElement("div");modal.id="cvMePanel";modal.className="cv-me-panel";modal.hidden=true;modal.innerHTML='<div class="cv-me-card" role="dialog" aria-modal="true" aria-labelledby="cvMeTitle"><button type="button" class="cv-me-close" aria-label="Close">×</button><p class="eyebrow">MOVIE API ACCOUNT</p><h2 id="cvMeTitle">My API</h2><div id="cvMeContent"><p class="muted">Loading account information…</p></div></div>';document.body.appendChild(modal);modal.addEventListener("click",e=>{if(e.target===modal||e.target.closest(".cv-me-close"))modal.hidden=true;});}
 modal.hidden=false;const content=$("#cvMeContent");content.innerHTML='<p class="muted">Loading account information…</p>';
 try{const r=await fetch("/api/movie-api/me",{cache:"no-store"}),d=await r.json();if(!r.ok||d.ok===false)throw Error(d.error||"Account information unavailable");
 const root=d.me||d.account||d.profile||d.data||d;const rows=[];
 const add=(label,v)=>{if(v!==undefined&&v!==null&&String(v)!=="")rows.push('<div class="cv-me-row"><span>'+esc(label)+'</span><b>'+esc(v)+'</b></div>');};
 add("Account",root.name||root.username||root.email||root.account||"Movie API Trial");
 add("Plan",root.plan||root.package||root.type||root.tier);
 add("Status",root.status||root.state||"Connected");
 add("Quota",root.quota||root.totalRequests||root.requestLimit);
 add("Requests used",root.used||root.requestsUsed||root.consumed);
 add("Remaining",root.remaining||root.requestsRemaining);
 add("Expires",root.expiresAt||root.expiry||root.expireDate);
 if(d.trial&&typeof d.trial==="object"){Object.entries(d.trial).forEach(([k,v])=>{if(!["apiKey","key"].includes(k.toLowerCase())&&(typeof v!=="object"))add(k.replace(/([A-Z])/g," $1"),v);});}
 if(!rows.length)Object.entries(root).forEach(([k,v])=>{if(typeof v!=="object"&&!/key|secret|token|password/i.test(k))add(k.replace(/([A-Z])/g," $1"),v);});
 content.innerHTML=rows.join("")||'<p class="muted">API connected, but no profile fields were returned.</p>';
 }catch(e){content.innerHTML='<p class="muted">'+esc(e.message||"Could not load API account.")+'</p>';}
}
$("#cvMeOpen")?.addEventListener("click",showMe);
initPlatforms();
})();