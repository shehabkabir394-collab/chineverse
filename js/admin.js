(()=>{const $=s=>document.querySelector(s),db=()=>window.cineverseSupabase,esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function msg(el,s,err=false){el.textContent=s;
el.classList.toggle("error",err)}function setup(){if(!db()){$("#setup").classList.remove("hidden");
$("#setup").textContent="Setup required: check js/config.js and run supabase/schema.sql in Supabase SQL Editor."}}async function isAdmin(u){const {data,error}=await db().from("admin_users").select("user_id").eq("user_id",u.id).maybeSingle();
return !error&&!!data}async function enter(u){if(!await isAdmin(u)){await db().auth.signOut();
$("#loginPanel").classList.remove("hidden");
$("#dashboard").classList.add("hidden");
msg($("#loginMsg"),"This account is not approved as an administrator.",true);
return}$("#loginPanel").classList.add("hidden");
$("#dashboard").classList.remove("hidden");
load()}async function load(){const box=$("#list");
box.textContent="Loading…";
const {data,error}=await db().from("movies").select("*").order("created_at",{ascending:false});
if(error){box.textContent="Could not load: "+error.message;
return}if(!data.length){box.textContent="No titles yet. Add the first one.";
return}box.innerHTML=data.map(m=>`<article class="admin-movie"><div class="thumb">${m.poster_url&&/^https:\/\//i.test(m.poster_url)?`<img src="${esc(m.poster_url)}" alt="">`:"CV"}</div><div class="admin-movie-info"><b>${esc(m.title)}</b><small>${esc(m.media_type||"movie")} · ${esc(m.release_year||"")} · ${esc(m.quality)} · ${m.published?"Published":"Draft"}</small></div><button type="button" class="mini" data-edit="${m.id}">Edit</button><button type="button" class="mini danger" data-del="${m.id}">Delete</button></article>`).join("");
box.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>edit(data.find(m=>m.id===b.dataset.edit)));
box.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>del(b.dataset.del))}function set(id,v){$("#"+id).value=v??""}function edit(m){set("movieId",m.id);
set("title",m.title);
set("mediaType",m.media_type||"movie");
set("year",m.release_year);
set("qualityInput",m.quality||"1080p");
set("rating",m.rating);
set("genreInput",m.genre);
set("languageInput",m.language);
set("runtime",m.runtime_minutes);
set("contentStatus",m.content_status||"Released");
set("seasons",m.seasons);
set("episodes",m.episodes);
set("poster",m.poster_url);
set("backdrop",m.backdrop_url);
set("cast",m.cast_members);
set("tags",m.tags);
set("description",m.description);
set("trailer",m.trailer_url);
set("watchUrl",m.watch_url);
set("videoUrl",m.video_url);
set("download",m.download_url);
renderDownloadInputs(Array.isArray(m.download_links)?m.download_links:[]);
$("#published").checked=!!m.published;
$("#formTitle").textContent="Edit title";
$("#save").textContent="Update title";
window.scrollTo({top:0,behavior:"smooth"})}function clear(){ $("#movieForm").reset();
renderDownloadInputs([]);
$("#movieId").value="";
$("#published").checked=true;
$("#mediaType").value="movie";
$("#qualityInput").value="1080p";
$("#contentStatus").value="Released";
$("#formTitle").textContent="Add a title";
$("#save").textContent="Save title";
msg($("#formMsg"),"")}async function del(id){if(!confirm("Delete this title? This cannot be undone."))return;
const {error}=await db().from("movies").delete().eq("id",id);
if(error)msg($("#formMsg"),error.message,true);
else{msg($("#formMsg"),"Title deleted.");
load()}}function renderDownloadInputs(items){const host=$("#downloadLinksEditor");
if(!host)return;
host.innerHTML="";
const list=items.length?items:[{label:"",quality:"",url:""}];
list.forEach(item=>{const row=document.createElement("div");
row.className="download-link-row";
row.innerHTML="<label>Link label<input data-link-label placeholder=\"ZIP Episodes 01-04\" value=\""+esc(item.label||"")+"\"></label><label>Quality / range<input data-link-quality placeholder=\"720p ┬╖ 1.2 GB\" value=\""+esc(item.quality||"")+"\"></label><label>HTTPS URL<input data-link-url type=\"url\" placeholder=\"https://authorized-host.example/file\" value=\""+esc(item.url||"")+"\"></label><button type=\"button\" class=\"mini danger\" data-remove-link>Remove</button>";
host.append(row);
row.querySelector("[data-remove-link]").onclick=()=>{row.remove();
if(!host.children.length)renderDownloadInputs([])}})}function readDownloadInputs(){return [...$("#downloadLinksEditor").querySelectorAll(".download-link-row")].map(row=>({label:row.querySelector("[data-link-label]").value.trim(),quality:row.querySelector("[data-link-quality]").value.trim(),url:row.querySelector("[data-link-url]").value.trim()})).filter(x=>x.url)}function validHttps(v){return !v||/^https:\/\//i.test(v)}function n(id){const v=$("#"+id).value;
return v?Number(v):null}$("#loginForm").onsubmit=async e=>{e.preventDefault();
if(!db()){setup();
msg($("#loginMsg"),"Configure Supabase first.",true);
return}msg($("#loginMsg"),"Signing in…");
const {data,error}=await db().auth.signInWithPassword({email:$("#email").value.trim(),password:$("#password").value});
if(error){msg($("#loginMsg"),error.message,true);
return}enter(data.user)};
$("#signout").onclick=async()=>{await db().auth.signOut();
$("#dashboard").classList.add("hidden");
$("#loginPanel").classList.remove("hidden");
msg($("#loginMsg"),"Signed out.")};
$("#refresh").onclick=load;
$("#clear").onclick=clear;
$("#addDownloadLink").onclick=()=>{const links=readDownloadInputs();
links.push({label:"",quality:"",url:""});
renderDownloadInputs(links)};
$("#movieForm").onsubmit=async e=>{e.preventDefault();
if(!db()){msg($("#formMsg"),"Configure Supabase first.",true);
return}const row={title:$("#title").value.trim(),media_type:$("#mediaType").value,release_year:n("year"),quality:$("#qualityInput").value,rating:n("rating"),genre:$("#genreInput").value.trim(),language:$("#languageInput").value.trim(),runtime_minutes:n("runtime"),content_status:$("#contentStatus").value,seasons:n("seasons"),episodes:n("episodes"),poster_url:$("#poster").value.trim()||null,backdrop_url:$("#backdrop").value.trim()||null,cast_members:$("#cast").value.trim(),tags:$("#tags").value.trim(),description:$("#description").value.trim(),trailer_url:$("#trailer").value.trim()||null,watch_url:$("#watchUrl").value.trim()||null,video_url:$("#videoUrl").value.trim()||null,download_url:$("#download").value.trim()||null,download_links:readDownloadInputs(),published:$("#published").checked};
if(!validHttps(row.poster_url)||!validHttps(row.backdrop_url)||!validHttps(row.trailer_url)||!validHttps(row.watch_url)||!validHttps(row.video_url)||!validHttps(row.download_url)||row.download_links.some(link=>!validHttps(link.url))){msg($("#formMsg"),"Use HTTPS URLs only.",true);
return}if(row.rating!==null&&(row.rating<0||row.rating>10)){msg($("#formMsg"),"Rating must be between 0 and 10.",true);
return}msg($("#formMsg"),"Saving…");
const id=$("#movieId").value,result=id?await db().from("movies").update(row).eq("id",id):await db().from("movies").insert(row);
if(result.error){msg($("#formMsg"),result.error.message,true);
return}msg($("#formMsg"),"Saved successfully.");
clear();
load()};


let fetchedDetails=null;

function showFetchedPreview(d){
 const fields=[["Title",d.title],["Year",d.release_year],["Genre",d.genre],["Rating",d.rating],["Quality",d.quality],["Poster URL",d.poster_url],["Video URL",d.video_url],["Download page",d.download_url],["Description",d.description]];

 const image=d.poster_url&&/^https:\/\//i.test(d.poster_url)?'<img class="fetch-poster" src="'+esc(d.poster_url)+'" alt="Poster preview">':"";

 $("#fetchPreview").innerHTML=image+'<div class="fetch-preview-fields">'+fields.filter(x=>x[1]!==null&&x[1]!==undefined&&String(x[1]).trim()!=="").map(x=>'<p><b>'+esc(x[0])+':</b> '+esc(String(x[1]).length>260?String(x[1]).slice(0,260)+"…":x[1])+'</p>').join("")+'</div><p class="tiny muted">This is a preview only. Nothing has been saved to Supabase yet.</p>';

 $("#fetchPreview").classList.remove("hidden");
$("#useFetched").classList.remove("hidden");

}
async function fetchMovieDetails(){
 const url=$("#sourcePageUrl").value.trim(),status=$("#fetchMsg"),button=$("#fetchDetails");

 fetchedDetails=null;
$("#fetchPreview").classList.add("hidden");
$("#useFetched").classList.add("hidden");

 if(!url){msg(status,"Paste a movie download/details page URL first.",true);
return}
 if(!/^https:\/\//i.test(url)){msg(status,"Use a public HTTPS webpage URL.",true);
return}
 button.disabled=true;
msg(status,"Fetching public page metadata…");

 try{
  const sessionResult=await db().auth.getSession();
const accessToken=sessionResult.data?.session?.access_token;
if(!accessToken)throw Error("Sign in again to fetch movie details.");

  const response=await fetch("/api/fetch-movie",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+accessToken},body:JSON.stringify({url})});

  const data=await response.json();

  if(!response.ok||data.error)throw Error(data.error||"Could not fetch details.");

  if(!data.title&&!data.description&&!data.poster_url&&!data.release_year)throw Error("No useful metadata was found. This site may block automated access; enter details manually or try another public page.");

  fetchedDetails=data;
showFetchedPreview(data);
msg(status,"Preview ready. Check the fields, then choose Use details in form.");

 }catch(e){msg(status,e.message||"Fetch failed.",true)}
 finally{button.disabled=false}
}
function useFetchedDetails(){
 if(!fetchedDetails)return;

 const d=fetchedDetails;

 if(d.title)set("title",d.title);

 if(d.release_year)set("year",d.release_year);

 if(d.genre)set("genreInput",d.genre);

 if(d.rating!==null&&d.rating!==undefined)set("rating",d.rating);

 if(d.description)set("description",d.description);

 if(d.poster_url)set("poster",d.poster_url);

 if(d.video_url)set("videoUrl",d.video_url);

 if(d.download_url)set("download",d.download_url);

 if(d.quality){const opts=[...$("#qualityInput").options];
const opt=opts.find(o=>o.value.toLowerCase()===d.quality.toLowerCase()||o.text.toLowerCase()===d.quality.toLowerCase());
if(opt)$("#qualityInput").value=opt.value}
 $("#mediaType").value="movie";

 msg($("#formMsg"),"Details copied into the form. Review them and click Save title; nothing is saved until you do.");

 $("#movieForm").scrollIntoView({behavior:"smooth",block:"start"});

}
$("#fetchDetails").onclick=fetchMovieDetails;

$("#useFetched").onclick=useFetchedDetails;

$("#clearFetched").onclick=()=>{fetchedDetails=null;
$("#sourcePageUrl").value="";
$("#fetchPreview").innerHTML="";
$("#fetchPreview").classList.add("hidden");
$("#useFetched").classList.add("hidden");
msg($("#fetchMsg"),"Preview cleared.")};


function parseCSV(text){text=text.replace(/^\uFEFF/,"");
const rows=[];
let row=[],field="",quoted=false;
for(let i=0;
i<text.length;
i++){const c=text[i];
if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';
i++}else if(c==='"')quoted=false;
else field+=c}else if(c==='"'){quoted=true}else if(c===","){row.push(field);
field=""}else if(c==="\n"){row.push(field);
rows.push(row);
row=[];
field=""}else if(c==="\r"){if(text[i+1]==="\n")i++;
row.push(field);
rows.push(row);
row=[];
field=""}else field+=c}if(field.length||row.length){row.push(field);
rows.push(row)}if(quoted)throw Error("CSV has an unclosed quote. Check the file and try again.");
return rows.filter(r=>r.some(v=>String(v).trim()!==""))}
function csvBool(v,fallback){if(v==null||String(v).trim()==="")return fallback;
return ["true","1","yes","y","published"].includes(String(v).trim().toLowerCase())}
function csvRow(headers,vals,forcePublish){const raw={};
headers.forEach((h,i)=>raw[h]=String(vals[i]??"").trim());
const get=(...keys)=>{for(const k of keys){if(raw[k]!=null&&raw[k]!=="")return raw[k]}return ""};
const number=(...keys)=>{const v=get(...keys);
return v===""?null:Number(v)};
const type=(get("media_type","type","content_type")||"movie").toLowerCase();
const quality=get("quality","resolution")||"1080p";
const year=number("release_year","year");
const rating=number("rating","imdb_rating");
const runtime=number("runtime_minutes","runtime");
const seasons=number("seasons","season_count");
const episodes=number("episodes","episode_count");
const downloadLinksValue=get("download_links");
let downloadLinks=[];
if(downloadLinksValue){try{downloadLinks=JSON.parse(downloadLinksValue)}catch{throw Error("download_links must be a JSON array")};
if(!Array.isArray(downloadLinks))throw Error("download_links must be a JSON array");
downloadLinks=downloadLinks.map(x=>({label:String(x.label||""),quality:String(x.quality||""),url:String(x.url||"")}));
if(downloadLinks.some(x=>!/^https:\/\//i.test(x.url)))throw Error("Every download link must use HTTPS")};
const url=(...keys)=>{const v=get(...keys);
if(!v)return null;
if(!/^https:\/\//i.test(v))throw Error("URL fields must use HTTPS: "+keys[0]);
return v};
if(!get("title","name"))throw Error("Title is required");
if(!["movie","series","anime"].includes(type))throw Error("media_type must be movie, series or anime");
if(!["480p","720p","1080p","2k","4k uhd","hevc","other"].includes(quality.toLowerCase()))throw Error("Unsupported quality: "+quality);
if(year!==null&&(!Number.isInteger(year)||year<1888||year>2100))throw Error("Invalid release_year");
if(rating!==null&&(!Number.isFinite(rating)||rating<0||rating>10))throw Error("Rating must be 0–10");
return {title:get("title","name").slice(0,180),media_type:type,release_year:year,genre:get("genre","genres"),language:get("language","languages"),quality:({"2k":"2K","4k uhd":"4K UHD"}[quality.toLowerCase()]||quality),rating,description:get("description","synopsis").slice(0,5000),poster_url:url("poster_url","poster"),backdrop_url:url("backdrop_url","backdrop"),trailer_url:url("trailer_url","trailer"),watch_url:url("watch_url","watch_page_url","watch_link"),video_url:url("video_url","video_file_url"),download_url:url("download_url","viewing_url"),download_links:downloadLinks,cast_members:get("cast_members","cast","crew"),runtime_minutes:runtime,content_status:get("content_status","status")||"Released",seasons,episodes,tags:get("tags"),published:!!forcePublish}}
function downloadCSVTemplate(){const sample=['title','media_type','release_year','genre','language','quality','rating','description','poster_url','backdrop_url','trailer_url','watch_url','video_url','download_url','download_links','cast_members','runtime_minutes','content_status','seasons','episodes','tags','published'];
const example=['Example Movie','movie','2024','Action, Drama','English','1080p','7.8','Short synopsis','','','','','','','','[]','Actor Name','120','Released','','','Sample','false'];
const quote=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
const blob=new Blob(["\uFEFF"+sample.map(quote).join(",")+"\r\n"+example.map(quote).join(",")+"\r\n"],{type:"text/csv;charset=utf-8"});
const url=URL.createObjectURL(blob),a=document.createElement("a");
a.href=url;
a.download="cineverse-import-template.csv";
a.click();
URL.revokeObjectURL(url)}
async function importCSV(){const file=$("#csvFile").files[0],out=$("#csvReport"),status=$("#csvMsg");
out.textContent="";
if(!file){msg(status,"Choose a CSV file first.",true);
return}if(file.size>10*1024*1024){msg(status,"CSV file must be smaller than 10 MB.",true);
return}if(!db()){msg(status,"Supabase is not configured.",true);
return}$("#csvImport").disabled=true;
try{msg(status,"Reading CSV…");
const parsed=parseCSV(await file.text());
if(parsed.length<2)throw Error("CSV needs a header row and at least one data row.");
const headers=parsed[0].map(h=>h.trim().toLowerCase().replace(/^\uFEFF/,""));
if(!headers.includes("title")&&!headers.includes("name"))throw Error("Missing required title column.");
const records=[],errors=[];
for(let i=1;
i<parsed.length;
i++){try{records.push({line:i+1,row:csvRow(headers,parsed[i],$("#csvPublish").checked)})}catch(e){errors.push("Line "+(i+1)+": "+e.message)}}if(!records.length)throw Error("No valid rows to import. "+errors.slice(0,3).join(" | "));
msg(status,"Checking existing titles…");
const {data:existing,error:lookupError}=await db().from("movies").select("title,release_year,media_type,tmdb_id");
if(lookupError)throw Error("Could not check existing records: "+lookupError.message);
const seen=new Set((existing||[]).map(m=>[m.title,m.release_year??"",m.media_type||"movie"].join("|").toLowerCase()));
const fresh=[];
let skipped=0;
for(const item of records){const key=[item.row.title,item.row.release_year??"",item.row.media_type].join("|").toLowerCase();
if(seen.has(key)){skipped++;
continue}seen.add(key);
fresh.push(item.row)}let inserted=0;
for(let i=0;
i<fresh.length;
i+=50){msg(status,"Importing "+Math.min(i+50,fresh.length)+" of "+fresh.length+"…");
const {error}=await db().from("movies").insert(fresh.slice(i,i+50));
if(error)throw Error("Imported "+inserted+" records before error: "+error.message);
inserted+=Math.min(50,fresh.length-i)}msg(status,"Import complete: "+inserted+" added, "+skipped+" duplicates skipped, "+errors.length+" invalid rows.");
out.textContent=errors.length?"Skipped rows:\n"+errors.slice(0,30).join("\n")+(errors.length>30?"\n… and "+(errors.length-30)+" more.":""):"";
load()}catch(e){msg(status,e.message||"Import failed.",true)}finally{$("#csvImport").disabled=false}}
$("#csvTemplate").onclick=downloadCSVTemplate;
$("#csvImport").onclick=importCSV;

renderDownloadInputs([]);
setup();
if(db())db().auth.getSession().then(({data})=>{if(data.session)enter(data.session.user)})})();
