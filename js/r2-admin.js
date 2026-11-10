(()=>{const $=s=>document.querySelector(s),db=()=>window.cineverseSupabase,esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const msg=(s,bad=false)=>{const e=$("#r2UploadMsg");e.textContent=s;e.classList.toggle("error",bad)};
async function init(){if(!db())return;const {data:{session}}=await db().auth.getSession();if(!session)return;const {data:admin}=await db().from("admin_users").select("user_id").eq("user_id",session.user.id).maybeSingle();if(!admin)return;
const {data,error}=await db().from("movies").select("id,title,release_year").order("title");if(error){msg("Could not load movie list: "+error.message,true);return}
$("#r2Movie").innerHTML='<option value="">Select a CineVerse title</option>'+(data||[]).map(m=>'<option value="'+esc(m.id)+'">'+esc(m.title)+' ('+esc(m.release_year||"—")+')</option>').join("");
$("#r2UploadForm").addEventListener("submit",upload);
}
async function upload(e){e.preventDefault();const file=$("#r2File").files[0],movieId=$("#r2Movie").value,quality=$("#r2Quality").value,button=$("#r2UploadButton");
if(!file||!movieId){msg("Select a movie and video file first.",true);return}
if(file.size>1024*1024*1024){msg("Maximum file size is 1 GB.",true);return}
if(!["video/mp4","video/webm","video/quicktime"].includes(file.type)){msg("Choose an MP4, WebM or MOV video.",true);return}
button.disabled=true;$("#r2Progress").value=0;
try{msg("Preparing secure R2 upload…");const {data:{session}}=await db().auth.getSession();if(!session)throw Error("Please sign in again.");
const signed=await fetch("/api/r2-upload-url",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},body:JSON.stringify({movieId,quality,filename:file.name,mimeType:file.type,size:file.size})});
const payload=await signed.json();if(!signed.ok)throw Error(payload.error||"Could not prepare upload.");
msg("Uploading to Cloudflare R2…");
await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open("PUT",payload.uploadUrl);xhr.setRequestHeader("Content-Type",file.type);xhr.upload.onprogress=e=>{if(e.lengthComputable){$("#r2Progress").value=Math.round(e.loaded/e.total*100);msg("Uploading… "+$("#r2Progress").value+"%")}};xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(Error("R2 upload failed (HTTP "+xhr.status+"). Check the R2 bucket CORS settings."));xhr.onerror=()=>reject(Error("Upload network/CORS error. Check R2 CORS settings."));xhr.send(file)});
msg("Saving video quality and URL…");
const {error}=await db().from("movie_media_assets").upsert({movie_id:movieId,quality,object_key:payload.objectKey,public_url:payload.publicUrl,mime_type:file.type,file_size:file.size,is_active:true},{onConflict:"movie_id,quality"});
if(error)throw Error("Video uploaded, but saving its CineVerse record failed: "+error.message);
msg("Upload complete! "+quality+" is now attached to the selected title.");$("#r2UploadForm").reset();$("#r2Progress").value=100;
}catch(err){msg(err.message||"Upload failed.",true)}finally{button.disabled=false}}
document.addEventListener("DOMContentLoaded",init);
})();