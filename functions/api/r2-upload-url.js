const enc=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());
const hex=b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");
const sha=async s=>hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
const hmac=async(key,s)=>crypto.subtle.sign("HMAC",await crypto.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-256"},false,["sign"]),new TextEncoder().encode(s));
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
async function adminUser(request,env){
 const token=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token||!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY)return null;
 const headers={apikey:env.SUPABASE_ANON_KEY,Authorization:"Bearer "+token};
 const u=await fetch(env.SUPABASE_URL+"/auth/v1/user",{headers});
 if(!u.ok)return null;const user=await u.json();
 const a=await fetch(env.SUPABASE_URL+"/rest/v1/admin_users?user_id=eq."+encodeURIComponent(user.id)+"&select=user_id",{headers});
 if(!a.ok)return null;const rows=await a.json();return rows.length?user:null;
}
export async function onRequestPost({request,env}){
 const user=await adminUser(request,env);if(!user)return json({error:"Administrator sign-in required."},401);
 const required=["R2_ACCOUNT_ID","R2_BUCKET","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_PUBLIC_BASE_URL","SUPABASE_URL","SUPABASE_ANON_KEY"];
 for(const k of required)if(!env[k])return json({error:"Cloudflare Pages configuration missing: "+k},503);
 let body;try{body=await request.json()}catch{return json({error:"Invalid JSON body."},400)}
 const {movieId,quality,filename,mimeType,size}=body||{};
 if(!/^[0-9a-f-]{36}$/i.test(movieId||""))return json({error:"Select a valid movie."},400);
 if(!["480p","720p","1080p","2K","4K UHD"].includes(quality))return json({error:"Unsupported video quality."},400);
 const allowed={"video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov"};
 if(!allowed[mimeType])return json({error:"Only MP4, WebM and MOV files are supported."},400);
 if(!Number.isSafeInteger(size)||size<1||size>1024*1024*1024)return json({error:"Maximum upload size is 1 GB per file."},400);
 const safe=(String(filename||"video").normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(-100)||"video");
 const key="movies/"+movieId+"/"+quality.replace(/[^a-zA-Z0-9]+/g,"-")+"-"+crypto.randomUUID()+"-"+safe;
 const host=env.R2_ACCOUNT_ID+".r2.cloudflarestorage.com";
 const path="/"+enc(env.R2_BUCKET)+"/"+key.split("/").map(enc).join("/");
 const now=new Date(),stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,""),day=stamp.slice(0,8),scope=day+"/auto/s3/aws4_request";
 const params={"X-Amz-Algorithm":"AWS4-HMAC-SHA256","X-Amz-Credential":env.R2_ACCESS_KEY_ID+"/"+scope,"X-Amz-Date":stamp,"X-Amz-Expires":"900","X-Amz-SignedHeaders":"host"};
 const query=Object.keys(params).sort().map(k=>enc(k)+"="+enc(params[k])).join("&");
 const canonical=["PUT",path,query,"host:"+host+"\n","host","UNSIGNED-PAYLOAD"].join("\n");
 const toSign=["AWS4-HMAC-SHA256",stamp,scope,await sha(canonical)].join("\n");
 const kDate=await hmac(new TextEncoder().encode("AWS4"+env.R2_SECRET_ACCESS_KEY),day);
 const kRegion=await hmac(kDate,"auto"),kService=await hmac(kRegion,"s3"),kSigning=await hmac(kService,"aws4_request");
 const signature=hex(await hmac(kSigning,toSign));
 const uploadUrl="https://"+host+path+"?"+query+"&X-Amz-Signature="+signature;
 const base=env.R2_PUBLIC_BASE_URL.replace(/\/+$/,"");
 const publicUrl=base+"/"+key.split("/").map(enc).join("/");
 return json({uploadUrl,objectKey:key,publicUrl,expiresIn:900});
}
