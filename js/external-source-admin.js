(()=> {
 const $=s=>document.querySelector(s),db=()=>window.cineverseSupabase;
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const panel=document.createElement("section");panel.className="panel bulk-panel";panel.id="externalSourcesPanel";
 panel.innerHTML=`<div class="toolbar"><div><h3>External Video Sources</h3><p class="muted">Attach authorized external embeds or direct streams without storing videos on your server.</p></div><span class="tiny muted">Rights review required</span></div>
 <form id="externalSourceForm" class="form"><input id="evsId" type="hidden">
 <label>Movie / Series<select id="evsMovie" required><option value="">Select a title</option></select></label>
 <div class="row"><label>Source type<select id="evsType"><option value="embed">External Embed</option><option value="direct">Direct Video URL</option><option value="local">Local / R2</option></select></label><label>Provider<input id="evsProvider" placeholder="Internet Archive, YouTube, Vimeo…"></label></div>
 <div class="row"><label>Quality<select id="evsQuality"><option>Auto</option><option>420p</option><option>480p</option><option>720p</option><option>1080p</option><option>2K</option><option>4K UHD</option></select></label><label>Watch / Embed URL<input id="evsWatch" type="url" placeholder="https://…"></label></div>
 <label>Direct Download URL (only if explicitly permitted)<input id="evsDownload" type="url" placeholder="https://…"></label>
 <div class="row"><label>License / permission name<input id="evsLicense" placeholder="CC BY 4.0 / Written permission"></label><label>License URL / proof page<input id="evsLicenseUrl" type="url" placeholder="https://…"></label></div>
 <div class="row"><label class="check"><input id="evsCommercial" type="checkbox"> Commercial use permitted</label><label class="check"><input id="evsRedistribute" type="checkbox"> Redistribution / re-hosting permitted</label></div>
 <div class="row"><label class="check"><input id="evsAttribution" type="checkbox"> Attribution required</label><label class="check"><input id="evsVerified" type="checkbox"> I verified rights for this exact title/source</label></div>
 <label>Attribution text / rights notes<textarea id="evsAttributionText" rows="2"></textarea></label>
 <label class="check"><input id="evsActive" type="checkbox"> Publish this source (requires rights verification)</label>
 <div class="row"><button class="btn primary" type="submit">Save source</button><button class="btn ghost" type="button" id="evsClear">Clear form</button></div><p id="evsMsg" class="msg" aria-live="polite"></p></form><hr><div id="evsList" class="admin-list">Loading sources…</div>`;
 function msg(s,bad=false){$("#evsMsg").textContent=s;$("#evsMsg").classList.toggle("error",bad)}
 function val(id){return $("#"+id).value.trim()||null}
 function clear(){ $("#externalSourceForm").reset();$("#evsId").value="";$("#evsActive").checked=false;$("#evsVerified").checked=false; }
 async function loadTitles(){const {data,error}=await db().from("movies").select("id,title,release_year").order("title");if(error){msg(error.message,true);return}
 $("#evsMovie").innerHTML='<option value="">Select a title</option>'+(data||[]).map(m=>'<option value="'+esc(m.id)+'">'+esc(m.title)+' ('+esc(m.release_year||"—")+')</option>').join("");}
 async function list(){const {data,error}=await db().from("movie_video_sources").select("*,movies(title)").order("created_at",{ascending:false}).limit(100);if(error){$("#evsList").textContent="Run the external video sources SQL migration first: "+error.message;return}
 $("#evsList").innerHTML=(data||[]).map(x=>'<article class="admin-movie"><div class="admin-movie-info"><b>'+esc(x.movies?.title||"Title")+' · '+esc(x.provider||x.source_type)+'</b><small>'+esc(x.source_type)+' · '+esc(x.quality)+' · '+(x.is_active&&x.rights_verified?"Published":"Draft / unverified")+'</small></div><button class="mini" data-edit="'+x.id+'">Edit</button><button class="mini danger" data-del="'+x.id+'">Delete</button></article>').join("")||'<p class="muted">No external sources added yet.</p>';
 $("#evsList").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>edit(data.find(x=>x.id===b.dataset.edit)));
 $("#evsList").querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(!confirm("Delete this video source?"))return;const {error}=await db().from("movie_video_sources").delete().eq("id",b.dataset.del);if(error)msg(error.message,true);else list()});
 }
 function edit(x){$("#evsId").value=x.id;$("#evsMovie").value=x.movie_id;$("#evsType").value=x.source_type;$("#evsProvider").value=x.provider||"";$("#evsQuality").value=x.quality||"Auto";$("#evsWatch").value=x.watch_url||"";$("#evsDownload").value=x.download_url||"";$("#evsLicense").value=x.license_name||"";$("#evsLicenseUrl").value=x.license_url||"";$("#evsCommercial").checked=!!x.commercial_use;$("#evsRedistribute").checked=!!x.redistribution_allowed;$("#evsAttribution").checked=!!x.attribution_required;$("#evsVerified").checked=!!x.rights_verified;$("#evsAttributionText").value=x.attribution_text||"";$("#evsActive").checked=!!x.is_active;panel.scrollIntoView({behavior:"smooth"});}
 $("#externalSourceForm").onsubmit=async e=>{e.preventDefault();const watch=val("evsWatch"),download=val("evsDownload"),license=val("evsLicenseUrl"),verified=$("#evsVerified").checked,active=$("#evsActive").checked;
 if(!watch&&!download){msg("Watch URL or Download URL is required.",true);return}
 if([watch,download,license].some(u=>u&&!/^https:\/\//i.test(u))){msg("All URLs must use HTTPS.",true);return}
 if(active&&!verified){msg("Verify the rights for this exact source before publishing.",true);return}
 const row={movie_id:$("#evsMovie").value,source_type:$("#evsType").value,provider:val("evsProvider")||"",quality:$("#evsQuality").value,watch_url:watch,download_url:download,license_name:val("evsLicense")||"",license_url:license,commercial_use:$("#evsCommercial").checked,redistribution_allowed:$("#evsRedistribute").checked,attribution_required:$("#evsAttribution").checked,attribution_text:$("#evsAttributionText").value.trim(),rights_verified:verified,is_active:active};
 if(!row.movie_id){msg("Select a CineVerse title.",true);return}msg("Saving…");
 const id=$("#evsId").value,res=id?await db().from("movie_video_sources").update(row).eq("id",id):await db().from("movie_video_sources").insert(row);
 if(res.error){msg(res.error.message,true);return}msg("Source saved.");clear();await list();
 };
 $("#evsClear").onclick=clear;
 document.addEventListener("DOMContentLoaded",()=>{const dashboard=$("#dashboard"),grid=dashboard?.querySelector(".admin-grid");if(grid)dashboard.insertBefore(panel,grid);db().auth.onAuthStateChange(async(event,session)=>{if(event!=="SIGNED_IN"||!session)return;const {data:admin}=await db().from("admin_users").select("user_id").eq("user_id",session.user.id).maybeSingle();if(admin){await loadTitles();await list();}});});
})();
