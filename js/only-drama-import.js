(()=> {
 const $=s=>document.querySelector(s),db=()=>window.cineverseSupabase;
 const state={items:[],existing:new Set(),selected:new Set()};
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const key=x=>String(x.tmdb_id);\n const titleKey=x=>String(x.title||"").trim().toLowerCase()+"|"+(x.release_year??"");\n const isExisting=x=>state.existing.has(key(x))||state.existing.has("title:"+titleKey(x));
 function msg(s,bad=false){$("#dramaImportMsg").textContent=s;$("#dramaImportMsg").classList.toggle("error",bad)}
 async function token(){const {data,error}=await db().auth.getSession();if(error)throw error;const t=data?.session?.access_token;if(!t)throw Error("Admin হিসেবে আবার লগইন করো।");return t}
 function render(){
  const box=$("#dramaImportResults");
  box.innerHTML=state.items.map(x=>{const id=key(x),old=isExisting(x),p=x.poster_url?'<img loading="lazy" src="'+esc(x.poster_url)+'" alt="">':'<span>OD</span>';
   return '<label class="tmdb-result '+(old?'is-imported':'')+'"><input type="checkbox" data-id="'+esc(id)+'" '+(old?'disabled':'')+' '+(state.selected.has(id)?'checked':'')+'><span class="tmdb-result-poster">'+p+'</span><span class="tmdb-result-info"><b>'+esc(x.title)+'</b><small>'+esc(x.release_year||"Year unknown")+' · '+esc(x.genre||"Drama")+' · ★ '+esc(x.rating??"—")+'</small><p>'+esc(x.description||"No synopsis available.")+'</p><small class="tmdb-import-state">'+(old?'Already in catalog':'Free in '+esc(x.provider_region)+': '+esc(x.free_providers.join(", "))+' · Watch page link included')+'</small></span></label>';
  }).join("");
  box.querySelectorAll("[data-id]").forEach(el=>el.onchange=()=>{el.checked?state.selected.add(el.dataset.id):state.selected.delete(el.dataset.id);buttons()});
  buttons();
 }
 function buttons(){$("#dramaSelectAll").disabled=!state.items.some(x=>!isExisting(x));$("#dramaImportSelected").disabled=!state.selected.size;}
 async function load(){
  const b=$("#dramaLoad");b.disabled=true;state.items=[];state.selected.clear();$("#dramaImportResults").innerHTML="";
  try{
   msg("TMDB থেকে drama ও Bangladesh-এর free/ads-supported watch availability খোঁজা হচ্ছে…");
   const [t,existing]=await Promise.all([token(),db().from("movies").select("tmdb_id,title,release_year,media_type")]);
   if(existing.error)throw Error(existing.error.message);
   state.existing=new Set((existing.data||[]).flatMap(x=>[...(x.tmdb_id!=null?[String(x.tmdb_id)]:[]),"title:"+String(x.title||"").trim().toLowerCase()+"|"+(x.release_year??"")]));
   const res=await fetch("/api/tmdb-dramas",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+t},body:JSON.stringify({country:$("#dramaCountry").value,category:$("#dramaCategory").value,pages:Number($("#dramaPages").value),region:"BD"})});
   const data=await res.json();if(!res.ok||data.error)throw Error(data.error||"Drama list failed.");
   state.items=data.dramas||[];render();
   msg(state.items.length?state.items.length+"টি drama পাওয়া গেছে; "+data.without_free_link+"টিতে Bangladesh-এ free/ads-supported provider link পাওয়া যায়নি।":"এই তালিকায় Bangladesh-এর জন্য free/ads-supported watch link পাওয়া যায়নি।",!state.items.length);
  }catch(e){msg(e.message||"Could not load dramas.",true)}finally{b.disabled=false;}
 }
 async function add(){
  const chosen=state.items.filter(x=>state.selected.has(key(x))&&!isExisting(x));
  if(!chosen.length)return;
  const b=$("#dramaImportSelected");b.disabled=true;
  try{
   await token();
   let done=0;
   for(let i=0;i<chosen.length;i+=25){
    const rows=chosen.slice(i,i+25).map(({free_providers,provider_region,...row})=>({...row,published:$("#dramaPublish").checked}));
    const {error}=await db().from("movies").insert(rows);if(error)throw Error("Imported "+done+" before error: "+error.message);done+=rows.length;
   }
   chosen.forEach(x=>{state.existing.add(key(x));state.existing.add("title:"+titleKey(x));state.selected.delete(key(x))});render();
   msg(done+"টি drama Only Drama catalog-এ যোগ হয়েছে। Watch page link TMDB/JustWatch provider listing থেকে এসেছে; নির্দিষ্ট প্ল্যাটফর্মে free status অঞ্চল/সময়ভেদে বদলাতে পারে।");
   $("#refresh")?.click();
  }catch(e){msg(e.message||"Import failed.",true)}finally{b.disabled=!state.selected.size;}
 }
 $("#dramaLoad").onclick=load;
 $("#dramaImportSelected").onclick=add;
 $("#dramaSelectAll").onchange=e=>{state.items.forEach(x=>{const id=key(x);if(isExisting(x))return;e.target.checked?state.selected.add(id):state.selected.delete(id)});render()};
})();