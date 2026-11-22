const BASE="https://okay-891h.onrender.com/api/v1/";
const MEDIA_HOST="okay-891h.onrender.com";
const ENDPOINTS=new Set(["home","reels","categories","catalog","search","suggest","updates-24h","details","stream","captions","related","comments","staff","trending","ranking","hot-search","filter","filter-options","platform","upcoming","sports/matches","sports/leagues","bottom-tabs","app-info","status"]);
const NO_CACHE=new Set(["stream","captions","comments"]);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
const list=v=>Array.isArray(v)?v:Array.isArray(v?.items)?v.items:Array.isArray(v?.results)?v.results:Array.isArray(v?.list)?v.list:[];
function mediaLocal(value){
 try{
  const u=new URL(String(value||""));
  if(u.hostname!==MEDIA_HOST||!["/api/mb-stream.mp4","/api/mb-ep-stream.mp4"].includes(u.pathname))return value;
  const p=new URLSearchParams();for(const [k,v] of u.searchParams)if(k.toLowerCase()!=="api_key")p.append(k,v);
  p.set("route",u.pathname.split("/").pop());
  return "/api/cinepulse-media?"+p.toString();
 }catch{return value;}
}
function secureTree(value){
 if(Array.isArray(value))return value.map(secureTree);
 if(!value||typeof value!=="object")return value;
 const out={...value};
 if(out.proxyUrl){const original=out.proxyUrl;const safe=mediaLocal(original);out.proxyUrl=safe;if(safe!==original){out.url=safe;out.downloadUrl=safe;}}
 else if(typeof out.url==="string"){const safe=mediaLocal(out.url);if(safe!==out.url){out.url=safe;out.downloadUrl=safe;}}
 for(const [k,v] of Object.entries(out))if(v&&typeof v==="object")out[k]=secureTree(v);
 return out;
}
function categoriesFrom(value){
 const out=[];const walk=(v,depth=0)=>{if(depth>5||!v)return;if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return;}if(typeof v==="object"){if(v.path||v.slug||v.label||v.name||v.title)out.push(v);for(const [k,x] of Object.entries(v))if(["categories","items","results","list","data","tabs"].includes(k))walk(x,depth+1);}};walk(value);
 const seen=new Set();return out.filter(x=>{const k=String(x.path||x.slug||x.label||x.name||x.title||"");if(!k||seen.has(k))return false;seen.add(k);return true;});
}
function normalizeHome(raw,cats){
 const mb=raw?.moviebox||{},ml=raw?.movielinkbd||{};
 const shelves=list(mb.shelves).map(s=>({title:s.title||s.name||"Collection",badge:s.badge||s.type||"COLLECTION",categoryPath:s.categoryPath||s.path||s.category||"",items:list(s.items)}));
 const add=(title,items,path)=>{if(list(items).length)shelves.push({title,badge:"MOVIELINKBD",categoryPath:path,items:list(items)});};
 add("MovieLinkBD · Latest Uploads",ml.latestUploads,"/new");
 add("Bangla Movies",ml.bangla,"/language/bangla");
 add("Bollywood Movies",ml.bollywood,"/bollywood");
 add("South Indian Movies",ml.south,"/southIndian");
 return {ok:true,source:"cinepulse",separated:true,categories:categoriesFrom(cats),sections:shelves,allOfficialSections:shelves,banners:list(mb.heroSlideshow),trending:list(mb.trending),_topTen:list(mb.trending),platforms:list(mb.platforms),collections:[],upcoming:[],_moviebox:mb,_movielinkbd:ml};
}
function pathInfo(path){
 const bits=String(path||"").split("/").filter(Boolean);
 if(bits[0]==="mb")return {subjectId:bits[1]||"",detailPath:bits[2]||""};
 return {detailPath:bits.at(-1)||""};
}
function titleFromPath(path){
 const info=pathInfo(path);
 let slug=info.detailPath||"";
 slug=slug.replace(/-[A-Za-z0-9]{7,}$/,"").replace(/[-_]+/g," ").trim();
 return slug;
}
async function upstream(endpoint,params,env,request){
 const u=new URL(endpoint,BASE);
 for(const [k,v] of params)if(!["apikey","api_key","key","token"].includes(k.toLowerCase()))u.searchParams.append(k,v);
 const headers=new Headers({"accept":"application/json","x-api-key":env.CINEPULSE_API_KEY});
 const range=request?.headers?.get("range");if(range)headers.set("range",range);
 return fetch(u.toString(),{headers,signal:AbortSignal.timeout(25000),redirect:"follow"});
}
async function mediaFetch(value,env,request){
 const u=new URL(value);
 const headers=new Headers({"referer":"https://movie-box.co/"});const range=request.headers.get("range");if(range)headers.set("range",range);
 if(u.hostname===MEDIA_HOST&&u.pathname.startsWith("/api/mb-")){
  u.searchParams.set("api_key",env.CINEPULSE_API_KEY);
 } 
 return fetch(u.toString(),{headers,redirect:"follow",signal:AbortSignal.timeout(60000)});
}
export async function onRequest({request,env,params}){
 if(request.method!=="GET"&&request.method!=="HEAD")return json({ok:false,error:"Method not allowed"},405);
 if(!env.CINEPULSE_API_KEY)return json({ok:false,error:"CinePulse API is not configured. Set CINEPULSE_API_KEY in Cloudflare Pages secrets."},503);
 const path=Array.isArray(params?.path)?params.path.join("/"):String(params?.path||"");
 const endpoint=path.replace(/^\/+|\/+$/g,"");
 if(!ENDPOINTS.has(endpoint)&&!["download-file","shorts","sports","me"].includes(endpoint))return json({ok:false,error:"CinePulse endpoint is not supported"},404);
 const incoming=new URL(request.url),p=new URLSearchParams(incoming.searchParams);
 try{
  if(endpoint==="home"){
   const [h,c]=await Promise.all([upstream("home",p,env,request),upstream("categories",new URLSearchParams(),env,request)]);
   if(!h.ok)return new Response(h.body,{status:h.status,headers:{"content-type":h.headers.get("content-type")||"application/json","cache-control":"no-store"}});
   const raw=await h.json();let cats={};try{if(c.ok)cats=await c.json();}catch{}
   return json(normalizeHome(raw,cats));
  }
  if(endpoint==="details"){
   const pathValue=p.get("path")||"",info=pathInfo(pathValue);
   const title=p.get("title")||titleFromPath(pathValue);
   if(title)p.set("title",title);
   if(info.subjectId&&!p.has("subjectId"))p.set("subjectId",info.subjectId);
   if(info.detailPath&&!p.has("detailPath"))p.set("detailPath",info.detailPath);
   p.delete("path");
   const r=await upstream("details",p,env,request);const data=await r.json();
   const detail=data?.detail||data?.data?.detail||data?.data||data?.result||data;
   return json(secureTree({...data,ok:data?.ok!==false,detail}),r.status);
  }
  if(endpoint==="catalog"){
   const cat=p.get("category")||p.get("path");p.delete("path");p.delete("category");if(cat)p.set("category",cat);
   if(!p.has("source"))p.set("source","all");
   const r=await upstream("catalog",p,env,request);return new Response(r.body,{status:r.status,headers:{"content-type":r.headers.get("content-type")||"application/json","cache-control":"no-store"}});
  }
  if(endpoint==="platform"){if(!p.has("platform"))p.set("platform",p.get("name")||"");p.delete("name");}
  if(endpoint==="shorts"){p.set("type",p.get("type")||"all");const r=await upstream("reels",p,env,request);return new Response(r.body,{status:r.status,headers:{"content-type":r.headers.get("content-type")||"application/json","cache-control":"no-store"}});}
  if(endpoint==="sports"){const r=await upstream("sports/matches",p,env,request);return new Response(r.body,{status:r.status,headers:{"content-type":r.headers.get("content-type")||"application/json","cache-control":"no-store"}});}
  if(endpoint==="me"){const r=await upstream("status",p,env,request);return new Response(r.body,{status:r.status,headers:{"content-type":r.headers.get("content-type")||"application/json","cache-control":"no-store"}});}
  if(endpoint==="download-file"){
   const q=new URLSearchParams(p);q.set("quality",q.get("quality")||"best");
   const r=await upstream("stream",q,env,request);if(!r.ok)return new Response(r.body,{status:r.status,headers:{"content-type":r.headers.get("content-type")||"application/json"}});
   const data=await r.json(),items=list(data.sources||data.streams||data.urls);
   const best=items.map(x=>x.proxyUrl||x.downloadUrl||x.url).filter(Boolean).sort((a,b)=>{const qa=Number(String(a).match(/(?:q=|quality=)(\d+)/)?.[1]||0),qb=Number(String(b).match(/(?:q=|quality=)(\d+)/)?.[1]||0);return qb-qa;})[0];
   if(!best)return json({ok:false,error:"No downloadable source was returned"},404);
   const file=await mediaFetch(best,env,request);const headers=new Headers();for(const k of ["content-type","content-length","content-range","accept-ranges"])if(file.headers.get(k))headers.set(k,file.headers.get(k));headers.set("cache-control","no-store");
   return new Response(request.method==="HEAD"?null:file.body,{status:file.status,headers});
  }
  if(endpoint==="related"&&!p.has("subjectId")&&p.has("title")){
   const d=await upstream("details",new URLSearchParams({title:p.get("title")}),env,request);const data=await d.json();const subjectId=data?.subjectId||data?.detail?.subjectId||data?.detail?.id;if(subjectId)p.set("subjectId",String(subjectId));
  }
  if(endpoint==="stream"){
   const r=await upstream("stream",p,env,request);const data=await r.json();return json(secureTree(data),r.status);
  }
  const actual=endpoint==="sports/matches"||endpoint==="sports/leagues"?endpoint:endpoint;
  const r=await upstream(actual,p,env,request);
  if(endpoint==="details"||endpoint==="stream"||endpoint==="related"||endpoint==="comments"||endpoint==="staff"||endpoint==="captions"){
   const data=await r.json();return json(secureTree(data),r.status);
  }
  return new Response(r.body,{status:r.status,headers:{"content-type":r.headers.get("content-type")||"application/json; charset=utf-8","cache-control":NO_CACHE.has(endpoint)?"no-store":"public, max-age=0, s-maxage=15","x-content-type-options":"nosniff"}});
 }catch(e){return json({ok:false,error:e?.name==="TimeoutError"?"CinePulse upstream timed out":"CinePulse upstream temporarily unavailable"},502);}
}
